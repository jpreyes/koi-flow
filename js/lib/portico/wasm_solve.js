// ──────────────────────────────────────────────────────────────────────────────
// wasm_solve.js — puente ESM al solver SPD en WASM (koi_solve.wasm / koi_solve_mt.wasm).
// El glue de emscripten es un factory global (createKoiSolve/createKoiSolveMT), no
// un módulo ESM: este shim lo carga una vez (singleton), instancia el módulo y
// expone un solver SÍNCRONO estilo makeFactorCSR/makeSolverPCG para intercambiarlo
// en solver2d. Solo navegador (necesita document + WebAssembly).
//
// Fase 1 (WASM threads): si la página está crossOriginIsolated (COOP/COEP, ver
// serve.py y sw.js) Y SharedArrayBuffer existe, carga koi_solve_mt.js (el mismo
// kernel IC(0)-PCG compilado con -pthread, ver wasm/koi_solve.cpp KOI_THREADS) —
// si no, cae al build single-thread de siempre (ya validado). Nunca falla por
// falta de threads: es una mejora opcional, no un requisito.
// ──────────────────────────────────────────────────────────────────────────────
let _mod = null, _loading = null, _threaded = false;

export function koiWasmReady() { return !!_mod; }
export function koiWasmThreaded() { return _threaded; }

function loadScript(url) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.onload = res;
    s.onerror = () => rej(new Error('no se pudo cargar ' + url));
    document.head.appendChild(s);
  });
}

// Carga+instancia el WASM (idempotente). Devuelve el Module de emscripten.
export async function ensureKoiWasm() {
  if (_mod) return _mod;
  if (_loading) return _loading;
  _loading = (async () => {
    if (typeof document === 'undefined') throw new Error('WASM shim requiere navegador');
    const puedeThreads = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
    if (puedeThreads) {
      try {
        if (!globalThis.createKoiSolveMT) await loadScript(new URL('./wasm/koi_solve_mt.js', import.meta.url).href);
        _mod = await globalThis.createKoiSolveMT();
        _threaded = true;
        return _mod;
      } catch (e) {
        console.warn('WASM threads no disponible, usando single-thread:', e.message);
      }
    }
    if (!globalThis.createKoiSolve) await loadScript(new URL('./wasm/koi_solve.js', import.meta.url).href);
    _mod = await globalThis.createKoiSolve();
    _threaded = false;
    return _mod;
  })();
  return _loading;
}

// Solver estilo makeFactorCSR usando el WASM ya instanciado. csr = {n,rowPtr,colIdx,val}
// (CSR simétrico completo). solve(b) → Float64Array (con _iters). Requiere ensureKoiWasm antes.
export function makeSolverWasm(csr, opts = {}) {
  const M = _mod;
  if (!M) return { ok: false, kind: 'wasm', solve: () => { throw new Error('WASM no listo: llama ensureKoiWasm()'); } };
  const tol = opts.tol != null ? opts.tol : 1e-8, maxIter = opts.maxIter || 0;
  return {
    ok: true, kind: _threaded ? 'wasm-mt' : 'wasm',
    solve(b, out) {
      const n = csr.n, nnz = csr.rowPtr[n];
      const rp = M._malloc((n + 1) * 4), ci = M._malloc(nnz * 4), va = M._malloc(nnz * 8), rh = M._malloc(n * 8), xx = M._malloc(n * 8);
      // views frescas tras los malloc (ALLOW_MEMORY_GROWTH puede reasignar el buffer)
      M.HEAP32.set(csr.rowPtr, rp >> 2);
      M.HEAP32.set(csr.colIdx, ci >> 2);
      M.HEAPF64.set(csr.val, va >> 3);
      M.HEAPF64.set(b instanceof Float64Array ? b : Float64Array.from(b), rh >> 3);
      const iters = M._solveSPD(n, nnz, rp, ci, va, rh, xx, tol, maxIter);
      const o = out || new Float64Array(n);
      o.set(new Float64Array(M.HEAPF64.buffer, xx, n));
      o._iters = iters;
      M._free(rp); M._free(ci); M._free(va); M._free(rh); M._free(xx);
      return o;
    }
  };
}

// Solver WASM PERSISTENTE: reserva la memoria UNA vez y copia rowPtr/colIdx UNA vez
// (el patrón CSR no cambia en una simulación); en cada solve solo se actualizan los
// valores (updateValues) y el término independiente. Evita el malloc + 4 copias +
// free por cada solve de cada iteración Picard. Reutiliza el buffer de salida `out`.
//   const S = makePersistentSolverWasm(csr, {tol});
//   S.updateValues(csr.val);  S.solve(rhs, out);  … ; S.free();
// Compatibilidad: expone también solve(b,out) como makeSolverWasm. csr fija n/nnz.
export function makePersistentSolverWasm(csr, opts = {}) {
  const M = _mod;
  if (!M) throw new Error('WASM no listo: llama ensureKoiWasm() antes');
  const n = csr.n, nnz = csr.rowPtr[n];
  const tol = opts.tol != null ? opts.tol : 1e-8, maxIter = opts.maxIter || 0;
  // reserva única (5 bloques). Con ALLOW_MEMORY_GROWTH los offsets siguen válidos
  // tras un crecimiento; solo hay que re-leer M.HEAP* (no cachearlos) en cada uso.
  const rp = M._malloc((n + 1) * 4), ci = M._malloc(nnz * 4), va = M._malloc(nnz * 8), rh = M._malloc(n * 8), xx = M._malloc(n * 8);
  M.HEAP32.set(csr.rowPtr, rp >> 2);      // patrón: se copia UNA sola vez
  M.HEAP32.set(csr.colIdx, ci >> 2);
  let liberado = false;
  return {
    ok: true, kind: _threaded ? 'wasm-mt' : 'wasm', n,
    updateValues(val) { M.HEAPF64.set(val, va >> 3); },
    solve(b, out) {
      M.HEAPF64.set(b instanceof Float64Array ? b : Float64Array.from(b), rh >> 3);
      const iters = M._solveSPD(n, nnz, rp, ci, va, rh, xx, tol, maxIter);
      const o = out || new Float64Array(n);
      o.set(new Float64Array(M.HEAPF64.buffer, xx, n));   // buffer fresco tras el solve
      o._iters = iters;
      return o;
    },
    free() { if (liberado) return; liberado = true; M._free(rp); M._free(ci); M._free(va); M._free(rh); M._free(xx); },
  };
}
