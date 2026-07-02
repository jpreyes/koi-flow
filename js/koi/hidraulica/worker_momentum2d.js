// ─────────────────────────────────────────────────────────────────────────────
// worker_momentum2d.js — corre resolverMomentum2D en un Web Worker para no
// congelar la UI (el esquema es explícito/CFL-adaptativo: puede necesitar muchos
// pasos en mallas grandes o tSim largo, a diferencia de la difusiva implícita).
// Mensaje de entrada:  { mesh, opts }   (opts sin onProgress: no cruza postMessage)
// Mensajes de salida:  { tipo:'progreso', t, tSim, paso }
//                      { tipo:'listo', h, V, H, frames, hmax, Vmax, nMojados,
//                        nCeldas, pasos, t, masaTotal }
//                      { tipo:'error', mensaje }
// h/V/H llegan interpolados a NODO (celdaANodo) — listos para showInundacion /
// peligrosidad2d.js sin más conversión, igual que si se hubiera llamado directo.
// ─────────────────────────────────────────────────────────────────────────────
import { resolverMomentum2D, celdaANodo } from './solver2d_momentum.js';

self.onmessage = (ev) => {
  const { mesh, opts } = ev.data;
  try {
    const r = resolverMomentum2D(mesh, {
      ...opts,
      onProgress: (t, tSim, paso) => self.postMessage({ tipo: 'progreso', t, tSim, paso }),
    });
    const hNodo = celdaANodo(r.mallaF, r.h), VNodo = celdaANodo(r.mallaF, r.V);
    const HNodo = new Float64Array(hNodo.length);
    for (let i = 0; i < HNodo.length; i++) HNodo[i] = hNodo[i] + (mesh.nodes[i].z || 0);
    const frames = (r.frames || []).map((f) => ({ t: f.t, h: celdaANodo(r.mallaF, f.h) }));
    // tiempo de arribo por NODO = mínimo de las celdas incidentes (no promedio:
    // "cuándo llega la onda" es el primer arribo, no la media).
    const tArrNodo = new Float64Array(hNodo.length).fill(-1);
    for (let c = 0; c < r.mallaF.tris.length; c++) {
      const ta = r.tArr[c]; if (ta < 0) continue;
      for (const i of r.mallaF.tris[c]) if (tArrNodo[i] < 0 || ta < tArrNodo[i]) tArrNodo[i] = ta;
    }
    self.postMessage({
      tipo: 'listo', h: hNodo, V: VNodo, H: HNodo, frames, tArr: tArrNodo, tArrMin: r.tArrMin,
      hmax: r.hmax, Vmax: r.Vmax, nMojados: r.nMojados, nCeldas: r.nCeldas,
      pasos: r.pasos, t: r.t, masaTotal: r.masaTotal,
    });
  } catch (e) {
    self.postMessage({ tipo: 'error', mensaje: e.message });
  }
};
