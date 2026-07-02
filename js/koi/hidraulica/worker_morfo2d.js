// ─────────────────────────────────────────────────────────────────────────────
// worker_morfo2d.js — corre resolverMorfo2D (Tier4-Fase4, flujo+lecho acoplados)
// en un Web Worker, mismo patrón que worker_momentum2d.js (evita congelar la UI:
// es explícito/CFL-adaptativo, y encima recalcula transporte de sedimento).
// Mensaje de entrada:  { mesh, opts }
// Mensajes de salida:  { tipo:'progreso', t, tSim, paso }
//                      { tipo:'listo', h, V, dz, pasos, t, hmax, Vmax, nMojados,
//                        nCeldas, masaTotal, volErosion, volDeposito, dzMax,
//                        acople, frames }
//                      { tipo:'error', mensaje }
// h/V/dz/frames llegan interpolados a NODO (celdaANodo) — listos para
// showInundacion / peligrosidad2d.js / export sin más conversión.
// ─────────────────────────────────────────────────────────────────────────────
import { resolverMorfo2D } from './solver2d_morfo.js';
import { celdaANodo } from './solver2d_momentum.js';

self.onmessage = (ev) => {
  const { mesh, opts } = ev.data;
  try {
    const r = resolverMorfo2D(mesh, {
      ...opts,
      onProgress: (t, tSim, paso) => self.postMessage({ tipo: 'progreso', t, tSim, paso }),
    });
    const hNodo = celdaANodo(r.mallaF, r.h), VNodo = celdaANodo(r.mallaF, r.V), dzNodo = celdaANodo(r.mallaF, r.dz);
    const frames = (r.frames || []).map((f) => ({ t: f.t, h: celdaANodo(r.mallaF, f.h) }));
    self.postMessage({
      tipo: 'listo', h: hNodo, V: VNodo, dz: dzNodo, frames,
      hmax: r.hmax, Vmax: r.Vmax, nMojados: r.nMojados, nCeldas: r.nCeldas,
      pasos: r.pasos, t: r.t, masaTotal: r.masaTotal,
      volErosion: r.volErosion, volDeposito: r.volDeposito, dzMax: r.dzMax, acople: r.acople,
    });
  } catch (e) {
    self.postMessage({ tipo: 'error', mensaje: e.message });
  }
};
