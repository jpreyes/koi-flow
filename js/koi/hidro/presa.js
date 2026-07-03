// ─────────────────────────────────────────────────────────────────────────────
// presa.js — VASO de embalse / depósito de relaves desde el DEM (koi-flow).
// Responde "cómo sabe el DEM dónde está el embalse/relave": dada la posición de la
// presa (sobre el cauce) y un NIVEL de embalse (cota del pelo de agua), el vaso es el
// llenado tipo "bañera" AGUAS ARRIBA del muro: se engancha la presa al cauce (máxima
// acumulación), se toma su cuenca aportante (watershed, aguas arriba → no rebalsa por
// aguas abajo) y dentro de ella se inundan las celdas conectadas con cota < nivel.
//   Volumen = Σ (nivel − z)·áreaCelda   ·   Área = Σ áreaCelda
// Barriendo el nivel se obtiene la CURVA ALTURA–VOLUMEN, que alimenta el embalse (Puls)
// y la rotura de presa (Vw de Froehlich). Reusa el ruteo D8 de la delineación.
// ─────────────────────────────────────────────────────────────────────────────
import { cellSize, lonLatToColRow, snapOutlet, watershed, maskToPolygon } from '../cuenca/delineacion.js?v=3';

const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Engancha la presa al cauce (celda de máxima acumulación cercana) y devuelve el
// índice del "muro" + la cota del lecho ahí (cota base del vaso).
export function engancharPresa(grid, rout, lon, lat, snapCeldas = 3) {
  const { nx, ny } = grid;
  let [c0, r0] = lonLatToColRow(grid, lon, lat);
  c0 = clamp(c0, 0, nx - 1); r0 = clamp(r0, 0, ny - 1);
  const outlet = snapOutlet(grid, rout.accum, c0, r0, snapCeldas, 0);
  return { outlet, zBase: rout.elev[outlet] };
}

// Vaso a un NIVEL de embalse dado. Devuelve { mask, volumen[m³], area[m²], polygon, nivel }.
export function vasoANivel(grid, rout, lon, lat, nivel, opts = {}) {
  const { nx, ny } = grid;
  const elev = rout.elev;                                   // DEM con depresiones rellenadas
  const cs = cellSize(grid); const cellArea = cs.dx * cs.dy;
  const { outlet } = engancharPresa(grid, rout, lon, lat, opts.snapCeldas ?? 3);
  const { mask: cuenca } = watershed(grid, rout.recv, outlet);   // aguas arriba del muro
  const mask = new Uint8Array(nx * ny);
  if (elev[outlet] >= nivel) return { mask, volumen: 0, area: 0, nivel, count: 0, outlet, polygon: [] };
  const st = [outlet]; mask[outlet] = 1;
  let vol = 0, area = 0, count = 0;
  while (st.length) {
    const i = st.pop(), c = i % nx, r = (i - c) / nx, z = elev[i];
    vol += (nivel - z) * cellArea; area += cellArea; count++;
    for (const [dc, dr] of N4) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
      const j = rr * nx + cc;
      if (!mask[j] && cuenca[j] && elev[j] < nivel) { mask[j] = 1; st.push(j); }
    }
  }
  const polygon = count ? maskToPolygon(grid, mask) : [];
  return { mask, volumen: vol, area, nivel, count, outlet, polygon };
}

// Curva Altura–Volumen: barre el nivel desde la cota base del cauce hasta zMax.
//   Devuelve { zBase, curva:[{ z, nivel, volumen, area }], vasoMax }.
export function curvaAlturaVolumen(grid, rout, lon, lat, opts = {}) {
  const { outlet, zBase } = engancharPresa(grid, rout, lon, lat, opts.snapCeldas ?? 3);
  const alturaMax = opts.alturaMax ?? 60;                   // altura de muro [m] sobre el lecho
  const dz = opts.dz ?? 2;
  const curva = [];
  let vasoMax = null;
  for (let h = dz; h <= alturaMax + 1e-9; h += dz) {
    const v = vasoANivel(grid, rout, lon, lat, zBase + h, opts);
    curva.push({ z: +(zBase + h).toFixed(2), altura: +h.toFixed(2), volumen: v.volumen, area: v.area });
    vasoMax = v;
  }
  return { zBase, outlet, curva, vasoMax };
}
