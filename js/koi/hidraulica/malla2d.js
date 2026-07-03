// ─────────────────────────────────────────────────────────────────────────────
// malla2d.js — malla de cálculo 2D del dominio inundable (koi-flow, Fase 5A).
// Dado el POLÍGONO del dominio y la POLILÍNEA del cauce (ambos dibujados por el
// usuario en lon/lat) + el DEM (fusionado), genera una malla triangular refinada
// EN EL CAUCE (más fina cerca de la polilínea), muestrea la cota z de cada nodo del
// DEM y asigna la rugosidad de Manning por zona (cauce vs planicie). Reusa los
// mesheadores de portico-core (js/lib/portico). Trabaja en métrico local (equirect).
// ─────────────────────────────────────────────────────────────────────────────
import { earClip, delaunayFlips, adaptiveRefine } from '../../lib/portico/mesh_free.js?v=4';
import { boundaryNodes, laplacianSmooth } from '../../lib/portico/mesh_quality.js?v=4';
import { elevAt } from './secciones.js?v=4';

// distancia de (x,y) al segmento a-b (métrico).
function distSeg(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx, py = ay + t * dy;
  return Math.hypot(x - px, y - py);
}
function distPolilinea(x, y, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}

// Construye la malla 2D. dominioLL: [[lon,lat]…] (anillo); cauceLL: [[lon,lat]…] (polilínea).
//   demGrid: grilla koi-flow {nx,ny,bbox,data} para muestrear z. opts: tamaños y rugosidades.
export function construirMalla2D(dominioLL, cauceLL, demGrid, opts = {}) {
  const { hCauce = 8, hPlanicie = 40, anchoCauce = 30, nCauce = 0.035, nPlanicie = 0.06, suavizar = true } = opts;
  if (!dominioLL || dominioLL.length < 3) throw new Error('Dibuja el polígono del dominio (≥3 vértices).');

  // origen y proyección equirectangular local
  let lon0 = 0, lat0 = 0;
  for (const [lo, la] of dominioLL) { lon0 += lo; lat0 += la; }
  lon0 /= dominioLL.length; lat0 /= dominioLL.length;
  const mLon = 111320 * Math.cos(lat0 * Math.PI / 180), mLat = 110540;
  const toXY = (lo, la) => [(lo - lon0) * mLon, (la - lat0) * mLat];
  const toLL = (x, y) => [lon0 + x / mLon, lat0 + y / mLat];

  // dominio en métrico (sin el vértice de cierre duplicado)
  const V = dominioLL.map(([lo, la]) => toXY(lo, la));
  if (V.length > 1 && Math.hypot(V[0][0] - V[V.length - 1][0], V[0][1] - V[V.length - 1][1]) < 1e-6) V.pop();
  const polyIdx = V.map((_, i) => i);

  const cauceXY = (cauceLL && cauceLL.length > 1) ? cauceLL.map(([lo, la]) => toXY(lo, la)) : null;
  const distC = (x, y) => cauceXY ? distPolilinea(x, y, cauceXY) : hPlanicie * 10;
  // tamaño objetivo: fino en el cauce, crece hacia la planicie
  const targetFn = (x, y) => Math.min(hPlanicie, hCauce + 0.6 * Math.max(0, distC(x, y) - anchoCauce / 2));

  let tris = earClip(V, polyIdx);
  tris = delaunayFlips(V, tris);
  tris = adaptiveRefine(V, tris, targetFn, {});     // V crece in place; devuelve tris
  const bset = boundaryNodes(V, tris);              // Set de nodos de borde
  if (suavizar) {                                   // suaviza sin mover el borde (nodos 3D)
    const sm = laplacianSmooth(V.map(([x, y]) => [x, y, 0]), tris, { iters: 3, fixed: bset }).nodes;
    for (let i = 0; i < V.length; i++) { V[i][0] = sm[i][0]; V[i][1] = sm[i][1]; }
  }

  // nodos con lon/lat, cota z (DEM) y rugosidad n por zona
  const nodes = V.map(([x, y], i) => {
    const [lon, lat] = toLL(x, y);
    const z = demGrid ? elevAt(demGrid, lon, lat) : 0;
    const d = distC(x, y);
    const enCauce = d <= anchoCauce / 2;
    return { i, x, y, lon, lat, z, n: enCauce ? nCauce : nPlanicie, enCauce, borde: bset.has(i) };
  });

  // área total y de cauce (para reporte)
  let area = 0, areaCauce = 0;
  for (const t of tris) {
    const a = V[t[0]], b = V[t[1]], c = V[t[2]];
    const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    area += ar;
    if (nodes[t[0]].enCauce || nodes[t[1]].enCauce || nodes[t[2]].enCauce) areaCauce += ar;
  }
  return {
    nodes, tris, boundary: [...bset], origin: { lon0, lat0, mLon, mLat }, cauceXY,
    toLL, meta: { nNodos: nodes.length, nTri: tris.length, area_m2: area, areaCauce_m2: areaCauce, hCauce, hPlanicie, anchoCauce },
  };
}
