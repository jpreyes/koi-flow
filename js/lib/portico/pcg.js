// ──────────────────────────────────────────────────────────────────────────────
// pcg.js — Precondicionado Gradiente Conjugado (PCG) para K·x = b, SPD, en CSR.
//
// Alternativa ITERATIVA al Cholesky en banda de linsolve.js. Para la onda difusiva
// 2D (operador tipo Poisson) el Cholesky en banda cuesta O(n·b²) tiempo y O(n·b)
// memoria con b≈√n → O(n²)/O(n^1.5): el muro de las mallas grandes. El PCG es
// matrix-free en memoria (solo los no-ceros de A + el factor incompleto) y con un
// buen precondicionador converge en pocas iteraciones.
//
// Precondicionadores:
//   · Jacobi   M = diag(A)                 — barato, robusto, iteraciones ~O(√N).
//   · IC0      Cholesky incompleto (patrón de A) — el que escala en 2D Poisson.
//
// Esta es la REFERENCIA para el port a C++/WASM (vector-cplus): mismo algoritmo,
// misma aritmética. La matriz llega en CSR simétrico COMPLETO (ambos triángulos):
//   csr = { n, rowPtr:Int32Array(n+1), colIdx:Int32Array(nnz), val:Float64Array(nnz) }
// ──────────────────────────────────────────────────────────────────────────────

// Producto y = A·x con A en CSR (O(nnz)).
export function csrMatvec(csr, x, out) {
  const { n, rowPtr, colIdx, val } = csr;
  const y = out || new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) s += val[p] * x[colIdx[p]];
    y[i] = s;
  }
  return y;
}

// ── Precondicionador Jacobi ──────────────────────────────────────────────────
// Devuelve apply(r,z): z = M⁻¹r con M = diag(A).
export function jacobi(csr) {
  const { n, rowPtr, colIdx, val } = csr;
  const inv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) if (colIdx[p] === i) { d = val[p]; break; }
    inv[i] = d !== 0 ? 1 / d : 0;
  }
  return {
    apply(r, z) { const o = z || new Float64Array(n); for (let i = 0; i < n; i++) o[i] = inv[i] * r[i]; return o; }
  };
}

// ── Precondicionador IC0 (Cholesky incompleto, sin relleno) ──────────────────
// Extrae el triángulo inferior (j≤i) de A en CSR y calcula L (patrón de A) tal que
// A ≈ L·Lᵀ. Aplica M⁻¹r resolviendo L·y=r y luego Lᵀ·z=y.
export function ic0(csr) {
  const { n, rowPtr, colIdx, val } = csr;
  // 1) triángulo inferior (incluida diagonal), por filas, columnas ascendentes.
  const Lp = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) { let c = 0; for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) if (colIdx[p] <= i) c++; Lp[i + 1] = Lp[i] + c; }
  const nnzL = Lp[n];
  const Lj = new Int32Array(nnzL), Lx = new Float64Array(nnzL);
  const diagPtr = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    // recoger columnas ≤ i con su valor, ordenadas
    const cols = [];
    for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) { const j = colIdx[p]; if (j <= i) cols.push([j, val[p]]); }
    cols.sort((a, b) => a[0] - b[0]);
    let q = Lp[i];
    for (const [j, v] of cols) { Lj[q] = j; Lx[q] = v; if (j === i) diagPtr[i] = q; q++; }
  }
  // valor de L en (fila r, col c) por búsqueda binaria en el patrón, o -1.
  const findL = (r, c) => { let lo = Lp[r], hi = Lp[r + 1] - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (Lj[m] === c) return m; if (Lj[m] < c) lo = m + 1; else hi = m - 1; } return -1; };

  // 2) factorización incompleta (mismo patrón de L). Forma left-looking por fila.
  for (let i = 0; i < n; i++) {
    for (let p = Lp[i]; p <= diagPtr[i]; p++) {
      const j = Lj[p];
      let sum = Lx[p];
      // sum -= Σ_{k<j, patrón} L[i][k]·L[j][k]
      for (let pk = Lp[i]; pk < p; pk++) {
        const k = Lj[pk];
        if (k >= j) break;
        const pjk = findL(j, k);
        if (pjk >= 0) sum -= Lx[pk] * Lx[pjk];
      }
      if (j === i) {
        Lx[p] = sum > 0 ? Math.sqrt(sum) : Math.sqrt(Math.abs(sum) || 1e-12); // salvaguarda SPD
      } else {
        Lx[p] = sum / Lx[diagPtr[j]];
      }
    }
  }

  const y = new Float64Array(n);
  return {
    apply(r, z) {
      const o = z || new Float64Array(n);
      // L·y = r  (sustitución hacia adelante)
      for (let i = 0; i < n; i++) {
        let s = r[i];
        for (let p = Lp[i]; p < diagPtr[i]; p++) s -= Lx[p] * y[Lj[p]];
        y[i] = s / Lx[diagPtr[i]];
      }
      // Lᵀ·z = y  (sustitución hacia atrás)
      for (let i = 0; i < n; i++) o[i] = y[i];
      for (let i = n - 1; i >= 0; i--) {
        o[i] /= Lx[diagPtr[i]];
        for (let p = Lp[i]; p < diagPtr[i]; p++) o[Lj[p]] -= Lx[p] * o[i];
      }
      return o;
    },
    _L: { Lp, Lj, Lx, diagPtr }
  };
}

// ── PCG ──────────────────────────────────────────────────────────────────────
// Resuelve A·x = b (A SPD en CSR). opts:
//   pre: 'ic0' (def) | 'jacobi' | objeto {apply(r,z)} | null (CG puro)
//   tol: ||r||/||b|| relativo (def 1e-8) · maxIter (def 4·√n+50) · x0 (semilla)
// Devuelve { x, iters, res, ok }.
export function pcg(csr, b, opts = {}) {
  const n = csr.n;
  const tol = opts.tol != null ? opts.tol : 1e-8;
  const maxIter = opts.maxIter || Math.round(4 * Math.sqrt(n) + 50);
  let M = opts.pre;
  if (M === 'jacobi') M = jacobi(csr);
  else if (M === 'ic0' || M === undefined) M = ic0(csr);
  else if (M === null) M = { apply: (r, z) => { const o = z || new Float64Array(n); o.set(r); return o; } };

  const x = new Float64Array(n); if (opts.x0) x.set(opts.x0);
  const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  // r = b - A·x
  csrMatvec(csr, x, Ap);
  let bnorm = 0; for (let i = 0; i < n; i++) { r[i] = b[i] - Ap[i]; bnorm += b[i] * b[i]; }
  bnorm = Math.sqrt(bnorm) || 1;
  M.apply(r, z);
  p.set(z);
  let rz = 0; for (let i = 0; i < n; i++) rz += r[i] * z[i];
  // Criterio: residuo PRECONDICIONADO rᵀz relativo al inicial. Con Dirichlet por
  // penalti (diagonal ~1e12) el residuo crudo ‖r‖ queda dominado por esas filas y
  // el interior no converge; M⁻¹ de-pesa las filas rígidas y mide el interior.
  const rz0 = rz || 1;
  const stop = tol * tol * rz0;

  let iter = 0, res = 0;
  for (iter = 0; iter < maxIter; iter++) {
    csrMatvec(csr, p, Ap);
    let pAp = 0; for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (!(Math.abs(pAp) > 0)) break;
    const alpha = rz / pAp;
    let rnorm = 0;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; rnorm += r[i] * r[i]; }
    res = Math.sqrt(rnorm) / bnorm;
    M.apply(r, z);
    let rzNew = 0; for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
    if (rzNew < stop) { iter++; rz = rzNew; break; }
    const beta = rzNew / rz; rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return { x, iters: iter, res, ok: rz < stop };
}

// Envoltura estilo makeFactorCSR (linsolve.js) para intercambiarlo en solver2d.
// makeSolverPCG(csr).solve(b) → Float64Array. Reconstruye el precondicionador por
// llamada (la matriz cambia cada iteración Picard).
export function makeSolverPCG(csr, opts = {}) {
  return {
    ok: true, kind: 'pcg-' + (opts.pre || 'ic0'),
    solve(b, out) { const r = pcg(csr, b, opts); const o = out || new Float64Array(csr.n); o.set(r.x); o._iters = r.iters; return o; }
  };
}
