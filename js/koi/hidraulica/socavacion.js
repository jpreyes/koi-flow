// ─────────────────────────────────────────────────────────────────────────────
// socavacion.js — socavación en cauces y puentes (koi-flow, Fase 4).
// MC-V3 3.707.4 / 3.1000 (Puentes y estructuras afines):
//   • Socavación GENERAL por contracción — Lischtvan-Lebediev (Maza/Juárez Badillo),
//     suelos granulares y cohesivos.
//   • Velocidad competente de Neill (1973) — chequeo lecho vivo / agua clara.
//   • Socavación LOCAL en pilas — HEC-18 / CSU (Colorado State University).
//
// Insumos: resultado hidráulico de manning.js (h, V, Fr, ancho) + granulometría
// (D50). Unidades SI; D50 se ingresa en mm y se convierte internamente.
// ─────────────────────────────────────────────────────────────────────────────

const G = 9.81;

// Exponente x de Lischtvan-Lebediev para suelo GRANULAR, según dm [mm] (tabla Maza).
const X_GRAN = [
  [0.05, 0.43], [0.15, 0.42], [0.50, 0.41], [1.0, 0.40], [1.5, 0.39], [2.5, 0.38],
  [4, 0.37], [6, 0.36], [8, 0.35], [10, 0.34], [15, 0.33], [20, 0.32], [25, 0.31],
  [40, 0.30], [60, 0.29], [90, 0.28], [140, 0.27], [190, 0.26], [250, 0.25],
  [310, 0.24], [370, 0.23], [450, 0.22], [570, 0.21], [750, 0.20], [1000, 0.19],
];
// Exponente x para suelo COHESIVO, según peso específico seco γs [t/m³] (tabla Maza).
const X_COH = [
  [0.80, 0.52], [0.83, 0.51], [0.86, 0.50], [0.88, 0.49], [0.90, 0.48], [0.93, 0.47],
  [0.96, 0.46], [0.98, 0.45], [1.00, 0.44], [1.04, 0.43], [1.08, 0.42], [1.12, 0.41],
  [1.16, 0.40], [1.20, 0.39], [1.24, 0.38], [1.28, 0.37], [1.34, 0.36], [1.40, 0.35],
  [1.46, 0.34], [1.52, 0.33], [1.58, 0.32], [1.64, 0.31], [1.71, 0.30], [1.80, 0.29], [1.89, 0.28],
];

function interpTabla(tabla, v) {
  if (v <= tabla[0][0]) return tabla[0][1];
  if (v >= tabla[tabla.length - 1][0]) return tabla[tabla.length - 1][1];
  for (let i = 1; i < tabla.length; i++) {
    if (v <= tabla[i][0]) {
      const [x0, y0] = tabla[i - 1], [x1, y1] = tabla[i];
      const t = (Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
      return y0 + t * (y1 - y0);
    }
  }
  return tabla[tabla.length - 1][1];
}

// Coeficiente β de frecuencia (probabilidad de retorno T años). Maza: β = 0.7929 + 0.0973·log10(T).
export function betaFrecuencia(T = 100) {
  return Math.max(0.77, Math.min(1.07, 0.7929 + 0.0973 * Math.log10(Math.max(1, T))));
}

// Coeficiente α del caudal de diseño: α = Q / (Hm^(5/3)·Be·μ).
//   Hm = profundidad media, Be = ancho efectivo de la superficie libre, μ = coef. de contracción.
export function alfaLL({ Q, Hm, Be, mu = 1 }) {
  return Q / (Math.pow(Hm, 5 / 3) * Be * mu);
}

// Socavación GENERAL (Lischtvan-Lebediev) en una vertical de profundidad h [m].
//   Devuelve Hs (profundidad total desde la superficie tras la socavación) y la
//   profundidad de socavación = Hs − h.
export function socavacionVertical(h, { alfa, beta = 1, D50mm, cohesivo = false, gammaS = 1.5 }) {
  if (h <= 0) return { h, Hs: 0, socav: 0, x: 0 };
  let coef, x;
  if (cohesivo) { x = interpTabla(X_COH, gammaS); coef = 0.60 * beta * Math.pow(gammaS, 1.18); }
  else { x = interpTabla(X_GRAN, D50mm); coef = 0.68 * beta * Math.pow(D50mm, 0.28); }
  const Hs = Math.pow((alfa * Math.pow(h, 5 / 3)) / coef, 1 / (1 + x));
  return { h, Hs, socav: Math.max(0, Hs - h), x, coef };
}

// Socavación GENERAL a lo largo de la sección (perfil de verticales bajo el agua).
//   sec = resultado de manning.nivelNormal (WSE, A, B, V, Fr…); pts = [{s,z}] de la
//   sección; D50mm; T; mu; cohesivo…  Devuelve el perfil de socavación y el máximo.
export function socavacionGeneral(sec, pts, { Q, D50mm = 20, T = 100, mu = 1, cohesivo = false, gammaS = 1.5 } = {}) {
  const puntos = pts, WSE = sec.WSE;
  // verticales mojadas (h>0) y ancho efectivo
  const vert = [];
  let Be = 0, sumH = 0;
  for (const p of puntos) {
    const h = WSE - p.z;
    if (h > 0) { vert.push({ s: p.s, h, z: p.z }); sumH += h; }
  }
  if (vert.length < 2) return { perfil: [], socavMax: 0, Hm: 0, Be: 0 };
  Be = vert[vert.length - 1].s - vert[0].s;
  const Hm = sec.A > 0 && sec.B > 0 ? sec.A / sec.B : (sumH / vert.length);
  const beta = betaFrecuencia(T);
  const alfa = alfaLL({ Q, Hm, Be, mu });
  let socavMax = 0, zLecho = Infinity;
  const perfil = vert.map((v) => {
    const r = socavacionVertical(v.h, { alfa, beta, D50mm, cohesivo, gammaS });
    const zFondo = WSE - r.Hs;                  // cota del fondo socavado
    socavMax = Math.max(socavMax, r.socav);
    zLecho = Math.min(zLecho, zFondo);
    return { s: v.s, z: v.z, h: v.h, Hs: r.Hs, socav: r.socav, zFondo };
  });
  return { perfil, socavMax, Hm, Be, alfa, beta, zLechoMin: zLecho, WSE };
}

// Velocidad competente de Neill (1973): velocidad media crítica que inicia la
// socavación. Vc = 1.58·[(s−1)·g·D50]^0.5·(h/D50)^(1/6)  (forma tipo Neill/Maza).
export function velocidadCompetente(h, D50mm, { s = 2.65 } = {}) {
  const D = D50mm / 1000;
  return 1.58 * Math.sqrt((s - 1) * G * D) * Math.pow(h / D, 1 / 6);
}

// Socavación GENERAL por VELOCIDAD COMPETENTE de Neill: el lecho se socava hasta que
// la velocidad media iguala la competente Vc(ds). Con q = caudal unitario:
//   q = ds·Vc(ds) = 1.58·√((s−1)gD)·D^(−1/6)·ds^(7/6)  →  ds = [q / k]^(6/7)
//   socavación = ds − prof. media actual.  Alternativa a Lischtvan-Lebediev.
export function socavacionGeneralNeill(sec, pts, { Q, D50mm = 20, s = 2.65 } = {}) {
  const { WSE } = sec;
  let Be = 0, first = null, last = null, sumH = 0, nH = 0;
  for (const p of pts) { const h = WSE - p.z; if (h > 0) { if (first == null) first = p.s; last = p.s; sumH += h; nH++; } }
  if (nH < 2) return { ds: 0, socav: 0, Hm: 0, q: 0 };
  Be = Math.max(1e-3, last - first);
  const Hm = sec.A > 0 && sec.B > 0 ? sec.A / sec.B : sumH / nH;
  const q = Q / Be;                                   // caudal unitario [m²/s]
  const D = Math.max(D50mm, 0.1) / 1000;
  const k = 1.58 * Math.sqrt((s - 1) * G * D) * Math.pow(D, -1 / 6);
  const ds = Math.pow(q / k, 6 / 7);                  // profundidad de equilibrio
  return { ds: +ds.toFixed(3), socav: +Math.max(0, ds - Hm).toFixed(3), Hm: +Hm.toFixed(3), q: +q.toFixed(3), zLecho: +(WSE - ds).toFixed(2) };
}

// Socavación LOCAL en pila — HEC-18 / CSU:
//   ys = 2.0·K1·K2·K3·y1·(a/y1)^0.65·Fr1^0.43
//   a = ancho de la pila [m]; y1 = prof. aguas arriba; Fr1 = Froude aguas arriba.
//   K1 forma pila, K2 ángulo de ataque (θ, largo L), K3 condición del lecho.
export function socavacionLocalPila({ a, y1, Fr1, forma = 'circular', theta = 0, Lpila = 0, K3 = 1.1 }) {
  const K1_TAB = { circular: 1.0, redondeada: 1.0, cuadrada: 1.1, chaflan: 0.9, biselada: 0.9, grupo: 1.0 };
  const K1 = K1_TAB[forma] ?? 1.0;
  let K2 = 1.0;
  if (theta > 0 && Lpila > 0) K2 = Math.pow(Math.cos(theta * Math.PI / 180) + (Lpila / a) * Math.sin(theta * Math.PI / 180), 0.65);
  const ys = 2.0 * K1 * K2 * K3 * y1 * Math.pow(a / y1, 0.65) * Math.pow(Fr1, 0.43);
  return { ys, K1, K2, K3 };
}

// D50 del ESTRATO a una profundidad bajo el lecho (macrogranulometría por capas).
//   strata: [{espesor [m], D50mm}] de arriba hacia abajo. Si no hay, usa D50def.
export function d50EnProfundidad(strata, profBajoLecho, D50def) {
  if (!strata || !strata.length) return D50def;
  let acc = 0;
  for (const c of strata) { acc += c.espesor; if (profBajoLecho <= acc) return c.D50mm; }
  return strata[strata.length - 1].D50mm;
}

// Profundidad de equilibrio de Neill para un caudal unitario qu, con D50 variable por
// estrato y TOPE en la roca (no socava bajo ella). Devuelve la socavación (ds − h).
function neillCapas(qu, h, { D50mm, s, strata, roca }) {
  let ds = h;
  for (let it = 0; it < 25; it++) {
    const D = Math.max(d50EnProfundidad(strata, ds - h, D50mm), 0.1) / 1000;
    const k = 1.58 * Math.sqrt((s - 1) * G * D) * Math.pow(D, -1 / 6);
    const dn = Math.pow(qu / k, 6 / 7);
    if (Math.abs(dn - ds) < 0.005) { ds = dn; break; } ds = dn;
  }
  if (isFinite(roca)) ds = Math.min(ds, h + roca);     // roca medida bajo el lecho actual
  return Math.max(0, ds - h);
}

// Lischtvan-Lebediev en UNA vertical de calado h, con D50 variable por estrato y tope
// de roca: Hs = [α·h^{5/3} / coef]^{1/(1+x)}, coef y x según el material a esa prof.
function llCapas(alfa, beta, h, { D50mm, strata, roca, cohesivo = false, gammaS = 1.5 }) {
  let ds = h * 1.2;
  for (let it = 0; it < 25; it++) {
    let x, coef;
    if (cohesivo) { x = interpTabla(X_COH, gammaS); coef = 0.60 * beta * Math.pow(gammaS, 1.18); }
    else { const D50 = d50EnProfundidad(strata, ds - h, D50mm); x = interpTabla(X_GRAN, D50); coef = 0.68 * beta * Math.pow(D50, 0.28); }
    const dn = Math.pow((alfa * Math.pow(h, 5 / 3)) / coef, 1 / (1 + x));
    if (Math.abs(dn - ds) < 0.005) { ds = dn; break; } ds = dn;
  }
  if (isFinite(roca)) ds = Math.min(ds, h + roca);
  return Math.max(0, ds - h);
}

// SOCAVACIÓN POR FRANJAS: la velocidad NO es uniforme; se reparte el caudal por
// CONVEYANCE (K∝h^{5/3}·w) en franjas y en cada una se calculan TODOS los métodos
// aplicables (Lischtvan-Lebediev y Neill) con la D50 del estrato correspondiente y
// tope de roca. Devuelve el perfil por franja (socav de cada método + adoptada = máx).
export function socavacionPorFranjas(sec, pts, opts = {}) {
  const { Q, D50mm = 20, s = 2.65, T = 100, mu = 1, cohesivo = false, gammaS = 1.5, strata = [], roca = Infinity } = opts;
  const WSE = sec.WSE;
  const beta = betaFrecuencia(T);
  const Hm = (sec.A > 0 && sec.B > 0) ? sec.A / sec.B : 1;
  const Be = sec.B || 1;
  const alfa = alfaLL({ Q, Hm, Be, mu });
  // Muestreador de velocidad EXTERNA (campo 2D): opts.vAt(s)→v ó opts.vProfile=[{s,v}].
  // Si viene, la velocidad de cada franja sale del campo REAL (2D) y qu = v·h; si no,
  // se reparte por conveyance (1D). Es el acople "intermedio": el 2D alimenta la socavación.
  const vExt = velSampler(opts.vAt, opts.vProfile);
  const fuenteV = vExt ? '2D' : 'conveyance';
  const strips = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const x1 = pts[i].s, z1 = pts[i].z, x2 = pts[i + 1].s, z2 = pts[i + 1].z;
    const d1 = WSE - z1, d2 = WSE - z2;
    if (d1 <= 0 && d2 <= 0) continue;
    let xa = x1, xb = x2, ha = d1, hb = d2;
    if (d1 < 0) { const t = d1 / (d1 - d2); xa = x1 + t * (x2 - x1); ha = 0; }
    if (d2 < 0) { const t = d1 / (d1 - d2); xb = x1 + t * (x2 - x1); hb = 0; }
    const w = xb - xa, h = (ha + hb) / 2;
    if (h > 1e-3 && w > 0) strips.push({ sMid: (xa + xb) / 2, w, h });
  }
  const Ktot = strips.reduce((a, st) => a + Math.pow(st.h, 5 / 3) * st.w, 0) || 1;
  const maxs = { ll: 0, neill: 0, adopt: 0 };
  let sLoc = 0, vMax = 0;
  const franjas = strips.map((st) => {
    let v, qu;
    if (vExt) {                                         // velocidad del campo 2D
      const vf = vExt(st.sMid);
      v = (isFinite(vf) && vf > 0) ? vf : (Q * Math.pow(st.h, 5 / 3) / Ktot) / st.h;
      qu = v * st.h;                                    // caudal unitario desde v real
    } else {                                            // reparto 1D por conveyance
      qu = Q * Math.pow(st.h, 5 / 3) / Ktot;            // caudal unitario de la franja [m²/s]
      v = qu / st.h;                                    // velocidad local (varía por franja)
    }
    const ll = llCapas(alfa, beta, st.h, { D50mm, strata, roca, cohesivo, gammaS });
    const neill = neillCapas(qu, st.h, { D50mm, s, strata, roca });
    const socav = Math.max(ll, neill);                 // adoptada en la franja = envolvente
    if (socav > maxs.adopt) { maxs.adopt = socav; sLoc = st.sMid; }
    maxs.ll = Math.max(maxs.ll, ll); maxs.neill = Math.max(maxs.neill, neill);
    if (v > vMax) vMax = v;
    return { s: +st.sMid.toFixed(1), h: +st.h.toFixed(2), v: +v.toFixed(2), socavLL: +ll.toFixed(2), socavNeill: +neill.toFixed(2), socav: +socav.toFixed(2), zFondo: +(WSE - st.h - socav).toFixed(2) };
  });
  return {
    franjas, socavMax: +maxs.adopt.toFixed(3), socavMaxLL: +maxs.ll.toFixed(3), socavMaxNeill: +maxs.neill.toFixed(3),
    sLoc, vMax: +vMax.toFixed(2), roca: isFinite(roca) ? roca : null, fuenteV,
  };
}

// Interpolador lineal de una velocidad dada por estación transversal s [m]. Acepta una
// función vAt(s)→v (prioridad) ó un arreglo vProfile=[{s,v}] ordenable. Devuelve null
// si no hay dato externo (→ la socavación usa el reparto 1D por conveyance).
function velSampler(vAt, vProfile) {
  if (typeof vAt === 'function') return vAt;
  if (Array.isArray(vProfile) && vProfile.length) {
    const pf = vProfile.filter((p) => isFinite(p.s) && isFinite(p.v)).sort((a, b) => a.s - b.s);
    if (!pf.length) return null;
    return (s) => {
      if (s <= pf[0].s) return pf[0].v;
      if (s >= pf[pf.length - 1].s) return pf[pf.length - 1].v;
      for (let i = 1; i < pf.length; i++) if (s <= pf[i].s) {
        const a = pf[i - 1], b = pf[i], t = (s - a.s) / ((b.s - a.s) || 1);
        return a.v + t * (b.v - a.v);
      }
      return pf[pf.length - 1].v;
    };
  }
  return null;
}

// ── Socavación LOCAL en pilas — VARIOS métodos (MC-V3 3.707.4 exige ≥2, gruesos+finos)
// Todos devuelven la profundidad de socavación local ys [m]. Formas estándar; los
// coeficientes de forma se toman de las tablas del MC (verificar láminas 3.707.4).

// Froehlich (1991): ys = 0.32·φ·a^0.62·y1^0.47·Fr1^0.22·D50^-0.09  (SI, dim. consistente).
export function pilaFroehlich({ a, y1, Fr1, D50mm = 20, forma = 'circular' }) {
  const PHI = { circular: 1.0, redondeada: 1.0, cuadrada: 1.3, chaflan: 1.0, biselada: 1.0 };
  const D = Math.max(D50mm, 0.2) / 1000;
  return 0.32 * (PHI[forma] ?? 1.0) * Math.pow(a, 0.62) * Math.pow(y1, 0.47) * Math.pow(Math.max(Fr1, 1e-3), 0.22) * Math.pow(D, -0.09);
}
// Laursen-Toch (flujo alineado): ys = 1.35·a^0.7·y1^0.3.
export function pilaLaursenToch({ a, y1 }) { return 1.35 * Math.pow(a, 0.7) * Math.pow(y1, 0.3); }
// Breusers (1977): ys = 1.5·a·tanh(y1/a)  (→1.5a en agua profunda, ~1.5·y1 en somera).
export function pilaBreusers({ a, y1, forma = 'circular' }) {
  const Kf = { circular: 1.0, redondeada: 1.0, cuadrada: 1.3, chaflan: 0.75, biselada: 0.75 };
  return 1.5 * (Kf[forma] ?? 1.0) * a * Math.tanh(y1 / a);
}
// Larras (1963), dimensional (métrico): ys = 1.05·Kf·a^0.75.
export function pilaLarras({ a, forma = 'circular' }) {
  const Kf = { circular: 1.0, redondeada: 1.0, cuadrada: 1.4, chaflan: 1.0, biselada: 1.0 };
  return 1.05 * (Kf[forma] ?? 1.0) * Math.pow(a, 0.75);
}

// Compara todos los métodos de pila y adopta la envolvente (máx) y el promedio.
export function socavacionLocalPilaMetodos(p) {
  const csu = socavacionLocalPila(p).ys;
  const froehlich = pilaFroehlich(p);
  const laursenToch = pilaLaursenToch(p);
  const breusers = pilaBreusers(p);
  const larras = pilaLarras(p);
  const vals = { csu, froehlich, laursenToch, breusers, larras };
  const arr = Object.values(vals).filter((v) => isFinite(v));
  return { ...vals, max: Math.max(...arr), prom: arr.reduce((a, b) => a + b, 0) / arr.length };
}

// ── Socavación LOCAL en ESTRIBOS — HEC-18 (MC-V3 3.707.4). Dos ecuaciones:
//   • Froehlich (1989): estribos cortos/medios (L'/ya < 25).
//       ys/ya = 2.27·K1·K2·(L'/ya)^0.43·Fr^0.61 + 1
//   • HIRE (HEC-18): estribos que penetran hondo en el cauce (L'/ya ≥ 25).
//       ys = 4·ya·(K1/0.55)·K2·Fr^0.33
//   K1 = forma del estribo · K2 = ángulo del terraplén al flujo = (θ/90)^0.13.
//   ya = calado de aproximación en el estribo · L' = largo del flujo obstruido por el
//   terraplén · Fr = Froude de aproximación.
const K1_ESTRIBO = { vertical: 1.0, alas: 0.82, derrame: 0.55, spill: 0.55 };

export function estriboFroehlich({ ya, Fr, Lp, forma = 'derrame', theta = 90 }) {
  const K1 = K1_ESTRIBO[forma] ?? 0.55, K2 = Math.pow(Math.max(theta, 1) / 90, 0.13);
  const ratio = 2.27 * K1 * K2 * Math.pow(Math.max(Lp, 0.01) / ya, 0.43) * Math.pow(Math.max(Fr, 1e-3), 0.61) + 1;
  return { ys: ya * ratio, K1, K2 };
}
export function estriboHire({ ya, Fr, forma = 'derrame', theta = 90 }) {
  const K1 = K1_ESTRIBO[forma] ?? 0.55, K2 = Math.pow(Math.max(theta, 1) / 90, 0.13);
  return { ys: 4 * ya * (K1 / 0.55) * K2 * Math.pow(Math.max(Fr, 1e-3), 0.33), K1, K2 };
}
// Compara ambas y recomienda según L'/ya (HEC-18). Devuelve la adoptada.
export function socavacionEstribo(p) {
  const fr = estriboFroehlich(p), hi = estriboHire(p);
  const ratio = p.Lp / (p.ya || 1);
  const recomendado = ratio >= 25 ? 'HIRE' : 'Froehlich';
  const adoptada = recomendado === 'HIRE' ? hi.ys : fr.ys;
  return { froehlich: fr.ys, hire: hi.ys, K1: fr.K1, K2: fr.K2, ratio, recomendado, adoptada };
}

// Resumen de socavación para una sección de puente: general + (opcional) local en pila.
export function evaluarSocavacion(sec, pts, opts = {}) {
  const gen = socavacionGeneral(sec, pts, opts);                 // Lischtvan-Lebediev (por vertical)
  const genNeill = socavacionGeneralNeill(sec, pts, opts);       // Neill con velocidad MEDIA
  const franjas = socavacionPorFranjas(sec, pts, opts);          // Neill POR FRANJAS (v varía) + capas + roca
  const genAdopt = Math.max(gen.socavMax || 0, genNeill.socav || 0, franjas.socavMax || 0);
  const out = { general: gen, generalNeill: genNeill, franjas, generalAdoptada: genAdopt };
  const h1 = sec.profMax || (sec.WSE - Math.min(...pts.map((p) => p.z)));
  out.neill = { Vc: velocidadCompetente(h1, opts.D50mm ?? 20), V: sec.V, lechoVivo: sec.V > velocidadCompetente(h1, opts.D50mm ?? 20) };
  if (opts.pila) {
    const pp = { a: opts.pila.a, y1: h1, Fr1: sec.Fr, D50mm: opts.D50mm ?? 20, forma: opts.pila.forma, theta: opts.pila.theta, Lpila: opts.pila.L, K3: opts.pila.K3 ?? 1.1 };
    out.local = socavacionLocalPila(pp);           // CSU/HEC-18 (con K1/K2/K3)
    out.metodosPila = socavacionLocalPilaMetodos(pp);  // CSU, Froehlich, Laursen-Toch, Breusers, Larras
    out.localAdoptada = out.metodosPila.max;       // envolvente de los métodos (criterio MC)
    out.socavTotal = genAdopt + out.localAdoptada;   // general (máx LL/Neill) + local (envolvente)
  } else {
    out.socavTotal = genAdopt;
  }
  return out;
}
