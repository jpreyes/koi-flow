// ─────────────────────────────────────────────────────────────────────────────
// morfo1d.js — Lecho móvil 1D quasi-unsteady (koi-flow). MC-V3 3.707 / HEC-RAS
// sediment. Transita un HIDROGRAMA por un tramo discretizado y actualiza la cota del
// lecho por continuidad de sedimentos (Exner), agradando o degradando según el
// balance capacidad-aporte a lo largo del evento.
//   Capacidad por nodo: Meyer-Peter-Müller (qs·B).  Aporte aguas arriba = r·capacidad.
//   Exner:  ∂z/∂t = −1/(1−p)·(1/B)·∂Qs/∂x   (esquema upwind, flujo hacia x creciente).
// Sub-pasos internos para estabilidad. Unidades SI; x creciente AGUAS ABAJO.
// ─────────────────────────────────────────────────────────────────────────────
import { meyerPeterMuller } from '../hidro/sedimentos.js';

// Construye un tramo prismático de N nodos: dx, pendiente S0, ancho B, Manning n.
export function tramoPrismatico({ L = 1000, N = 11, S0 = 0.005, B = 30, n = 0.035, z0 = 100 }) {
  const dx = L / (N - 1);
  return Array.from({ length: N }, (_, i) => ({ x: i * dx, B, n, z: z0 - S0 * i * dx }));
}

function resample(hg, dt) {
  const tMax = hg[hg.length - 1].t, qE = hg[hg.length - 1].Q, n = Math.max(2, Math.round(tMax / dt));
  const interp = (t) => { if (t <= hg[0].t) return hg[0].Q; if (t >= tMax) return qE; for (let i = 1; i < hg.length; i++) if (t <= hg[i].t) { const a = hg[i - 1], b = hg[i], r = (t - a.t) / ((b.t - a.t) || 1); return a.Q + r * (b.Q - a.Q); } return qE; };
  return Array.from({ length: n + 1 }, (_, i) => ({ t: i * dt, Q: interp(i * dt) }));
}

// Simula el lecho móvil. nodos = [{x,B,n,z}] (x creciente aguas abajo). hidrograma=[{t,Q}].
export function morfo1d(nodos, hidrograma, o = {}) {
  const { D50mm = 20, s = 2.65, poros = 0.4, razonAporte = 1.0, dt = 300, monitor = null } = o;
  const N = nodos.length;
  const D = Math.max(D50mm, 0.1) / 1000;
  const z = nodos.map((nd) => nd.z);
  const dzAcum = new Array(N).fill(0);
  const mon = monitor != null ? monitor : Math.floor(N / 2);
  const H = resample(hidrograma, dt);
  const serie = [];
  const capacidad = (Q, i) => {
    let S;
    if (i < N - 1) S = (z[i] - z[i + 1]) / (nodos[i + 1].x - nodos[i].x);
    else S = (z[i - 1] - z[i]) / (nodos[i].x - nodos[i - 1].x);
    S = Math.max(1e-4, S);
    const h = Math.pow((Q * nodos[i].n) / (nodos[i].B * Math.sqrt(S)), 3 / 5);
    return meyerPeterMuller(h, S, D, { s }).qsf * nodos[i].B;   // m³/s
  };
  for (let k = 1; k < H.length; k++) {
    const Q = 0.5 * (H[k].Q + H[k - 1].Q), step = H[k].t - H[k - 1].t;
    const Qs = Array.from({ length: N }, (_, i) => capacidad(Q, i));
    const QsIn = razonAporte * Qs[0];
    for (let i = 0; i < N; i++) {
      const QsUp = i === 0 ? QsIn : Qs[i - 1];
      const dx = i === 0 ? (nodos[1].x - nodos[0].x) : (nodos[i].x - nodos[i - 1].x);
      const dz = -step / ((1 - poros) * nodos[i].B * dx) * (Qs[i] - QsUp);
      z[i] += dz; dzAcum[i] += dz;
    }
    serie.push({ t: H[k].t, Q, dz: dzAcum[mon] });
  }
  const perfil = nodos.map((nd, i) => ({
    x: nd.x, zIni: nd.z, zFin: z[i], dz: dzAcum[i],
    tendencia: dzAcum[i] < -1e-3 ? 'erosión' : dzAcum[i] > 1e-3 ? 'depósito' : 'estable',
  }));
  const dzMin = Math.min(...dzAcum), dzMax = Math.max(...dzAcum);
  return { perfil, serie, mon, degradacionMax: -dzMin > 0 ? -dzMin : 0, agradacionMax: dzMax > 0 ? dzMax : 0, dzMonitor: dzAcum[mon] };
}
