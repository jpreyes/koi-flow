// ─────────────────────────────────────────────────────────────────────────────
// solver2d_worker.js — corre la ONDA DIFUSIVA (resolver2D) en un Web Worker para no
// congelar la UI en mallas grandes o simulaciones largas. Mismo patrón que
// worker_momentum2d.js. Soporta los tres solvers: banda / PCG-IC0 (JS) y WASM
// single-thread — el loader worker-safe (ensureKoiWasm baja el glue por fetch+eval) ya
// funciona dentro del worker, así que 'wasm' aquí sí usa el kernel C++.
//   entrada:  { mesh, opts }   (opts sin funciones: onProgress/wasm* no cruzan)
//   salida:   { tipo:'progreso', p, N, d } | { tipo:'listo', r } | { tipo:'error', mensaje }
// ─────────────────────────────────────────────────────────────────────────────
import { resolver2D } from './solver2d.js';
import { ensureKoiWasm, makeSolverWasm, makePersistentSolverWasm } from '../../lib/portico/wasm_solve.js';

self.onmessage = async (ev) => {
  const { mesh, opts } = ev.data;
  try {
    const extra = {};
    if (opts.solver === 'wasm') {
      // el módulo WASM tiene su propio singleton en este worker: se instancia aquí.
      try { await ensureKoiWasm(); extra.wasmSolve = makeSolverWasm; extra.wasmPersist = makePersistentSolverWasm; }
      catch (e) { opts.solver = 'pcg'; self.postMessage({ tipo: 'aviso', mensaje: 'WASM no disponible en worker (' + e.message + '); usando PCG-JS' }); }
    }
    const r = resolver2D(mesh, {
      ...opts, ...extra,
      onProgress: (p, N, d) => self.postMessage({ tipo: 'progreso', p, N, d }),
    });
    self.postMessage({ tipo: 'listo', r });   // H/h/V/Vx/Vy (Float64Array) + frames se clonan
  } catch (e) {
    self.postMessage({ tipo: 'error', mensaje: e.message });
  }
};
