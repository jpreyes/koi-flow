// ─────────────────────────────────────────────────────────────────────────────
// distribuciones.js — funciones de distribución para análisis de frecuencia
// hidrológico (koi-flow, Fase 1). Métodos del Manual de Carreteras Vol.3 / DGA:
// Normal, Log-Normal, Pearson III, Log-Pearson III, Gumbel (valores extremos I)
// y Gamma. Cada modelo entrega el cuantil X(T) para un período de retorno T.
//
// Convención: T = período de retorno (años) → prob. de NO excedencia P = 1 − 1/T.
// Validado contra el informe S17 (estación Camiña). Ver test_frecuencia.mjs.
// ─────────────────────────────────────────────────────────────────────────────

// ── Funciones especiales ─────────────────────────────────────────────────────

// Inversa de la normal estándar Φ⁻¹(p) — algoritmo de Acklam (err < 1.15e-9).
export function normInv(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= ph) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// CDF normal estándar Φ(z).
export function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
function erf(x) { // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// ln Γ(x) — Lanczos.
export function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Gamma incompleta regularizada inferior P(s,x) = γ(s,x)/Γ(s).
export function gammp(s, x) {
  if (x <= 0) return 0;
  if (x < s + 1) { // serie
    let ap = s, sum = 1 / s, del = sum;
    for (let n = 0; n < 200; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return sum * Math.exp(-x + s * Math.log(x) - lgamma(s));
  } else { // fracción continua (complemento)
    const FPMIN = 1e-300; let b = x + 1 - s, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 200; i++) { const an = -i * (i - s); b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN; c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break; }
    return 1 - Math.exp(-x + s * Math.log(x) - lgamma(s)) * h;
  }
}

// Inversa de la gamma regularizada: x tal que P(s,x)=p.
export function gammpInv(s, p) {
  if (p <= 0) return 0; if (p >= 1) return s + 10 * Math.sqrt(s) + 100;
  // semilla (Wilson-Hilferty) + Newton-Raphson
  let x = s * Math.pow(1 - 1 / (9 * s) + normInv(p) / (3 * Math.sqrt(s)), 3);
  if (x <= 0) x = 1e-3;
  for (let i = 0; i < 60; i++) {
    const f = gammp(s, x) - p;
    const pdf = Math.exp((s - 1) * Math.log(x) - x - lgamma(s)); // dP/dx
    if (pdf < 1e-300) break;
    let dx = f / pdf; // Newton
    // amortigua pasos grandes
    if (dx > x) dx = 0.5 * x; if (dx < -x) dx = -0.5 * x;
    x -= dx;
    if (x <= 0) x = 1e-6;
    if (Math.abs(dx) < 1e-10 * x) break;
  }
  return x;
}

// ── Estadísticos de una muestra ──────────────────────────────────────────────
export function stats(serie) {
  const n = serie.length, mean = serie.reduce((a, b) => a + b, 0) / n;
  let s2 = 0, s3 = 0;
  for (const x of serie) { const d = x - mean; s2 += d * d; s3 += d * d * d; }
  const std = Math.sqrt(s2 / (n - 1));
  const skew = (n / ((n - 1) * (n - 2))) * s3 / Math.pow(std, 3); // asimetría insesgada
  return { n, mean, std, skew };
}

// ── Factor de frecuencia Pearson III (Wilson-Hilferty) ───────────────────────
export function kPearson(Cs, P) {
  const z = normInv(P);
  if (Math.abs(Cs) < 1e-6) return z;
  const k = Cs / 6;
  return (2 / Cs) * (Math.pow((z - k) * k + 1, 3) - 1);
}

// ── Modelos: cada uno fit(serie|moments) → {quantile(T), params} ──────────────
// P de no-excedencia para T:
const PnoExc = (T) => 1 - 1 / T;

export const Modelos = {
  normal(m) { // m: {mean, std}
    return { params: { m: m.mean, s: m.std }, quantile: (T) => m.mean + normInv(PnoExc(T)) * m.std };
  },
  lognormal(m) { // m: {meanLn, stdLn}  (logaritmo natural)
    return { params: { mLn: m.meanLn, sLn: m.stdLn }, quantile: (T) => Math.exp(m.meanLn + normInv(PnoExc(T)) * m.stdLn) };
  },
  pearson3(m) { // m: {mean, std, skew}
    return { params: { m: m.mean, s: m.std, Cs: m.skew }, quantile: (T) => m.mean + kPearson(m.skew, PnoExc(T)) * m.std };
  },
  logpearson3(m) { // m: {meanLog, stdLog, skewLog}  (log base 10)
    return { params: { mLog: m.meanLog, sLog: m.stdLog, CsLog: m.skewLog }, quantile: (T) => Math.pow(10, m.meanLog + kPearson(m.skewLog, PnoExc(T)) * m.stdLog) };
  },
  gumbel(m) { // m: {mean, std, Yn, Sn}  (Yn,Sn tabulados por tamaño de muestra)
    const Yn = m.Yn, Sn = m.Sn;
    return { params: { m: m.mean, s: m.std, Yn, Sn }, quantile: (T) => { const yT = -Math.log(-Math.log(PnoExc(T))); return m.mean + m.std * (yT - Yn) / Sn; } };
  },
  gamma(m) { // m: {mean, std}  → gamma de 2 parámetros (forma k, escala θ)
    const k = (m.mean / m.std) ** 2, theta = m.std * m.std / m.mean;
    return { params: { k, theta }, quantile: (T) => theta * gammpInv(k, PnoExc(T)) };
  },
};

// Yn, Sn de Gumbel en función del tamaño de muestra n (Ven Te Chow / tablas DGA).
const YN = { 10: [0.4952, 0.9496], 15: [0.5128, 1.0206], 20: [0.5236, 1.0628], 25: [0.5309, 1.0915], 30: [0.5362, 1.1124], 35: [0.5403, 1.1285], 40: [0.5436, 1.1413], 45: [0.5463, 1.1518], 50: [0.5485, 1.1607], 60: [0.5521, 1.1747], 70: [0.5548, 1.1854], 100: [0.5600, 1.2065] };
export function gumbelYnSn(n) {
  const keys = Object.keys(YN).map(Number).sort((a, b) => a - b);
  if (n <= keys[0]) return { Yn: YN[keys[0]][0], Sn: YN[keys[0]][1] };
  if (n >= keys[keys.length - 1]) return { Yn: YN[keys[keys.length - 1]][0], Sn: YN[keys[keys.length - 1]][1] };
  for (let i = 0; i < keys.length - 1; i++) {
    if (n >= keys[i] && n <= keys[i + 1]) {
      const t = (n - keys[i]) / (keys[i + 1] - keys[i]);
      return { Yn: YN[keys[i]][0] + t * (YN[keys[i + 1]][0] - YN[keys[i]][0]), Sn: YN[keys[i]][1] + t * (YN[keys[i + 1]][1] - YN[keys[i]][1]) };
    }
  }
}
