// ─────────────────────────────────────────────────────────────────────────────
// fusion.js — fusiona la batimetría CAD con el DEM base (koi-flow, Fase 4).
// Genera una grilla (formato koi-flow) que cubre el footprint de la batimetría + un
// margen: DENTRO del footprint manda la batimetría densa (cota real + dz de
// colocación), FUERA manda el relieve base (Terrarium), y en el BORDE se mezclan
// suavemente (feather) para que no haya un escalón. Así en el 3D se ve el cauce
// levantado desde la topografía real, embebido en los cerros del entorno.
// ─────────────────────────────────────────────────────────────────────────────
import { elevAt } from '../hidraulica/secciones.js?v=7';
import { metricoDesdeLonLat, lonLatDesdeMetrico, elevAtMetrico } from './place.js?v=7';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// bbox lon/lat del footprint del DEM métrico colocado en `anchor`.
function footprintBbox(demM, anchor) {
  const c = [
    lonLatDesdeMetrico(demM, anchor, demM.x0, demM.y0),
    lonLatDesdeMetrico(demM, anchor, demM.x0 + demM.ancho, demM.y0),
    lonLatDesdeMetrico(demM, anchor, demM.x0 + demM.ancho, demM.y0 + demM.alto),
    lonLatDesdeMetrico(demM, anchor, demM.x0, demM.y0 + demM.alto),
  ];
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of c) { w = Math.min(w, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
  return { west: w, south: s, east: e, north: n };
}

// Fusiona baseGrid (koi-flow {nx,ny,bbox,data}) + DEM métrico batimetría.
//   anchor, dz: colocación (place.demMetricoAGrid). opts.margen: fracción del
//   footprint a cada lado; opts.feather: ancho de mezcla en el borde [m]; opts.maxDim.
export function fusionar(baseGrid, demM, anchor, dz = 0, opts = {}) {
  const margen = opts.margen ?? 0.6;
  const feather = opts.feather ?? 25;
  const maxDim = opts.maxDim ?? 700;

  const fp = footprintBbox(demM, anchor);
  const dLon = fp.east - fp.west, dLat = fp.north - fp.south;
  const bbox = {
    west: fp.west - dLon * margen, east: fp.east + dLon * margen,
    south: fp.south - dLat * margen, north: fp.north + dLat * margen,
  };
  // resolución ~ la de la batimetría (para conservar su detalle), acotada por maxDim
  const Wm = demM.ancho * (1 + 2 * margen), Hm = demM.alto * (1 + 2 * margen);
  let nx = Math.min(maxDim, Math.max(2, Math.round(Wm / demM.dx)));
  let ny = Math.min(maxDim, Math.max(2, Math.round(Hm / demM.dy)));

  const data = new Float32Array(nx * ny);
  const x1 = demM.x0 + demM.ancho, y1 = demM.y0 + demM.alto;
  let nBaty = 0;
  for (let r = 0; r < ny; r++) {
    const lat = bbox.north - (r / (ny - 1)) * (bbox.north - bbox.south);   // fila 0 = norte
    for (let c = 0; c < nx; c++) {
      const lon = bbox.west + (c / (nx - 1)) * (bbox.east - bbox.west);
      const baseZ = elevAt(baseGrid, lon, lat);
      const m = metricoDesdeLonLat(demM, anchor, lon, lat);
      let z = baseZ;
      if (m.x >= demM.x0 && m.x <= x1 && m.y >= demM.y0 && m.y <= y1) {
        const batyZ = elevAtMetrico(demM, m.x, m.y, dz);
        // distancia al borde del footprint (m) → peso de mezcla
        const dEdge = Math.min(m.x - demM.x0, x1 - m.x, m.y - demM.y0, y1 - m.y);
        const w = clamp(dEdge / feather, 0, 1);
        z = w * batyZ + (1 - w) * baseZ;
        if (w > 0.5) nBaty++;
      }
      data[r * nx + c] = z;
    }
  }
  let zmin = Infinity, zmax = -Infinity;
  for (const v of data) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  return { nx, ny, bbox, data, zmin, zmax, nBaty, fusion: true };
}
