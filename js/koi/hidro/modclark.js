// ─────────────────────────────────────────────────────────────────────────────
// modclark.js — Transformada de Clark / ModClark grillado (koi-flow, HMS-lite).
// Traslada la lluvia efectiva por el histograma tiempo-área (isócronas) y la rutea por
// un reservorio lineal (coef. de almacenamiento R). La versión ModClark admite lluvia
// ESPACIALMENTE VARIABLE por zonas de tiempo de viaje (grilla → sesgo cerca/lejos).
//   Clark:  O_i = CA·I_i + CB·O_{i−1} ,  CA = Δt/(R+0.5Δt) ,  CB = 1−CA
// Unidades SI. Tc, R en horas; area km²; dt s.
// ─────────────────────────────────────────────────────────────────────────────
import { hietogramaIncremental, efectivaIncremental } from './convolucion.js';

// Histograma tiempo-área adimensional (SCS): fracción de área por banda de viaje.
export function timeAreaSCS(Nb) {
  const Acum = (tau) => (tau <= 0.5 ? 1.414 * Math.pow(tau, 1.5) : 1 - 1.414 * Math.pow(1 - tau, 1.5));
  const frac = []; let prev = 0;
  for (let j = 1; j <= Nb; j++) { const a = Math.min(1, Acum(j / Nb)); frac.push(Math.max(0, a - prev)); prev = a; }
  return frac;
}

// Pesos de lluvia por banda desde un sesgo g∈[-1,1]: g>0 más lluvia cerca del punto de
// salida (bandas tempranas), g<0 más lluvia aguas arriba. Media normalizada a 1.
export function pesosSesgo(Nb, g = 0) {
  const w = Array.from({ length: Nb }, (_, j) => 1 + g * (1 - 2 * j / Math.max(1, Nb - 1)));
  const m = w.reduce((a, b) => a + b, 0) / Nb || 1;
  return w.map((x) => Math.max(0, x / m));
}

// Hidrograma por ModClark: tormenta de diseño + lluvia grillada (sesgo o pesos).
export function hidrogramaModClark({ Tc, R, area, dt = 600 }, { Ptotal, durH, CN, sesgo = 0, pesos = null } = {}) {
  const Nb = Math.max(2, Math.round((Tc * 3600) / dt));
  const areaFrac = timeAreaSCS(Nb);
  const w = (pesos && pesos.length === Nb) ? pesos : pesosSesgo(Nb, sesgo);
  const dtH = dt / 3600;
  const peInc = efectivaIncremental(hietogramaIncremental(Ptotal, { durH, dtH, patron: 'alterno' }), CN);
  const nT = peInc.length + Nb + 5;
  const I = new Array(nT).fill(0);
  const conv = (area * 1e6 * 1e-3) / dt;               // m³/s por mm por (areaFrac·w)
  for (let k = 0; k < peInc.length; k++) for (let j = 0; j < Nb; j++) I[k + j] += peInc[k] * areaFrac[j] * w[j] * conv;
  const RS = R * 3600, CA = dt / (RS + 0.5 * dt), CB = 1 - CA;
  const O = new Array(nT).fill(0);
  for (let i = 1; i < nT; i++) O[i] = CA * I[i] + CB * O[i - 1];
  return { out: O.map((q, i) => ({ t: i * dt, Q: q })), Qpico: Math.max(...O), Nb, areaFrac, w, PeTotal: peInc.reduce((a, b) => a + b, 0), dt };
}
