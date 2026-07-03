// ─────────────────────────────────────────────────────────────────────────────
// red_drenaje.js — red de drenaje / afluentes desde el DEM (koi-flow).
// Como el "channel network" de QGIS: rellena depresiones, calcula direcciones y
// ACUMULACIÓN de flujo, y traza como líneas las celdas cuyo aporte supera un umbral
// (área de drenaje mínima). Sirve para (a) VER los cauces/afluentes en el mapa y
// (b) pinchar el punto justo sobre el cauce correcto. Reusa el D8 de delineacion.js.
// ─────────────────────────────────────────────────────────────────────────────
import { routD8, cellSize, colRowToLonLat, lonLatToColRow, snapOutlet, watershed } from './delineacion.js?v=8';

// Extrae la red de drenaje de una grilla DEM (formato fetchDEM).
//   opts.umbralKm2: área de drenaje mínima para considerar "cauce" (def 0.25 km²).
// Devuelve GeoJSON FeatureCollection de LineStrings (segmentos celda→receptor),
// cada uno con { accum, areaKm2 } para estilar (más grueso = cauce mayor).
export function extraerRed(grid, opts = {}) {
  const rout = routD8(grid);                       // MISMO ruteo que usará la delineación
  const { elev, recv, accum } = rout;
  const { nx, ny } = grid;
  const cs = cellSize(grid);
  const cellKm2 = (cs.dx * cs.dy) / 1e6;
  const thr = Math.max(4, Math.round((opts.umbralKm2 ?? 0.25) / cellKm2));
  let maxA = 0;
  for (let i = 0; i < accum.length; i++) if (accum[i] > maxA) maxA = accum[i];

  const feats = [];
  for (let i = 0; i < nx * ny; i++) {
    if (accum[i] < thr) continue;
    const r = recv[i];
    if (r < 0 || accum[r] < thr) continue;           // el receptor también es cauce
    const c0 = i % nx, r0 = (i - c0) / nx;
    const c1 = r % nx, r1 = (r - c1) / nx;
    const a = colRowToLonLat(grid, c0, r0);
    const b = colRowToLonLat(grid, c1, r1);
    feats.push({
      type: 'Feature',
      properties: { accum: accum[i], areaKm2: +(accum[i] * cellKm2).toFixed(3) },
      geometry: { type: 'LineString', coordinates: [a, b] },
    });
  }
  const fc = {
    type: 'FeatureCollection', features: feats,
    meta: { umbralKm2: opts.umbralKm2 ?? 0.25, thr, cellKm2, maxAreaKm2: +(maxA * cellKm2).toFixed(1), nSeg: feats.length, zoom: grid.zoom, nx, ny },
  };
  // adjunta el grid y el ruteo para que la delineación RESPETE estos mismos flujos
  fc.rout = rout; fc.grid = grid;
  return fc;
}

// Traza SOLO el cauce del punto pinchado, no toda la red: aguas arriba dibuja el
// ÁRBOL DENDRÍTICO COMPLETO que aporta al punto (tronco + bifurcaciones + todos los
// afluentes = red ∩ cuenca del punto), y aguas abajo una sola línea hasta el borde
// (en D8 cada celda tiene un único receptor). El umbral (área mínima de cauce) se
// puede mover en vivo sin re-rutear: la máscara y la acumulación ya están calculadas.
//   grid: DEM (formato fetchDEM) · rout: {elev,recv,accum} de routD8 (cacheable)
//   lon,lat: punto pinchado · opts.umbralKm2 (def 0.05) · opts.snapMeters (def 90)
// Devuelve GeoJSON FeatureCollection (LineStrings con {accum, areaKm2, aguasAbajo}),
// con meta.outlet [lon,lat] y meta.areaKm2 (cuenca aportante al punto).
export function trazarCauce(grid, rout, lon, lat, opts = {}) {
  const { recv, accum } = rout;
  const { nx, ny } = grid;
  const cs = cellSize(grid);
  const cellKm2 = (cs.dx * cs.dy) / 1e6;
  const avg = (cs.dx + cs.dy) / 2;
  const thr = Math.max(2, Math.round((opts.umbralKm2 ?? 0.05) / cellKm2));

  // 1) engancha el clic al cauce (celda de máxima acumulación cercana).
  let [col, row] = lonLatToColRow(grid, lon, lat);
  col = Math.max(0, Math.min(nx - 1, col));
  row = Math.max(0, Math.min(ny - 1, row));
  const radius = Math.max(1, Math.round((opts.snapMeters ?? 90) / avg));
  const outlet = snapOutlet(grid, accum, col, row, radius, thr);

  // 2) máscara de la cuenca aportante al punto (BFS de donantes, igual que delinear).
  const { mask, count } = watershed(grid, recv, outlet);

  const feats = [];
  const seg = (a, b, extra) => {
    const c0 = a % nx, r0 = (a - c0) / nx, c1 = b % nx, r1 = (b - c1) / nx;
    feats.push({
      type: 'Feature',
      properties: { accum: accum[a], areaKm2: +(accum[a] * cellKm2).toFixed(3), ...extra },
      geometry: { type: 'LineString', coordinates: [colRowToLonLat(grid, c0, r0), colRowToLonLat(grid, c1, r1)] },
    });
  };

  // 3) aguas ARRIBA: todos los cauces DENTRO de la máscara (árbol completo).
  for (let i = 0; i < nx * ny; i++) {
    if (!mask[i] || accum[i] < thr) continue;
    const r = recv[i];
    if (r < 0 || !mask[r]) continue;         // el receptor también es cauce de la cuenca
    seg(i, r, { aguasAbajo: false });
  }

  // 4) aguas ABAJO: una sola línea siguiendo el receptor hasta el borde.
  let i = outlet, pasos = 0;
  while (recv[i] >= 0 && pasos++ < nx * ny) { seg(i, recv[i], { aguasAbajo: true }); i = recv[i]; }

  let maxA = 0; for (const f of feats) if (f.properties.accum > maxA) maxA = f.properties.accum;
  const fc = {
    type: 'FeatureCollection', features: feats,
    meta: {
      outlet: colRowToLonLat(grid, outlet % nx, (outlet - outlet % nx) / nx),
      areaKm2: +(count * cellKm2).toFixed(2), umbralKm2: opts.umbralKm2 ?? 0.05,
      thr, cellKm2, maxAreaKm2: +(maxA * cellKm2).toFixed(1), nSeg: feats.length,
      zoom: grid.zoom, tocaBorde: false,
    },
  };
  fc.rout = rout; fc.grid = grid;
  return fc;
}
