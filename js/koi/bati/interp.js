// ─────────────────────────────────────────────────────────────────────────────
// interp.js — construye un DEM a partir de la geometría CAD (koi-flow, Fase 4).
//
// Dos caminos, elegidos automáticamente:
//   • MALLA TIN (3DFACE): rasteriza cada triángulo por interpolación baricéntrica
//     → DEM exacto (lo que traen muchas topografías: la "malla" del terreno).
//   • CURVAS + PUNTOS: quema las cotas en la grilla y rellena por relajación de
//     Laplace (∇²z=0) — el clásico "curvas de nivel → raster".
//
// Trabaja en las COORDENADAS MÉTRICAS del CAD (UTM). El DEM métrico resultante se
// exporta a HEC-RAS tal cual (con su .prj) y se convierte a lon/lat para mostrarlo
// en koi-flow con `demMetricoAGrid` (place-and-drop scale-true, ver place.js).
// ─────────────────────────────────────────────────────────────────────────────

// bbox robusto (descarta outliers por percentil; hay DXF con puntos GPS lejanos).
export function bboxRobusto(pts, pctl = 0.004) {
  const xs = [], ys = [];
  for (const p of pts) { if (Number.isFinite(p.x) && Number.isFinite(p.y)) { xs.push(p.x); ys.push(p.y); } }
  if (!xs.length) return null;
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.max(0, Math.min(arr.length - 1, Math.round(f * (arr.length - 1))))];
  return { minx: q(xs, pctl), maxx: q(xs, 1 - pctl), miny: q(ys, pctl), maxy: q(ys, 1 - pctl) };
}

// Rasteriza un triángulo (p0,p1,p2 con {x,y,z}) en la grilla por baricéntricas.
function rasterTri(p0, p1, p2, g) {
  const { x0, y0, dx, dy, nx, ny, data, mask } = g;
  const minX = Math.min(p0.x, p1.x, p2.x), maxX = Math.max(p0.x, p1.x, p2.x);
  const minY = Math.min(p0.y, p1.y, p2.y), maxY = Math.max(p0.y, p1.y, p2.y);
  let c0 = Math.floor((minX - x0) / dx), c1 = Math.ceil((maxX - x0) / dx);
  let r0 = Math.floor((minY - y0) / dy), r1 = Math.ceil((maxY - y0) / dy);
  c0 = Math.max(0, c0); c1 = Math.min(nx - 1, c1); r0 = Math.max(0, r0); r1 = Math.min(ny - 1, r1);
  const den = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
  if (Math.abs(den) < 1e-9) return;
  for (let r = r0; r <= r1; r++) {
    const py = y0 + r * dy;
    for (let c = c0; c <= c1; c++) {
      const px = x0 + c * dx;
      const a = ((p1.y - p2.y) * (px - p2.x) + (p2.x - p1.x) * (py - p2.y)) / den;
      const b = ((p2.y - p0.y) * (px - p2.x) + (p0.x - p2.x) * (py - p2.y)) / den;
      const cc = 1 - a - b;
      if (a < -1e-6 || b < -1e-6 || cc < -1e-6) continue;
      const z = a * p0.z + b * p1.z + cc * p2.z;
      const idx = r * nx + c;
      data[idx] = z; mask[idx] = 1;
    }
  }
}

// Quema una polilínea/segmento de cota constante en los nodos que atraviesa.
function burnLinea(pts, g) {
  const { x0, y0, dx, dy, nx, ny, data, mask } = g;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / Math.min(dx, dy)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + t * (b.x - a.x), y = a.y + t * (b.y - a.y);
      const z = a.z + t * (b.z - a.z);
      const c = Math.round((x - x0) / dx), r = Math.round((y - y0) / dy);
      if (c < 0 || c >= nx || r < 0 || r >= ny) continue;
      const idx = r * nx + c; data[idx] = z; mask[idx] = 2;   // 2 = dato duro (Dirichlet)
    }
  }
}

// Rellena los nodos libres por relajación de Laplace (SOR) con contorno Neumann.
function laplaceFill(g, iters = 300, omega = 1.7) {
  const { nx, ny, data, mask } = g;
  // semilla: media de los datos duros
  let s = 0, ns = 0;
  for (let i = 0; i < data.length; i++) if (mask[i]) { s += data[i]; ns++; }
  const seed = ns ? s / ns : 0;
  for (let i = 0; i < data.length; i++) if (!mask[i]) data[i] = seed;
  for (let it = 0; it < iters; it++) {
    let maxd = 0;
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const idx = r * nx + c;
        if (mask[idx]) continue;
        const up = data[(r > 0 ? r - 1 : r) * nx + c];
        const dn = data[(r < ny - 1 ? r + 1 : r) * nx + c];
        const lf = data[r * nx + (c > 0 ? c - 1 : c)];
        const rt = data[r * nx + (c < nx - 1 ? c + 1 : c)];
        const nv = (1 - omega) * data[idx] + omega * 0.25 * (up + dn + lf + rt);
        const d = Math.abs(nv - data[idx]); if (d > maxd) maxd = d;
        data[idx] = nv;
      }
    }
    if (maxd < 1e-4) break;
  }
}

// Rellena huecos del TIN (nodos sin dato dentro del casco) por Laplace acotado.
function fillHoles(g, iters = 120) {
  const { data, mask, nx, ny } = g;
  // huecos = nodos sin dato pero rodeados de datos (vecindad); Laplace sólo ahí
  let hay = false;
  for (let i = 0; i < mask.length; i++) if (!mask[i]) { hay = true; break; }
  if (!hay) return;
  laplaceFill(g, iters, 1.6);
}

// Construye el DEM métrico desde el resultado del DXF y las capas elegidas.
//   res: salida de parseDXF; capasSel: nombres de capas de terreno.
//   opts: { paso (m), metodo:'auto'|'tin'|'curvas', iters, maxNodos }
export function construirDEMmetrico(res, capasSel, opts = {}) {
  const sel = new Set(capasSel);
  const caras = [], nube = [], curvas = [];
  for (const e of res.entidades) {
    if (!sel.has(e.capa)) continue;
    if (e.tipo === 'cara' && e.puntos.length >= 3) caras.push(e.puntos);
    else if (e.tipo === 'polilinea' && e.puntos.length > 1) { curvas.push(e.puntos); for (const p of e.puntos) nube.push(p); }
    else if (e.tipo === 'punto') nube.push(e.puntos[0]);
    else if (e.tipo === 'texto' && opts.usarCotasTexto && Number.isFinite(e.valor)) nube.push({ x: e.puntos[0].x, y: e.puntos[0].y, z: e.valor });
  }
  const fuente = caras.length ? [].concat(...caras) : nube;
  const bb = bboxRobusto(fuente.length ? fuente : nube);
  if (!bb) throw new Error('No hay geometría con cota en las capas elegidas.');
  const W = bb.maxx - bb.minx, H = bb.maxy - bb.miny;
  // paso: por defecto ~ lado/400, acotado por maxNodos
  const maxNodos = opts.maxNodos || 500000;
  let paso = opts.paso || Math.max(0.5, Math.max(W, H) / 400);
  while (((W / paso + 1) * (H / paso + 1)) > maxNodos) paso *= 1.3;
  const nx = Math.max(2, Math.round(W / paso) + 1);
  const ny = Math.max(2, Math.round(H / paso) + 1);
  const dx = W / (nx - 1), dy = H / (ny - 1);
  const g = { x0: bb.minx, y0: bb.miny, dx, dy, nx, ny, data: new Float32Array(nx * ny), mask: new Uint8Array(nx * ny) };

  const metodo = opts.metodo === 'auto' || !opts.metodo ? (caras.length ? 'tin' : 'curvas') : opts.metodo;
  if (metodo === 'tin' && caras.length) {
    for (const f of caras) {
      // triangula el 3DFACE (abanico), deduplicando el 4º == 3º
      const p = f.filter((q, i) => i === 0 || Math.hypot(q.x - f[i - 1].x, q.y - f[i - 1].y) > 1e-6);
      for (let i = 1; i < p.length - 1; i++) rasterTri(p[0], p[i], p[i + 1], g);
    }
    fillHoles(g, opts.iters || 120);
  } else {
    for (const c of curvas) burnLinea(c, g);
    for (const p of nube) {
      const cc = Math.round((p.x - g.x0) / dx), rr = Math.round((p.y - g.y0) / dy);
      if (cc >= 0 && cc < nx && rr >= 0 && rr < ny) { const i = rr * nx + cc; if (g.mask[i] !== 2) { g.data[i] = p.z; g.mask[i] = 2; } }
    }
    laplaceFill(g, opts.iters || 400);
  }

  let zmin = Infinity, zmax = -Infinity, nvac = 0;
  for (let i = 0; i < g.data.length; i++) { if (!g.mask[i]) nvac++; const v = g.data[i]; if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  return {
    nx, ny, x0: g.x0, y0: g.y0, dx, dy, paso,
    data: g.data, mask: g.mask, zmin, zmax,
    cx: g.x0 + W / 2, cy: g.y0 + H / 2,
    ancho: W, alto: H, metodo, nCaras: caras.length, nPuntos: nube.length,
  };
}
