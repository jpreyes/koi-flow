// ─────────────────────────────────────────────────────────────────────────────
// frecuencia.js — análisis de frecuencia hidrológico (koi-flow, Fase 1).
// Toma una serie de máximos anuales y ajusta las 6 distribuciones del MC-V3,
// calcula los cuantiles para los T de diseño, la prueba de bondad Chi² y el R²,
// y elige la distribución de mejor ajuste (menor Chi² entre las aceptadas).
// ─────────────────────────────────────────────────────────────────────────────
import { Modelos, stats, normCdf, normInv, gammp, gumbelYnSn } from './distribuciones.js?v=5';

export const T_DISENO = [2, 5, 10, 25, 50, 100, 150, 200, 300];

// Momentos en escala logarítmica (ln para lognormal, log10 para log-pearson).
function logStats(serie, base) {
  const f = base === 10 ? Math.log10 : Math.log;
  const xs = serie.map((x) => f(Math.max(x, 1e-6)));   // evita log(0)
  return stats(xs);
}

// χ² de Pearson con intervalos de Sturges; gl = k − 1 − nParams.
function chi2(serie, model, nParams) {
  const n = serie.length;
  const k = Math.max(5, Math.min(20, Math.round(1 + 3.322 * Math.log10(n))));
  const sorted = [...serie].sort((a, b) => a - b);
  const min = sorted[0], max = sorted[n - 1], w = (max - min) / k;
  // prob. teórica por intervalo usando la inversa: comparamos vs cuantiles del modelo
  // Aproximación práctica: CDF empírica por conteo vs CDF del modelo en los bordes.
  const cdf = modelCdf(model);
  let X2 = 0;
  for (let i = 0; i < k; i++) {
    const lo = min + i * w, hi = i === k - 1 ? max + 1e-9 : min + (i + 1) * w;
    const obs = sorted.filter((x) => x >= lo && x < hi).length;
    const esp = n * (cdf(hi) - cdf(lo));
    if (esp > 0) X2 += (obs - esp) ** 2 / esp;
  }
  const gl = Math.max(1, k - 1 - nParams);
  return { X2, gl, critico: chi2Critico(gl) };
}

// CDF aproximada de cada modelo (para χ²), por inversión monótona de quantile(T).
function modelCdf(model) {
  // construye una tabla T↔x y la invierte; suficiente para conteos por intervalo.
  const Ts = [];
  for (let t = 1.0001; t <= 100000; t *= 1.15) Ts.push(t);
  const pts = Ts.map((T) => ({ x: model.quantile(T), P: 1 - 1 / T })).sort((a, b) => a.x - b.x);
  return (x) => {
    if (x <= pts[0].x) return Math.max(0, pts[0].P * 0.5);
    if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].P;
    for (let i = 0; i < pts.length - 1; i++) {
      if (x >= pts[i].x && x <= pts[i + 1].x) {
        const t = (x - pts[i].x) / (pts[i + 1].x - pts[i].x || 1e-9);
        return pts[i].P + t * (pts[i + 1].P - pts[i].P);
      }
    }
    return pts[pts.length - 1].P;
  };
}

// χ² crítico (α=0.05) por grados de libertad — tabla.
function chi2Critico(gl) {
  const T = { 1: 3.84, 2: 5.99, 3: 7.81, 4: 9.49, 5: 11.07, 6: 12.59, 7: 14.07, 8: 15.51, 9: 16.92, 10: 18.31, 11: 19.68, 12: 21.03, 13: 22.36, 14: 23.68, 15: 25.00 };
  return T[gl] || 25.0;
}

// R² entre cuantiles del modelo y la serie ordenada (posición de Weibull).
function r2(serie, model) {
  const n = serie.length, sorted = [...serie].sort((a, b) => a - b);
  const obs = sorted, est = sorted.map((_, i) => model.quantile(1 / (1 - (i + 1) / (n + 1))));
  const mObs = obs.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (obs[i] - est[i]) ** 2; ssTot += (obs[i] - mObs) ** 2; }
  return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

// Análisis completo. `moments` opcional permite forzar momentos (validación S17).
export function analizar(serie, opts = {}) {
  const Ts = opts.T || T_DISENO;
  const m = stats(serie);
  const mLn = logStats(serie, Math.E), mLog = logStats(serie, 10);
  const { Yn, Sn } = opts.gumbel || gumbelYnSn(m.n);

  const defs = {
    normal: { model: Modelos.normal({ mean: m.mean, std: m.std }), np: 2 },
    lognormal: { model: Modelos.lognormal({ meanLn: mLn.mean, stdLn: mLn.std }), np: 2 },
    pearson3: { model: Modelos.pearson3({ mean: m.mean, std: m.std, skew: m.skew }), np: 3 },
    logpearson3: { model: Modelos.logpearson3({ meanLog: mLog.mean, stdLog: mLog.std, skewLog: mLog.skew }), np: 3 },
    gumbel: { model: Modelos.gumbel({ mean: m.mean, std: m.std, Yn, Sn }), np: 2 },
    gamma: { model: Modelos.gamma({ mean: m.mean, std: m.std }), np: 2 },
  };

  const resultados = {};
  for (const [name, d] of Object.entries(defs)) {
    const q = {}; for (const T of Ts) q[T] = d.model.quantile(T);
    const g = chi2(serie, d.model, d.np);
    resultados[name] = {
      params: d.model.params, quantiles: q,
      chi2: g.X2, gl: g.gl, critico: g.critico, aceptado: g.X2 <= g.critico,
      r2: r2(serie, d.model),
    };
  }

  // mejor = menor χ² entre las aceptadas (si ninguna, la de menor χ²).
  const orden = Object.entries(resultados).sort((a, b) => a[1].chi2 - b[1].chi2);
  const aceptadas = orden.filter(([, r]) => r.aceptado);
  const mejor = (aceptadas[0] || orden[0])[0];

  return { stats: m, statsLn: mLn, statsLog: mLog, T: Ts, resultados, mejor };
}
