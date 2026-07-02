// ─────────────────────────────────────────────────────────────────────────────
// solver2d_worker.js — corre la ONDA DIFUSIVA (resolver2D) en un Web Worker para no
// congelar la UI en mallas grandes o simulaciones largas. Mismo patrón que
// worker_momentum2d.js. Usa los solvers JS (banda / PCG-IC0): el camino WASM NO está
// disponible aquí porque ensureKoiWasm() carga el glue de Emscripten con
// document.createElement('script') (DOM), inexistente en un worker — para WASM en
// worker haría falta un loader worker-safe (importScripts/fetch+compile), pendiente.
//   entrada:  { mesh, opts }   (opts sin funciones: onProgress/wasm* no cruzan)
//   salida:   { tipo:'progreso', p, N, d }
//             { tipo:'listo', r }   (r = resultado de resolver2D, arrays clonables)
//             { tipo:'error', mensaje }
// ─────────────────────────────────────────────────────────────────────────────
import { resolver2D } from './solver2d.js';

self.onmessage = (ev) => {
  const { mesh, opts } = ev.data;
  try {
    const r = resolver2D(mesh, {
      ...opts,
      onProgress: (p, N, d) => self.postMessage({ tipo: 'progreso', p, N, d }),
    });
    self.postMessage({ tipo: 'listo', r });   // H/h/V/Vx/Vy (Float64Array) + frames se clonan
  } catch (e) {
    self.postMessage({ tipo: 'error', mensaje: e.message });
  }
};
