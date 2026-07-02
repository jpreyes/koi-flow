// ─────────────────────────────────────────────────────────────────────────────
// solver2d.js — flujo 2D por ONDA DIFUSIVA (zero-inertia) sobre malla triangular
// P1 (koi-flow, Fase 5B). Es el solver 2D por defecto de HEC-RAS.
//   ∂H/∂t = ∇·(D ∇H) + S ,  H = z+h ,  D = (1/n)·h^{5/3}·|∇H|^{-1/2}  (Manning)
// Implícito (Euler atrás) + Picard (D del iterado previo) → sistema SPD por paso:
//   (M/Δt + K(D)) H^{n+1} = (M/Δt) H^n + F
// M = masa concentrada (área de control), K = rigidez de difusión (P1), F = fuentes
// + caudal de entrada. Se factoriza con el Cholesky en banda de portico-core.
// Wetting/drying por profundidad mínima; salida por nivel fijo (Dirichlet, penalti).
// ─────────────────────────────────────────────────────────────────────────────
import { makeFactorCSR } from '../../lib/portico/linsolve.js?v=2';
import { makeSolverPCG } from '../../lib/portico/pcg.js?v=2';

// Geometría P1 por triángulo: área y gradientes de las funciones de forma (b,c).
function geomTris(nodes, tris) {
  const G = [];
  for (const t of tris) {
    const [i, j, k] = t;
    const x1 = nodes[i].x, y1 = nodes[i].y, x2 = nodes[j].x, y2 = nodes[j].y, x3 = nodes[k].x, y3 = nodes[k].y;
    const det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    const A = Math.abs(det) / 2;
    if (A < 1e-9) { G.push(null); continue; }
    const b = [(y2 - y3) / det, (y3 - y1) / det, (y1 - y2) / det];   // ∂N/∂x
    const c = [(x3 - x2) / det, (x1 - x3) / det, (x2 - x1) / det];   // ∂N/∂y
    G.push({ i, j, k, A, b, c });
  }
  return G;
}

// Estructura CSR simétrica a partir de la adyacencia de la malla (patrón fijo).
function buildCSR(n, tris) {
  const adj = Array.from({ length: n }, () => new Set());
  for (const t of tris) for (const a of t) for (const bb of t) adj[a].add(bb);
  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) rowPtr[i + 1] = rowPtr[i] + adj[i].size;
  const nnz = rowPtr[n];
  const colIdx = new Int32Array(nnz);
  for (let i = 0; i < n; i++) { const cols = [...adj[i]].sort((a, b) => a - b); for (let p = 0; p < cols.length; p++) colIdx[rowPtr[i] + p] = cols[p]; }
  const val = new Float64Array(nnz);
  const pos = (i, j) => { let lo = rowPtr[i], hi = rowPtr[i + 1] - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (colIdx[m] === j) return m; if (colIdx[m] < j) lo = m + 1; else hi = m - 1; } return -1; };
  return { n, rowPtr, colIdx, val, pos };
}

// Resuelve el flujo 2D difusivo hasta régimen (permanente) o nPasos.
//   mesh: {nodes:[{x,y,z,n}], tris}.  opts:
//     Q (caudal de entrada m³/s), entrada:[idx], salida:[idx], stageSalida (WSE fija),
//     dt, nPasos, hmin, smin (pendiente mínima), picard, tol, onProgress.
export function resolver2D(mesh, opts = {}) {
  const nodes = mesh.nodes, tris = mesh.tris, n = nodes.length;
  const { Q = 0, entrada = [], salida = [], hmin = 0.005, smin = 1e-4, picard = 3, dt = 30, nPasos = 200, tol = 1e-4 } = opts;
  // solver lineal: 'banda' (Cholesky directo, def), 'pcg' (IC0 en JS), 'wasm' (IC0 en C++).
  // Auto (sin especificar): 'pcg' si la malla es grande. 'wasm' requiere opts.wasmSolve (shim listo).
  let solverKind = opts.solver;
  if (solverKind !== 'banda' && solverKind !== 'pcg' && solverKind !== 'wasm')
    solverKind = (n > (opts.pcgDesde || 20000)) ? 'pcg' : 'banda';
  const wasmSolve = opts.wasmSolve;
  // wasmPersist: factory del solver WASM PERSISTENTE (reserva/copia el patrón CSR una
  // vez; por iteración solo actualiza valores). Preferido sobre wasmSolve (por-solve).
  const wasmPersistFactory = opts.wasmPersist;
  if (solverKind === 'wasm' && typeof wasmSolve !== 'function' && typeof wasmPersistFactory !== 'function') solverKind = 'pcg';   // sin WASM listo → JS
  const perfNow = (typeof performance !== 'undefined') ? () => performance.now() : () => Date.now();
  let tSolve = 0, nSolves = 0, tAssembly = 0;
  const tTotal0 = perfNow();
  const z = Float64Array.from(nodes, (nd) => nd.z);
  const nMan = Float64Array.from(nodes, (nd) => nd.n || 0.04);
  const G = geomTris(nodes, tris);

  // masa concentrada M_i = Σ A_e/3 (área de control del nodo)
  const M = new Float64Array(n);
  for (const g of G) if (g) { const a = g.A / 3; M[g.i] += a; M[g.j] += a; M[g.k] += a; }
  // piso a la masa: un nodo huérfano (sin triángulo válido) daría diagonal 0 → matriz
  // no-SPD y el Cholesky falla. Con un piso mínimo el sistema queda SPD siempre.
  let mmin = Infinity; for (const v of M) if (v > 0 && v < mmin) mmin = v;
  const piso = (isFinite(mmin) ? mmin : 1) * 1e-6;
  for (let i = 0; i < n; i++) if (M[i] <= 0) M[i] = piso;

  // caudal de entrada distribuido por masa de los nodos de entrada.
  // Transiente: opts.hidrograma = [{t,Q}] (Q variable en el tiempo) → se anima.
  const hidro = opts.hidrograma && opts.hidrograma.length ? opts.hidrograma : null;
  const guardarCada = opts.guardarCada || 0;   // >0 → guarda frames cada N pasos
  const frames = [];
  let mtEnt = 0; for (const i of entrada) mtEnt += M[i]; mtEnt = mtEnt || 1;
  const Qen = (t) => {
    if (!hidro) return Q;
    if (t <= hidro[0].t) return hidro[0].Q;
    if (t >= hidro[hidro.length - 1].t) return hidro[hidro.length - 1].Q;
    for (let i = 1; i < hidro.length; i++) if (t <= hidro[i].t) { const a = hidro[i - 1], b = hidro[i], fr = (t - a.t) / ((b.t - a.t) || 1); return a.Q + fr * (b.Q - a.Q); }
    return hidro[hidro.length - 1].Q;
  };
  const F0 = new Float64Array(n);
  const setF0 = (q) => { F0.fill(0); if (q > 0 && entrada.length) for (const i of entrada) F0[i] = q * (M[i] / mtEnt); };
  setF0(Q);

  // nivel de salida (Dirichlet): por defecto lecho de salida + 2·hmin
  let stageOut = opts.stageSalida;
  if (stageOut == null && salida.length) { let zmin = Infinity; for (const i of salida) zmin = Math.min(zmin, z[i]); stageOut = zmin + 0.02; }
  const esSalida = new Uint8Array(n); for (const i of salida) esSalida[i] = 1;

  const A = buildCSR(n, tris);
  // Solver WASM PERSISTENTE creado UNA vez (el patrón CSR no cambia en la simulación).
  // Si la instanciación falla, se cae a PCG-IC0 en JS (no rompe la corrida).
  let wasmPersist = null, usePersist = false;
  if (solverKind === 'wasm' && typeof wasmPersistFactory === 'function') {
    try { wasmPersist = wasmPersistFactory(A, { tol: 1e-8 }); usePersist = !!(wasmPersist && wasmPersist.ok); }
    catch (e) { console.warn('WASM persistente no disponible, uso PCG:', e.message); solverKind = 'pcg'; }
  }
  const solverLabel = usePersist ? wasmPersist.kind : solverKind;
  const solOut = new Float64Array(n);                // buffer de salida reutilizado
  const H = Float64Array.from(z);                    // seco: H=z (h=0)
  for (const i of salida) H[i] = Math.max(H[i], stageOut);
  const Hprev = new Float64Array(n);
  const rhs = new Float64Array(n);
  const grad = (g, Hv) => ({ gx: g.b[0] * Hv[g.i] + g.b[1] * Hv[g.j] + g.b[2] * Hv[g.k], gy: g.c[0] * Hv[g.i] + g.c[1] * Hv[g.j] + g.c[2] * Hv[g.k] });
  try {

  let paso = 0, cambio = Infinity;
  for (paso = 0; paso < nPasos; paso++) {
    Hprev.set(H);
    if (hidro) setF0(Qen(paso * dt));   // caudal de entrada del hidrograma en este paso
    for (let it = 0; it < picard; it++) {
      const _ta0 = perfNow();
      A.val.fill(0);
      rhs.set(F0);
      // M/Δt en la diagonal + M/Δt·H^n en rhs
      for (let i = 0; i < n; i++) { const md = M[i] / dt; A.val[A.pos(i, i)] += md; rhs[i] += md * Hprev[i]; }
      // rigidez de difusión K por elemento con D=(1/n)h^{5/3}|∇H|^{-1/2}
      for (const g of G) {
        if (!g) continue;
        // profundidad del elemento = MÁXIMA de sus nodos (upwind) → el frente mojado avanza
        const hE = Math.max(H[g.i] - z[g.i], H[g.j] - z[g.j], H[g.k] - z[g.k]);
        if (hE < hmin) continue;                     // elemento seco → sin conductividad
        const { gx, gy } = grad(g, H);
        const S = Math.max(smin, Math.hypot(gx, gy));
        const nE = (nMan[g.i] + nMan[g.j] + nMan[g.k]) / 3;
        const D = (1 / nE) * Math.pow(hE, 5 / 3) / Math.sqrt(S);
        const w = D * g.A;
        const id = [g.i, g.j, g.k];
        for (let a = 0; a < 3; a++) for (let bb = 0; bb < 3; bb++) {
          A.val[A.pos(id[a], id[bb])] += w * (g.b[a] * g.b[bb] + g.c[a] * g.c[bb]);
        }
      }
      // Dirichlet en salida por penalti (mantiene simetría/SPD)
      const BIG = 1e12;
      for (let i = 0; i < n; i++) if (esSalida[i]) { A.val[A.pos(i, i)] += BIG; rhs[i] += BIG * stageOut; }
      tAssembly += perfNow() - _ta0;
      // resolver SPD: WASM persistente (preferido; solo updateValues+solve), WASM por-solve,
      // PCG-IC0 (JS) o banda (Cholesky directo). rhs se pasa como Float64Array (sin copiar).
      const _t0 = perfNow();
      let sol;
      if (usePersist) { wasmPersist.updateValues(A.val); sol = wasmPersist.solve(rhs, solOut); }
      else {
        const F = solverKind === 'wasm' ? wasmSolve(A, { tol: 1e-8 })
          : solverKind === 'pcg' ? makeSolverPCG(A, { pre: 'ic0', tol: 1e-8 })
            : makeFactorCSR(A);
        if (!F.ok) throw new Error('sistema no SPD (revisa la malla/parámetros)');
        sol = F.solve(rhs);
      }
      tSolve += perfNow() - _t0; nSolves++;
      for (let i = 0; i < n; i++) { H[i] = Math.max(sol[i], z[i]); }   // clamp h≥0
    }
    // guarda frame h(t) para animar (transiente)
    if (guardarCada && paso % guardarCada === 0) {
      const hf = new Float32Array(n); for (let i = 0; i < n; i++) hf[i] = Math.max(0, H[i] - z[i]);
      frames.push({ t: paso * dt, h: hf });
    }
    // convergencia a permanente (en transiente NO se corta: se recorre todo el hidrograma)
    let d = 0; for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(H[i] - Hprev[i]));
    cambio = d;
    if (opts.onProgress && paso % 5 === 0) opts.onProgress(paso, nPasos, d);
    if (!hidro && d < tol) { paso++; break; }
  }

  // profundidad y velocidad por nodo (q=-D∇H por elemento → promedio a nodos)
  const h = new Float64Array(n), Vx = new Float64Array(n), Vy = new Float64Array(n), wsum = new Float64Array(n);
  for (let i = 0; i < n; i++) h[i] = Math.max(0, H[i] - z[i]);
  for (const g of G) {
    if (!g) continue;
    const hE = (h[g.i] + h[g.j] + h[g.k]) / 3;
    if (hE < hmin) continue;
    const { gx, gy } = grad(g, H);
    const S = Math.max(smin, Math.hypot(gx, gy));
    const nE = (nMan[g.i] + nMan[g.j] + nMan[g.k]) / 3;
    const D = (1 / nE) * Math.pow(hE, 5 / 3) / Math.sqrt(S);
    const qx = -D * gx, qy = -D * gy;                // caudal unitario [m²/s]
    const vx = qx / Math.max(hE, hmin), vy = qy / Math.max(hE, hmin);
    for (const i of [g.i, g.j, g.k]) { Vx[i] += vx * g.A; Vy[i] += vy * g.A; wsum[i] += g.A; }
  }
  const V = new Float64Array(n);
  for (let i = 0; i < n; i++) { const w = wsum[i] || 1; V[i] = Math.hypot(Vx[i] / w, Vy[i] / w); }

  let hmax = 0, Vmax = 0, nMoj = 0;
  for (let i = 0; i < n; i++) { if (h[i] > hmin) nMoj++; if (h[i] > hmax) hmax = h[i]; if (V[i] > Vmax) Vmax = V[i]; }
  return { H, h, V, Vx, Vy, pasos: paso, cambio, hmax, Vmax, nMojados: nMoj, convergio: cambio < tol, frames, dt,
    solver: solverLabel, tSolveMs: tSolve, nSolves, tSolvePromMs: nSolves ? tSolve / nSolves : 0,
    tAssemblyMs: tAssembly, tTotalMs: perfNow() - tTotal0, wasmPersistente: usePersist };
  } finally {
    if (wasmPersist) wasmPersist.free();   // libera la memoria WASM reservada una vez
  }
}
