// ─────────────────────────────────────────────────────────────────────────────
// convolucion.js — Hidrograma de crecida por CONVOLUCIÓN del hidrograma unitario
// (koi-flow). Cierra la cadena lluvia→escorrentía: hietograma de diseño → lluvia
// efectiva incremental (SCS acumulada) → convolución con el HU Linsley → hidrograma
// de tormenta completo (no solo el pico), listo para transitar (embalse/cauce).
//
// Paso de tiempo = duración unitaria del HU (tu = tp/5.5) para convolucionar sin
// recurrir a la curva-S. Unidades SI; P [mm], Q [m³/s], t [s].
// ─────────────────────────────────────────────────────────────────────────────
import { linsley, ordenadasUH } from './hidrograma.js';

// Hietograma incremental (mm por bloque) para una lluvia total Ptot y duración durH.
//   patron: 'alterno' (bloques alternos, pico al centro, decaimiento i∝d^-m) ·
//           'triangular' · 'uniforme'.  Suma de bloques = Ptot.
export function hietogramaIncremental(Ptot, { durH, dtH, patron = 'alterno', m = 0.7 } = {}) {
  const n = Math.max(1, Math.round(durH / dtH));
  let w;
  if (patron === 'uniforme') w = Array(n).fill(1);
  else if (patron === 'triangular') { const c = (n - 1) / 2; w = Array.from({ length: n }, (_, i) => Math.max(0.01, 1 - Math.abs(i - c) / (c + 1))); }
  else {
    const Pac = Array.from({ length: n }, (_, k) => Math.pow((k + 1) * dtH, 1 - m)); // profundidad acumulada ∝ d^(1-m)
    const incr = Pac.map((v, i) => (i ? v - Pac[i - 1] : v)).sort((a, b) => b - a);   // incrementos decrecientes
    w = Array(n); let Lp = Math.floor((n - 1) / 2), Rp = Lp + 1, side = 0;
    for (const val of incr) { if (side === 0) { w[Lp] = val; Lp--; } else { w[Rp] = val; Rp++; } side ^= 1; }
  }
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => (Ptot * x) / sum);
}

// Lluvia efectiva INCREMENTAL por bloque (SCS acumulada: la abstracción se aplica a la
// lluvia acumulada y se diferencia — no bloque a bloque).
export function efectivaIncremental(hietoInc, CN) {
  const S = 25400 / CN - 254, Ia = 0.2 * S;
  let Pac = 0, PeAc = 0; const out = [];
  for (const p of hietoInc) {
    Pac += p;
    const Pe = Pac > Ia ? Math.pow(Pac - Ia, 2) / (Pac - Ia + S) : 0;
    out.push(Math.max(0, Pe - PeAc)); PeAc = Pe;
  }
  return out;
}

// Resamplea el HU (curva t[h]→q[m³/s/mm]) a paso uniforme dtH.
export function uhUniforme(ord, dtH) {
  const tMax = ord[ord.length - 1].t, K = Math.ceil(tMax / dtH);
  const interp = (t) => {
    if (t <= ord[0].t) return ord[0].q;
    if (t >= tMax) return 0;
    for (let i = 1; i < ord.length; i++) if (t <= ord[i].t) { const a = ord[i - 1], b = ord[i], r = (t - a.t) / ((b.t - a.t) || 1); return a.q + r * (b.q - a.q); }
    return 0;
  };
  return Array.from({ length: K + 1 }, (_, k) => interp(k * dtH));
}

// Convolución discreta: Q(i) = Σ_j Pe(j)·u(i−j).
export function convolucion(peInc, u) {
  const Q = new Array(peInc.length + u.length - 1).fill(0);
  for (let j = 0; j < peInc.length; j++) for (let k = 0; k < u.length; k++) Q[j + k] += peInc[j] * u[k];
  return Q;
}

// Hidrograma de crecida completo desde morfometría, lluvia total y CN.
export function hidrogramaTormenta(morfo, { Ptotal, durH, CN, zona = 1, patron = 'alterno', baseflow = 0 } = {}) {
  const par = linsley(morfo, zona);
  const dtH = par.tu;                                   // paso = duración unitaria del HU
  const hietoInc = hietogramaIncremental(Ptotal, { durH, dtH, patron });
  const peInc = efectivaIncremental(hietoInc, CN);
  const u = uhUniforme(ordenadasUH(par), dtH);
  // normaliza el HU a volumen unitario (1 mm → A·1000 m³) para conservar masa exacta.
  if (morfo.A > 0) {
    const volU = u.reduce((a, b) => a + b, 0) * dtH * 3600, target = morfo.A * 1000;
    if (volU > 0) for (let i = 0; i < u.length; i++) u[i] *= target / volU;
  }
  const Qd = convolucion(peInc, u);
  const out = Qd.map((q, i) => ({ t: i * dtH * 3600, Q: q + baseflow }));
  const Qpico = out.length ? Math.max(...out.map((p) => p.Q)) : 0;
  const volumen = Qd.reduce((a, b) => a + b, 0) * dtH * 3600;   // m³ escorrentía directa
  return { out, Qpico, dtH, tu: par.tu, tp: par.tp, PeTotal: peInc.reduce((a, b) => a + b, 0), volumen, par, hietoInc, peInc };
}
