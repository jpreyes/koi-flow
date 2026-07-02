// ─────────────────────────────────────────────────────────────────────────────
// calibracion.js — Calibración automática de parámetros (koi-flow, HMS-lite).
// Optimizador in-house Nelder-Mead (símplex, sin librerías) que ajusta los parámetros
// del modelo continuo a una serie observada maximizando Nash-Sutcliffe (NSE).
// ─────────────────────────────────────────────────────────────────────────────
import { simularContinuo } from './continuo.js';

// Nash-Sutcliffe: 1=perfecto · 0=igual que la media · <0=peor que la media.
export function nse(sim, obs) {
  const n = Math.min(sim.length, obs.length);
  let m = 0; for (let i = 0; i < n; i++) m += obs[i]; m /= n || 1;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (sim[i] - obs[i]) ** 2; den += (obs[i] - m) ** 2; }
  return den > 0 ? 1 - num / den : -Infinity;
}
export function rmse(sim, obs) {
  const n = Math.min(sim.length, obs.length);
  let s = 0; for (let i = 0; i < n; i++) s += (sim[i] - obs[i]) ** 2;
  return Math.sqrt(s / (n || 1));
}

// Nelder-Mead genérico: minimiza f(x) desde x0 (vector). Sin dependencias.
export function nelderMead(f, x0, { paso = 0.1, maxIter = 300, tol = 1e-6 } = {}) {
  const n = x0.length;
  const simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += (p[i] || 1) * paso || paso; simplex.push(p); }
  let fv = simplex.map(f);
  const ord = () => { const idx = fv.map((v, i) => i).sort((a, b) => fv[a] - fv[b]); simplex.splice(0, simplex.length, ...idx.map((i) => simplex[i])); fv.splice(0, fv.length, ...idx.map((i) => fv[i])); };
  const [a, g, r, s] = [1, 2, 0.5, 0.5];               // reflexión, expansión, contracción, encogimiento
  for (let it = 0; it < maxIter; it++) {
    ord();
    if (Math.abs(fv[n] - fv[0]) < tol) break;
    const cen = new Array(n).fill(0);                  // centroide sin el peor
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j] += simplex[i][j] / n;
    const xr = cen.map((c, j) => c + a * (c - simplex[n][j])), fr = f(xr);
    if (fr < fv[0]) {
      const xe = cen.map((c, j) => c + g * (xr[j] - c)), fe = f(xe);
      if (fe < fr) { simplex[n] = xe; fv[n] = fe; } else { simplex[n] = xr; fv[n] = fr; }
    } else if (fr < fv[n - 1]) { simplex[n] = xr; fv[n] = fr; }
    else {
      const xc = cen.map((c, j) => c + r * (simplex[n][j] - c)), fc = f(xc);
      if (fc < fv[n]) { simplex[n] = xc; fv[n] = fc; }
      else for (let i = 1; i <= n; i++) { simplex[i] = simplex[0].map((x0j, j) => x0j + s * (simplex[i][j] - x0j)); fv[i] = f(simplex[i]); }
    }
  }
  ord();
  return { x: simplex[0], fval: fv[0] };
}

// Calibra el modelo continuo ajustando `claves` (nombres de parámetros) a Qobs.
export function calibrarContinuo(serie, Qobs, { base = {}, claves = ['Cm', 'Smax', 'kBase'], lb = {}, ub = {} } = {}) {
  const LB = { Cm: 0.5, Smax: 20, kBase: 0.005, kPerc: 0.01, ...lb };
  const UB = { Cm: 10, Smax: 400, kBase: 0.2, kPerc: 0.3, ...ub };
  const x0 = claves.map((k) => base[k] ?? (LB[k] + UB[k]) / 2);
  const aParams = (x) => { const p = { ...base }; claves.forEach((k, i) => { p[k] = Math.min(UB[k], Math.max(LB[k], x[i])); }); return p; };
  const objetivo = (x) => {
    const r = simularContinuo(serie, aParams(x));
    const sim = r.serie.map((d) => d.Q);
    return 1 - nse(sim, Qobs);                          // minimizar 1−NSE
  };
  const { x } = nelderMead(objetivo, x0, { paso: 0.15, maxIter: 400 });
  const params = aParams(x);
  const r = simularContinuo(serie, params);
  const sim = r.serie.map((d) => d.Q);
  return { params, nse: +nse(sim, Qobs).toFixed(4), rmse: +rmse(sim, Qobs).toFixed(3), sim, sal: r };
}
