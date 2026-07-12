// ─────────────────────────────────────────────────────────────────────────────
// delineacion.js — Delineación de cuencas D8 en el navegador (koi-flow, Fase 2).
// Dado un DEM (grilla regular) y un punto de salida (exutorio), calcula la cuenca
// que aporta a ese punto: relleno de depresiones (priority-flood + ε), direcciones
// de flujo D8, acumulación, ajuste del exutorio al cauce (mayor acumulación),
// cuenca aportante (aguas arriba del exutorio), polígono de la cuenca y morfometría
// (área, cauce principal L, pendiente S, desnivel H, Lg al centroide, perímetro).
//
// Grilla: { nx, ny, bbox:{west,south,east,north}, data:Float32Array }  (fila 0 = norte)
//   índice i = row*nx + col ; elevación data[i] en metros.
// ─────────────────────────────────────────────────────────────────────────────

const N8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

// Min-heap simple por prioridad numérica (elevación).
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, v) { const a = this.a; a.push({ p, v }); let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j].p <= a[i].p) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() { const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i;
      if (l < a.length && a[l].p < a[m].p) m = l; if (r < a.length && a[r].p < a[m].p) m = r;
      if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
}

// Tamaño de celda en metros (aprox., a la latitud media del DEM).
export function cellSize(grid) {
  const { bbox: b, nx, ny } = grid;
  const latm = (b.north + b.south) / 2;
  const dx = ((b.east - b.west) / nx) * 111320 * Math.cos(latm * Math.PI / 180);
  const dy = ((b.north - b.south) / ny) * 110540;
  return { dx: Math.abs(dx), dy: Math.abs(dy) };
}

export function colRowToLonLat(grid, col, row) {
  const { bbox: b, nx, ny } = grid;
  return [b.west + (col + 0.5) / nx * (b.east - b.west),
          b.north - (row + 0.5) / ny * (b.north - b.south)];
}
export function lonLatToColRow(grid, lon, lat) {
  const { bbox: b, nx, ny } = grid;
  return [Math.floor((lon - b.west) / (b.east - b.west) * nx),
          Math.floor((b.north - lat) / (b.north - b.south) * ny)];
}

// Relleno de depresiones (Priority-Flood + epsilon): garantiza que toda celda
// tenga salida descendente. Devuelve un Float32Array con elevaciones corregidas.
export function fillSinks(grid, eps = 1e-3) {
  const { nx, ny, data } = grid;
  const n = nx * ny;
  const filled = new Float32Array(n).fill(Infinity);
  const closed = new Uint8Array(n);
  const h = new Heap();
  const idx = (c, r) => r * nx + c;
  // borde como semillas
  for (let c = 0; c < nx; c++) { for (const r of [0, ny - 1]) { const i = idx(c, r); filled[i] = data[i]; closed[i] = 1; h.push(data[i], i); } }
  for (let r = 0; r < ny; r++) { for (const c of [0, nx - 1]) { const i = idx(c, r); if (!closed[i]) { filled[i] = data[i]; closed[i] = 1; h.push(data[i], i); } } }
  while (h.size) {
    const { v: i } = h.pop();
    const c = i % nx, r = (i / nx) | 0;
    for (const [dr, dc] of N8) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= nx || nr >= ny) continue;
      const j = nr * nx + nc;
      if (closed[j]) continue;
      filled[j] = Math.max(data[j], filled[i] + eps);
      closed[j] = 1;
      h.push(filled[j], j);
    }
  }
  return filled;
}

// Direcciones D8: receiver[i] = índice de la celda receptora (aguas abajo) o -1 (sale).
export function flowDirs(grid, elev) {
  const { nx, ny } = grid;
  const recv = new Int32Array(nx * ny).fill(-1);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const i = r * nx + c;
    let best = 0, bj = -1;
    for (const [dr, dc] of N8) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= nx || nr >= ny) { bj = -1; continue; }
      const j = nr * nx + nc;
      const dist = (dr && dc) ? Math.SQRT2 : 1;
      const slope = (elev[i] - elev[j]) / dist;
      if (slope > best) { best = slope; bj = j; }
    }
    recv[i] = bj;
  }
  return recv;
}

// Acumulación de flujo (nº de celdas aguas arriba, incluida la propia).
export function flowAccum(grid, recv) {
  const n = grid.nx * grid.ny;
  const accum = new Float32Array(n).fill(1);
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) if (recv[i] >= 0) indeg[recv[i]]++;
  const stack = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) stack.push(i);
  while (stack.length) {
    const i = stack.pop(), j = recv[i];
    if (j >= 0) { accum[j] += accum[i]; if (--indeg[j] === 0) stack.push(j); }
  }
  return accum;
}

// Ajusta el exutorio al CAUCE MÁS CERCANO (respeta dónde pinchó el usuario): la celda
// con acumulación ≥ minCells (umbral de canal) a MENOR distancia dentro del radio. Así
// un clic sobre un afluente chico da su cuenca (no salta al cauce grande cercano) y un
// clic sobre el cauce principal da el grande. Si no hay canal en el radio, cae al máximo.
// (Tomar el MÁXIMO del radio sobre-dimensionaba: saltaba al río principal a cientos de m.)
export function snapOutlet(grid, accum, col, row, radius = 4, minCells = 0) {
  const { nx, ny } = grid;
  if (minCells > 0) {
    let bi = -1, bestD = Infinity;
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= nx || r >= ny) continue;
      if (accum[r * nx + c] >= minCells) { const d = dc * dc + dr * dr; if (d < bestD) { bestD = d; bi = r * nx + c; } }
    }
    if (bi >= 0) return bi;
  }
  let best = -1, bi = row * nx + col;
  for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
    const c = col + dc, r = row + dr;
    if (c < 0 || r < 0 || c >= nx || r >= ny) continue;
    const i = r * nx + c;
    if (accum[i] > best) { best = accum[i]; bi = i; }
  }
  return bi;
}

// Cuenca aportante al exutorio: todas las celdas cuyo flujo llega al exutorio.
// BFS aguas arriba usando los donantes (inverso de recv).
export function watershed(grid, recv, outlet) {
  const n = grid.nx * grid.ny;
  const donors = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) if (recv[i] >= 0) donors[recv[i]].push(i);
  const mask = new Uint8Array(n);
  const stack = [outlet]; mask[outlet] = 1;
  let count = 0;
  while (stack.length) { const i = stack.pop(); count++; for (const d of donors[i]) if (!mask[d]) { mask[d] = 1; stack.push(d); } }
  return { mask, count };
}

// Polígono (anillo exterior) de la máscara, en [lon,lat]. Usa ARISTAS DIRIGIDAS con
// el interior SIEMPRE a la izquierda; en un vértice ambiguo (pellizco diagonal, donde
// dos lóbulos de la cuenca se tocan en una esquina) elige el giro más a la DERECHA
// → cada lazo se traza por separado sin cruzarse (antes se dibujaban 2 cuencas como
// un polígono raro). Devuelve el anillo de mayor área (el borde exterior de la cuenca).
export function maskToPolygon(grid, mask) {
  const { nx, ny, bbox: b } = grid;
  const K = (c, r) => c + ',' + r;
  const cr = (k) => { const i = k.indexOf(','); return [+k.slice(0, i), +k.slice(i + 1)]; };
  const inside = (c, r) => c >= 0 && r >= 0 && c < nx && r < ny && mask[r * nx + c];
  const out = new Map();                          // esquina origen → [esquinas destino]
  const add = (fc, fr, tc, tr) => { const k = K(fc, fr); if (!out.has(k)) out.set(k, []); out.get(k).push(K(tc, tr)); };
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    if (!mask[r * nx + c]) continue;             // interior a la IZQUIERDA de cada arista dirigida
    if (!inside(c, r - 1)) add(c + 1, r, c, r);          // norte: TR→TL
    if (!inside(c, r + 1)) add(c, r + 1, c + 1, r + 1);  // sur:  BL→BR
    if (!inside(c - 1, r)) add(c, r, c, r + 1);          // oeste:TL→BL
    if (!inside(c + 1, r)) add(c + 1, r + 1, c + 1, r);  // este: BR→TR
  }
  if (!out.size) return [];
  // elige, entre varias salidas, la que gira MÁS a la derecha respecto a la entrada
  const pickRight = (prevK, curK, cands) => {
    const P = cr(prevK), C = cr(curK); const vx = C[0] - P[0], vy = C[1] - P[1];
    let best = 0, bestT = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const W = cr(cands[i]); const wx = W[0] - C[0], wy = W[1] - C[1];
      let t = Math.atan2(wy, wx) - Math.atan2(vy, vx); t = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (t < bestT) { bestT = t; best = i; }
    }
    return best;
  };
  // extrae todos los lazos consumiendo aristas
  const loops = [];
  for (const [s0, a0] of out) {
    while (a0.length) {
      const start = s0; const loop = [start];
      let prev = start, cur = a0.pop(); loop.push(cur);
      let guard = 0;
      while (cur !== start && guard++ < nx * ny * 4 + 20) {
        const outs = out.get(cur); if (!outs || !outs.length) break;
        const idx = outs.length > 1 ? pickRight(prev, cur, outs) : 0;
        const nx2 = outs.splice(idx, 1)[0];
        loop.push(nx2); prev = cur; cur = nx2;
      }
      if (loop.length > 3) loops.push(loop);
    }
  }
  if (!loops.length) return [];
  const toXY = (k) => { const [c, r] = cr(k); return [b.west + c / nx * (b.east - b.west), b.north - r / ny * (b.north - b.south)]; };
  const area = (loop) => { let A = 0; for (let i = 0; i < loop.length - 1; i++) { const a = cr(loop[i]), d = cr(loop[i + 1]); A += a[0] * d[1] - d[0] * a[1]; } return Math.abs(A); };
  let best = loops[0], bA = area(best);
  for (const l of loops) { const A = area(l); if (A > bA) { bA = A; best = l; } }
  return simplificar(best.map(toXY), 0);
}

// Quita vértices colineales (y opcionalmente Douglas-Peucker con tol>0 en grados).
export function simplificar(pts, tol = 0) {
  if (pts.length < 3) return pts;
  let out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 1e-12) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Douglas-Peucker: reduce vértices de una polilínea (tol en grados).
export function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-18;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, py = a[1] + t * dy;
    return (p[0] - px) ** 2 + (p[1] - py) ** 2;
  };
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop(); let idx = -1, dmax = 0;
    for (let i = a + 1; i < b; i++) { const dd = d2(pts[i], pts[a], pts[b]); if (dd > dmax) { dmax = dd; idx = i; } }
    if (dmax > tol2 && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Chaikin: corta esquinas (redondea) un anillo cerrado; iter iteraciones.
export function chaikin(ring, iter = 2) {
  let r = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring.slice();
  for (let k = 0; k < iter; k++) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    r = out;
  }
  r.push([...r[0]]);   // cierra
  return r;
}

// Suaviza el polígono de una cuenca: simplifica (DP) y redondea (Chaikin).
//   tolM: tolerancia de simplificación en metros; iter: pasadas de redondeo.
export function suavizar(polygon, { tolM = 35, iter = 2, latRef = -20 } = {}) {
  if (!polygon || polygon.length < 4) return polygon;
  const open = (polygon[0][0] === polygon[polygon.length - 1][0] && polygon[0][1] === polygon[polygon.length - 1][1])
    ? polygon.slice(0, -1) : polygon.slice();
  const tolDeg = tolM / (111320 * Math.cos(latRef * Math.PI / 180));   // ~grados a esa latitud
  const simp = douglasPeucker([...open, open[0]], tolDeg);             // DP sobre anillo cerrado
  return chaikin(simp, iter);
}

// ¿La cuenca toca el borde del DEM? (señal de que hay que ampliar la ventana)
export function tocaBorde(grid, mask) {
  const { nx, ny } = grid;
  for (let c = 0; c < nx; c++) if (mask[c] || mask[(ny - 1) * nx + c]) return true;
  for (let r = 0; r < ny; r++) if (mask[r * nx] || mask[r * nx + nx - 1]) return true;
  return false;
}

// Morfometría de la cuenca.
export function morfometria(grid, elev, recv, accum, mask, outlet, polygon) {
  const { nx } = grid;
  const { dx, dy } = cellSize(grid);
  const cellA = dx * dy;                       // m² por celda
  let nC = 0, sumLon = 0, sumLat = 0, emax = -Infinity;
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    nC++; const [lon, lat] = colRowToLonLat(grid, i % nx, (i / nx) | 0);
    sumLon += lon; sumLat += lat; if (elev[i] > emax) emax = elev[i];
  }
  const A = (nC * cellA) / 1e6;               // km²
  const eOut = elev[outlet];
  const H = emax - eOut;                        // desnivel total [m]
  // cauce principal: aguas arriba siguiendo el donante de mayor acumulación
  const donors = Array.from({ length: mask.length }, () => []);
  for (let i = 0; i < mask.length; i++) if (recv[i] >= 0 && mask[i]) donors[recv[i]].push(i);
  let cur = outlet, L = 0; const path = [outlet];
  for (let guard = 0; guard < mask.length; guard++) {
    const ds = donors[cur]; if (!ds.length) break;
    let nb = ds[0]; for (const d of ds) if (accum[d] > accum[nb]) nb = d;
    const c0 = cur % nx, r0 = (cur / nx) | 0, c1 = nb % nx, r1 = (nb / nx) | 0;
    L += Math.hypot((c1 - c0) * dx, (r1 - r0) * dy);
    path.push(nb); cur = nb;
  }
  const eHead = elev[cur];
  const Lkm = L / 1000;
  const S = Lkm > 0 ? (eHead - eOut) / L : 0;   // m/m
  const [lonO, latO] = colRowToLonLat(grid, outlet % nx, (outlet / nx) | 0);
  const cen = [sumLon / nC, sumLat / nC];
  const latm = (latO + cen[1]) / 2 * Math.PI / 180;
  const Lg = Math.hypot((cen[0] - lonO) * 111320 * Math.cos(latm), (cen[1] - latO) * 110540) / 1000;
  // perímetro del polígono
  let P = 0;
  for (let i = 0; polygon && i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    P += Math.hypot((b[0] - a[0]) * 111320 * Math.cos(latm), (b[1] - a[1]) * 110540);
  }
  return {
    A: +A.toFixed(3), L: +Lkm.toFixed(3), Lg: +Lg.toFixed(3), S: +S.toFixed(5),
    H: +H.toFixed(1), perimetro_km: +(P / 1000).toFixed(3),
    cotaSalida: +eOut.toFixed(1), cotaMax: +emax.toFixed(1),
    nCeldas: nC, centroide: cen, outletLonLat: [lonO, latO],
    Kc: +(0.28 * (P / 1000) / Math.sqrt(A)).toFixed(2),   // índice de compacidad (Gravelius)
  };
}

// Orquestador: delinea la cuenca aportante al punto (lon,lat).
// Ruteo D8 completo de una grilla: relleno de depresiones + direcciones + acumulación.
// EXACTAMENTE lo que usa la red de drenaje (red_drenaje.js) → delinear sobre este
// mismo `rout` garantiza que la cuenca RESPETA los flujos que se ven en el mapa.
export function routD8(grid) {
  const elev = fillSinks(grid);
  const recv = flowDirs(grid, elev);
  const accum = flowAccum(grid, recv);
  return { elev, recv, accum };
}

// Delinea sobre un grid YA RUTEADO (mismo ruteo que la red de drenaje). No recalcula
// el flujo → la cuenca es consistente con los cauces mostrados. snapMeters ajustable.
export function delinearEnGrid(grid, rout, lon, lat, opts = {}) {
  const { elev, recv, accum } = rout;
  let [col, row] = lonLatToColRow(grid, lon, lat);
  col = Math.max(0, Math.min(grid.nx - 1, col));
  row = Math.max(0, Math.min(grid.ny - 1, row));
  const cs = cellSize(grid); const avg = (cs.dx + cs.dy) / 2;
  const radius = Math.max(1, Math.round((opts.snapMeters ?? 60) / avg));
  const minCells = Math.max(2, Math.round((opts.canalKm2 ?? 0.05) / ((avg * avg) / 1e6)));
  // mainChannel: engancha al CAUCE PRINCIPAL (máx acumulación en el radio), no al
  // primer canal que cruce el umbral. Clave para estaciones de control fluviométrico:
  // están SOBRE el río, y snappear a un tributario minúsculo daba un área de control
  // absurdamente chica → la transposición inflaba el caudal (riachuelo → miles de m³/s).
  const mc = opts.mainChannel ? 0 : (opts.snapMeters === 0 ? 0 : minCells);
  const outlet = opts.snap === false ? row * grid.nx + col
    : snapOutlet(grid, accum, col, row, radius, mc);
  const { mask, count } = watershed(grid, recv, outlet);
  const polygon = maskToPolygon(grid, mask);
  const morf = morfometria(grid, elev, recv, accum, mask, outlet, polygon);
  return { outlet, mask, count, polygon, morfometria: morf, tocaBorde: tocaBorde(grid, mask), accum, recv };
}

export function delinear(grid, lon, lat, opts = {}) {
  return delinearEnGrid(grid, routD8(grid), lon, lat, { snapMeters: opts.snapMeters ?? 300, ...opts });
}
