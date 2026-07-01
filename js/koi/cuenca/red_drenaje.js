// ─────────────────────────────────────────────────────────────────────────────
// red_drenaje.js — red de drenaje / afluentes desde el DEM (koi-flow).
// Como el "channel network" de QGIS: rellena depresiones, calcula direcciones y
// ACUMULACIÓN de flujo, y traza como líneas las celdas cuyo aporte supera un umbral
// (área de drenaje mínima). Sirve para (a) VER los cauces/afluentes en el mapa y
// (b) pinchar el punto justo sobre el cauce correcto. Reusa el D8 de delineacion.js.
// ─────────────────────────────────────────────────────────────────────────────
import { routD8, cellSize, colRowToLonLat } from './delineacion.js?v=2';

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
