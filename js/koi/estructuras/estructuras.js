// ─────────────────────────────────────────────────────────────────────────────
// estructuras.js — estructuras hidráulicas de koi-flow (puentes, alcantarillas,
// defensas). Cada pieza es un POLÍGONO simple en planta (o centro+dimensiones)
// con parámetros NUMÉRICOS editables + cota base (elevable al terreno) + alto.
//
// Integración fiel a HEC-RAS:
//  • 2D → `stampTerreno`: las piezas SÓLIDAS (pilas, estribos, defensas) se "queman"
//    en el DEM subiendo la cota (criterio "Higher value") antes de mallar → el flujo
//    las rodea, tal como RAS Mapper (Terrain Modification / shapes).
//  • 1D → `pilaEnSeccion`: una pila que cruza una sección la ANGOSTA y aporta el
//    ancho de pila `a` a la socavación local (5 métodos MC).
// ─────────────────────────────────────────────────────────────────────────────

let _seq = 0;

// Catálogo de piezas con sus parámetros por defecto (m) y si son SÓLIDAS (bloquean).
export const TIPOS = {
  tablero:    { label: 'Tablero de puente', solido: false, params: { largo: 8, ancho: 30, espesor: 1.2, luzLibre: 2.5, rot: 0 }, forma: 'rect' },
  viga:       { label: 'Viga bajo tablero', solido: false, params: { largo: 30, ancho: 1.0, alto: 1.5, rot: 0 }, forma: 'rect' },
  pila_circ:  { label: 'Pila circular',     solido: true,  params: { diametro: 1.5, alto: 6, rot: 0 }, forma: 'circ' },
  pila_rect:  { label: 'Pila rectangular',  solido: true,  params: { ancho: 1.5, largo: 4, alto: 6, rot: 0 }, forma: 'rect' },
  estribo:    { label: 'Estribo de hormigón', solido: true, params: { largo: 8, ancho: 3, alto: 6, rot: 0 }, forma: 'rect' },
  defensa:    { label: 'Defensa fluvial',   solido: true,  params: { alto: 3, ancho: 2 }, forma: 'linea' },
  alcantarilla: { label: 'Alcantarilla',    solido: true,  params: { ancho: 2, largo: 8, alto: 2, rot: 0 }, forma: 'rect' },
};

const RAD = Math.PI / 180;
const mPerLon = (lat) => 111320 * Math.cos(lat * RAD);
const mPerLat = () => 110540;

export function crearEstructura(tipo, center) {
  const def = TIPOS[tipo]; if (!def) throw new Error('Tipo desconocido: ' + tipo);
  const e = {
    id: ++_seq, tipo, nombre: `${def.label} ${_seq}`, forma: def.forma, solido: def.solido,
    center: center ? [center[0], center[1]] : null, planta: null,
    params: { ...def.params }, dz: 0, zBase: null,
  };
  if (e.center) e.planta = plantaDe(e);
  return e;
}

// (Re)genera la huella (planta) desde centro + dimensiones + rotación.
export function plantaDe(e) {
  if (e.forma === 'linea') return e.planta;   // se dibuja a mano
  if (!e.center) return e.planta;
  const [lo, la] = e.center, mx = mPerLon(la), my = mPerLat();
  const rot = (e.params.rot || 0) * RAD, cs = Math.cos(rot), sn = Math.sin(rot);
  const toLL = (dx, dy) => [lo + (dx * cs - dy * sn) / mx, la + (dx * sn + dy * cs) / my];
  if (e.forma === 'circ') {
    const r = (e.params.diametro || 1) / 2, n = 24, pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; pts.push(toLL(r * Math.cos(a), r * Math.sin(a))); }
    return pts;
  }
  // rect: largo (x, a lo largo) × ancho (y, transversal)
  const L = (e.params.largo || 1) / 2, W = (e.params.ancho || 1) / 2;
  return [toLL(-L, -W), toLL(L, -W), toLL(L, W), toLL(-L, W)];
}

// ── Geometría ────────────────────────────────────────────────────────────────
export function puntoEnPoligono(lon, lat, poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dentro = !dentro;
  }
  return dentro;
}
function bboxDe(poly) {
  let w = 180, e = -180, s = 90, n = -90;
  for (const [lo, la] of poly) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
  return { w, e, s, n };
}

// Cota base del terreno bajo la huella (mínimo de las muestras) → elevar al terreno.
export function elevarAlTerreno(e, grid, elevAt) {
  const poly = e.forma === 'linea' ? e.planta : plantaDe(e);
  if (!poly || !poly.length) return null;
  let zmin = Infinity;
  for (const [lo, la] of poly) { const z = elevAt(grid, lo, la); if (isFinite(z)) zmin = Math.min(zmin, z); }
  // también el centroide
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const zc = elevAt(grid, cx, cy); if (isFinite(zc)) zmin = Math.min(zmin, zc);
  e.zBase = isFinite(zmin) ? zmin : 0;
  return e.zBase;
}

// Cota "sólida" de la pieza para estampar el terreno = base + dz + alto.
function cotaSolida(e) {
  const base = (e.zBase ?? 0) + (e.dz || 0);
  const alto = e.params.alto || e.params.espesor || 2;
  return base + alto;
}

// 2D: estampa las piezas SÓLIDAS en el DEM (Higher value). Devuelve una COPIA del grid.
export function stampTerreno(grid, estructuras) {
  if (!grid?.data) return grid;
  const solidas = (estructuras || []).filter((e) => e.solido && (e.forma === 'linea' ? e.planta : e.center));
  if (!solidas.length) return grid;
  const { nx, ny } = grid, b = grid.bbox;
  const data = grid.data.slice ? grid.data.slice() : Float32Array.from(grid.data);
  for (const e of solidas) {
    const poly = e.forma === 'linea' ? bufferLinea(e.planta, (e.params.ancho || 2) / 2) : plantaDe(e);
    if (!poly || poly.length < 3) continue;
    const z = cotaSolida(e), bb = bboxDe(poly);
    const c0 = Math.max(0, Math.floor((bb.w - b.west) / (b.east - b.west) * (nx - 1)));
    const c1 = Math.min(nx - 1, Math.ceil((bb.e - b.west) / (b.east - b.west) * (nx - 1)));
    const r0 = Math.max(0, Math.floor((b.north - bb.n) / (b.north - b.south) * (ny - 1)));
    const r1 = Math.min(ny - 1, Math.ceil((b.north - bb.s) / (b.north - b.south) * (ny - 1)));
    for (let r = r0; r <= r1; r++) {
      const lat = b.north - r / (ny - 1) * (b.north - b.south);
      for (let c = c0; c <= c1; c++) {
        const lon = b.west + c / (nx - 1) * (b.east - b.west);
        if (puntoEnPoligono(lon, lat, poly)) { const i = r * nx + c; if (z > data[i]) data[i] = z; }
      }
    }
  }
  const g2 = { ...grid, data, _stamped: true };
  let zmin = Infinity, zmax = -Infinity;
  for (const v of data) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  g2.zmin = zmin; g2.zmax = zmax;
  return g2;
}

// Buffer simple de una polilínea a un polígono (para defensas dibujadas).
function bufferLinea(linea, r) {
  if (!linea || linea.length < 2) return null;
  const la = linea[0][1], mx = mPerLon(la), my = mPerLat();
  const izq = [], der = [];
  for (let i = 0; i < linea.length; i++) {
    const a = linea[Math.max(0, i - 1)], b = linea[Math.min(linea.length - 1, i + 1)];
    let dx = (b[0] - a[0]) * mx, dy = (b[1] - a[1]) * my; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const nx = -dy, nyv = dx;   // normal
    izq.push([linea[i][0] + nx * r / mx, linea[i][1] + nyv * r / my]);
    der.push([linea[i][0] - nx * r / mx, linea[i][1] - nyv * r / my]);
  }
  return [...izq, ...der.reverse()];
}

// ¿Hay un TABLERO sobre esta pieza (su huella la cubre)? Devuelve el tablero o null.
// Sirve para que pilas/estribos/vigas topen en la cara inferior del tablero.
export function tableroSobre(e, estructuras) {
  if (e.tipo === 'tablero') return null;
  const c = e.center || (e.planta && e.planta[0]); if (!c) return null;
  for (const t of (estructuras || [])) {
    if (t.tipo !== 'tablero' || t === e) continue;
    const poly = plantaDe(t);
    if (poly && puntoEnPoligono(c[0], c[1], poly)) return t;
  }
  return null;
}

// 1D: ¿la pieza (pila) cruza una sección? Devuelve el ancho transversal que bloquea.
export function pilaEnSeccion(e, seccionLinea) {
  if (!(e.tipo === 'pila_circ' || e.tipo === 'pila_rect') || !e.center) return 0;
  const poly = plantaDe(e);
  // ¿algún tramo de la sección entra en la huella de la pila?
  for (const [lo, la] of seccionLinea) if (puntoEnPoligono(lo, la, poly)) return e.tipo === 'pila_circ' ? e.params.diametro : e.params.ancho;
  // o el centro de la pila muy cerca de la línea
  const la0 = seccionLinea[0][1], mx = mPerLon(la0), my = mPerLat();
  let dmin = Infinity;
  for (let i = 0; i < seccionLinea.length - 1; i++) {
    const ax = seccionLinea[i][0] * mx, ay = seccionLinea[i][1] * my, bx = seccionLinea[i + 1][0] * mx, by = seccionLinea[i + 1][1] * my;
    const px = e.center[0] * mx, py = e.center[1] * my, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
    dmin = Math.min(dmin, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  const r = (e.tipo === 'pila_circ' ? e.params.diametro : e.params.ancho) / 2;
  return dmin <= r ? (e.tipo === 'pila_circ' ? e.params.diametro : e.params.ancho) : 0;
}
