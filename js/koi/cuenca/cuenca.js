// ─────────────────────────────────────────────────────────────────────────────
// cuenca.js — orquestador de delineación automática y adaptativa (koi-flow, Fase 2).
// Dado el punto pinchado, descarga un DEM pequeño y DENSO y delinea la cuenca; si la
// cuenca toca el borde del DEM (es mayor que la ventana), amplía la ventana (y baja
// la resolución) y reintenta. Así el DEM se dimensiona solo según el tamaño de cuenca.
// ─────────────────────────────────────────────────────────────────────────────
import { fetchDEM, bboxEntorno } from './dem_tiles.js?v=6';
import { delinear } from './delineacion.js?v=6';

export async function delinearAuto(lon, lat, opts = {}, onProgress) {
  // ±~0.9 km (caja ~1.8 km) → DEM MUY denso (z15 ≈4.7 m) para cuencas chicas (0.1 km²).
  // Mientras la cuenca TOQUE el borde, se amplía la ventana y se baja la resolución
  // (el DEM se dimensiona solo). Se sigue expandiendo hasta que la cuenca deje de
  // tocar el borde (divisoria alcanzada) o hasta `maxHalf` (tope del DEM local: más
  // allá conviene la hidrografía global HydroBASINS). Sube el presupuesto de celdas
  // con el tamaño para no perder resolución de golpe.
  let half = opts.half0 ?? 0.008;
  // tope del DEM local ~0.8° (~90 km): más allá la resolución se vuelve gruesa y
  // FUSIONA cuencas vecinas por divisorias mal resueltas → para cuencas grandes se
  // usa HydroBASINS (preciso, precalculado). El DEM local queda bien resuelto.
  const maxHalf = opts.maxHalf ?? 0.8;
  const maxIter = opts.maxIter ?? 16;
  let res = null, grid = null, it = 0;
  for (; it < maxIter; it++) {
    const bbox = bboxEntorno(lon, lat, half);
    // presupuesto de celdas alto para mantener resolución (divisorias) al expandir
    const maxDim = Math.min((opts.maxDim ?? 420) + Math.round(half * 700), 1100);
    onProgress?.(`Descargando relieve (±${(half * 111).toFixed(0)} km)…`);
    grid = await fetchDEM(bbox, { maxDim });           // baja sus propios tiles (con fallback de zoom)
    onProgress?.(`Delineando cuenca (z${grid.zoom}, ${grid.nx}×${grid.ny}, ±${(half * 111).toFixed(0)} km)…`);
    res = delinear(grid, lon, lat, { snapMeters: opts.snapMeters ?? 300, canalKm2: opts.canalKm2 ?? 0.05 });
    // mientras la cuenca TOQUE el borde, amplía (sin truncar) hasta tamaño región
    if (res.tocaBorde && half < maxHalf) { half *= 2.2; continue; }
    break;
  }
  // truncada = agotó el DEM local y la cuenca aún se sale → es grande (usar HydroBASINS)
  const truncada = !!res.tocaBorde;
  return { ...res, grid, half, iteraciones: it + 1, truncada };
}
