// ─────────────────────────────────────────────────────────────────────────────
// secciones.js — perfiles/secciones transversales desde el DEM (koi-flow, Fase 3).
// Muestrea la elevación del DEM a lo largo de una línea (el eje del camino que cruza
// la quebrada ≈ sección del puente) o de perpendiculares al cauce. Insumo del eje
// hidráulico (Manning) y de la socavación.
//   grid = { nx, ny, bbox:{west,south,east,north}, data:Float32Array }  (fila 0 = norte)
// ─────────────────────────────────────────────────────────────────────────────

const M_LAT = 110540;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Elevación (m) interpolada bilineal en la grilla, dada lon/lat.
export function elevAt(grid, lon, lat) {
  const { nx, ny, data } = grid, b = grid.bbox;
  let fx = clamp((lon - b.west) / (b.east - b.west) * (nx - 1), 0, nx - 1.001);
  let fy = clamp((b.north - lat) / (b.north - b.south) * (ny - 1), 0, ny - 1.001);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
  const g = (x, y) => data[y * nx + x];
  return g(x0, y0) * (1 - dx) * (1 - dy) + g(x0 + 1, y0) * dx * (1 - dy)
       + g(x0, y0 + 1) * (1 - dx) * dy + g(x0 + 1, y0 + 1) * dx * dy;
}

// Distancia en metros entre dos lon/lat (equirectangular local).
export function distm(a, b) {
  const latm = (a[1] + b[1]) / 2 * Math.PI / 180;
  return Math.hypot((b[0] - a[0]) * 111320 * Math.cos(latm), (b[1] - a[1]) * M_LAT);
}

// Perfil a lo largo de una polilínea (lon/lat): la remuestrea en `nptos` puntos
// equiespaciados y muestrea el DEM. Devuelve estaciones (s, m) vs cota (z, m).
export function perfilDesdeLinea(linea, grid, nptos = 120) {
  // longitudes acumuladas
  const acum = [0];
  for (let i = 1; i < linea.length; i++) acum.push(acum[i - 1] + distm(linea[i - 1], linea[i]));
  const largo = acum[acum.length - 1];
  const pts = [];
  for (let k = 0; k < nptos; k++) {
    const s = (k / (nptos - 1)) * largo;
    // ubica el segmento
    let i = 1; while (i < acum.length - 1 && acum[i] < s) i++;
    const t = (s - acum[i - 1]) / ((acum[i] - acum[i - 1]) || 1);
    const lon = linea[i - 1][0] + t * (linea[i][0] - linea[i - 1][0]);
    const lat = linea[i - 1][1] + t * (linea[i][1] - linea[i - 1][1]);
    pts.push({ s, lon, lat, z: elevAt(grid, lon, lat) });
  }
  return { puntos: pts, largo, zMin: Math.min(...pts.map((p) => p.z)), zMax: Math.max(...pts.map((p) => p.z)) };
}

// Sección perpendicular al cauce en un punto (lon,lat), dado el rumbo del cauce.
//   rumbo: vector unitario [dLon,dLat] del cauce; ancho: semiancho [m]; nptos.
export function perfilPerpendicular(centro, rumbo, grid, { ancho = 200, nptos = 81 } = {}) {
  const latm = centro[1] * Math.PI / 180;
  // perpendicular al rumbo, normalizado en metros
  let px = -rumbo[1], py = rumbo[0];
  const norm = Math.hypot(px * 111320 * Math.cos(latm), py * M_LAT) || 1;
  px /= norm; py /= norm;                     // ahora 1 unidad ≈ 1 m (en cada eje escalado)
  const pts = [];
  for (let k = 0; k < nptos; k++) {
    const off = -ancho + (2 * ancho) * (k / (nptos - 1));   // m desde el centro
    const lon = centro[0] + (px * off) / (111320 * Math.cos(latm));
    const lat = centro[1] + (py * off) / M_LAT;
    pts.push({ s: off + ancho, off, lon, lat, z: elevAt(grid, lon, lat) });
  }
  return { puntos: pts, largo: 2 * ancho, zMin: Math.min(...pts.map((p) => p.z)), zMax: Math.max(...pts.map((p) => p.z)) };
}
