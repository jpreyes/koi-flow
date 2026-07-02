// ─────────────────────────────────────────────────────────────────────────────
// alcantarilla.js — Hidráulica de alcantarillas FHWA HDS-5 (koi-flow).
// "Hydraulic Design of Highway Culverts" (FHWA HDS-5) · MC-V3 3.703 (alcantarillas).
//
// Calcula la carga de agua a la entrada (HW) como el MAYOR entre el control de
// ENTRADA (inlet control, ecuaciones de nomograma Apéndice A) y el control de
// SALIDA (outlet control, balance de energía con pérdidas de entrada+fricción+salida),
// más la velocidad de salida y la curva de gasto (performance curve).
//
// Unidades SI. Q [m³/s], D=alto/diámetro [m], B=ancho [m] (cajón), L [m], n Manning,
// S pendiente [m/m], TW tirante aguas abajo [m]. g=9.81, 2g=19.62. Ku=1.811 (SI).
// ─────────────────────────────────────────────────────────────────────────────

const G = 9.81, G2 = 19.62, KU = 1.811;

// Coeficientes de control de ENTRADA (HDS-5 Apéndice A) + Ke (pérdida de entrada,
// Tabla de outlet control) + Manning típico por material. form 1/2 = tipo de ec.
// no sumergida. mitered=true usa +0.7·S (biselado al talud) en vez de −0.5·S.
export const TIPOS_ALC = {
  'horm-recto':    { label: 'Hormigón · borde recto en muro',        forma: 'circular', K: 0.0098, M: 2.0, c: 0.0398, Y: 0.67, form: 1, Ke: 0.5, n: 0.012 },
  'horm-acampan':  { label: 'Hormigón · entrada acampanada en muro', forma: 'circular', K: 0.0018, M: 2.0, c: 0.0292, Y: 0.74, form: 1, Ke: 0.2, n: 0.012 },
  'horm-saliente': { label: 'Hormigón · groove saliente',            forma: 'circular', K: 0.0045, M: 2.0, c: 0.0317, Y: 0.69, form: 1, Ke: 0.2, n: 0.012 },
  'cmp-muro':      { label: 'Metal corrugado · muro frontal',        forma: 'circular', K: 0.0078, M: 2.0, c: 0.0379, Y: 0.69, form: 1, Ke: 0.5, n: 0.024 },
  'cmp-biselado':  { label: 'Metal corrugado · biselado al talud',   forma: 'circular', K: 0.0210, M: 1.33, c: 0.0463, Y: 0.75, form: 1, Ke: 0.7, n: 0.024, mitered: true },
  'cmp-saliente':  { label: 'Metal corrugado · saliente',            forma: 'circular', K: 0.0340, M: 1.50, c: 0.0553, Y: 0.54, form: 1, Ke: 0.9, n: 0.024 },
  'cajon-3075':    { label: 'Cajón · aletas 30–75°',                 forma: 'cajon',    K: 0.026,  M: 1.0,  c: 0.0385, Y: 0.81, form: 1, Ke: 0.4, n: 0.013 },
  'cajon-90':      { label: 'Cajón · aletas 90° o 15°',              forma: 'cajon',    K: 0.061,  M: 0.75, c: 0.0400, Y: 0.80, form: 1, Ke: 0.5, n: 0.013 },
  'cajon-0':       { label: 'Cajón · muros paralelos (0°)',          forma: 'cajon',    K: 0.061,  M: 0.75, c: 0.0423, Y: 0.82, form: 1, Ke: 0.5, n: 0.013 },
};

// Geometría del barril a un tirante y: área A, ancho superficial T, perímetro P.
export function geomBarril(forma, y, { D, B }) {
  y = Math.max(0, Math.min(y, D));
  if (forma === 'cajon') {
    return { A: B * y, T: B, P: B + 2 * y };
  }
  // circular: ángulo central θ (agua) desde el tirante.
  const r = D / 2;
  const th = 2 * Math.acos(Math.max(-1, Math.min(1, (r - y) / r)));
  const A = (r * r / 2) * (th - Math.sin(th));
  const T = 2 * r * Math.sin(th / 2);
  const P = r * th;
  return { A, T: T || 1e-6, P: P || 1e-6 };
}

export function areaLlena(forma, { D, B }) {
  return forma === 'cajon' ? B * D : Math.PI * D * D / 4;
}
export function radioLleno(forma, { D, B }) {
  const A = areaLlena(forma, { D, B });
  const P = forma === 'cajon' ? 2 * (B + D) : Math.PI * D;
  return A / P;
}

// Tirante crítico dc: resuelve A³/T = Q²/g (bisección en y ∈ (0, D)).
export function tiranteCritico(forma, Q, { D, B }) {
  if (Q <= 0) return 0;
  if (forma === 'cajon') {
    const dc = Math.cbrt((Q / B) * (Q / B) / G);
    return Math.min(dc, D);
  }
  let lo = 1e-4, hi = D, obj = Q * Q / G;
  for (let i = 0; i < 60; i++) {
    const y = (lo + hi) / 2, g = geomBarril(forma, y, { D, B });
    const val = (g.A * g.A * g.A) / g.T;
    if (val < obj) lo = y; else hi = y;
  }
  return (lo + hi) / 2;
}

// Tirante normal dn (Manning) en el barril para Q, n, S (bisección en y ∈ (0, D)).
export function tiranteNormal(forma, Q, { D, B, n, S }) {
  if (Q <= 0 || S <= 0) return 0;
  let lo = 1e-4, hi = D;
  const Qde = (y) => { const g = geomBarril(forma, y, { D, B }); const R = g.A / g.P; return (1 / n) * g.A * Math.pow(R, 2 / 3) * Math.sqrt(S); };
  if (Qde(D) < Q) return D;   // fluye lleno → tirante normal ≥ D
  for (let i = 0; i < 60; i++) { const y = (lo + hi) / 2; if (Qde(y) < Q) lo = y; else hi = y; }
  return (lo + hi) / 2;
}

// CONTROL DE ENTRADA (inlet control) → HW/D. Combina ecuaciones no sumergida y
// sumergida por intensidad de descarga Di = Ku·Q/(A·√D) (transición 3.5–4.0).
export function controlEntrada(Q, p) {
  const { D, Aful, K, M, c, Y, form, S, mitered, HcD } = p;
  const Di = KU * Q / (Aful * Math.sqrt(D));
  const Sc = mitered ? 0.7 * S : -0.5 * S;
  const noSum = form === 1 ? HcD + K * Math.pow(Di, M) + Sc : K * Math.pow(Di, M) + Sc;
  const sum = c * Di * Di + Y + Sc;
  let HWD, regimen;
  if (Di <= 3.5) { HWD = noSum; regimen = 'no sumergido'; }
  else if (Di >= 4.0) { HWD = sum; regimen = 'sumergido'; }
  else { const t = (Di - 3.5) / 0.5; HWD = noSum * (1 - t) + sum * t; regimen = 'transición'; }
  return { HWD: Math.max(HWD, 0), Di, regimen };
}

// CONTROL DE SALIDA (outlet control) → HW sobre la solera de entrada.
//   H = (1 + Ke + Kf)·V²/2g  con  Kf = 19.62·n²·L/R^{4/3} (fricción Manning, lleno)
//   ho = máx(TW, (dc+D)/2)   ;   HW = ho + H − S·L
export function controlSalida(Q, p) {
  const { Aful, Rful, n, L, S, Ke, D, TW, dc } = p;
  const V = Q / Aful;
  const Kf = G2 * n * n * L / Math.pow(Rful, 4 / 3);
  const H = (1 + Ke + Kf) * V * V / G2;
  const ho = Math.max(TW || 0, (Math.min(dc, D) + D) / 2);
  return { HW: ho + H - S * L, H, ho, V };
}

// Diseño completo de una alcantarilla para un caudal Q. Con nBarriles>1, barriles
// IDÉNTICOS en paralelo comparten la misma carga de agua: cada uno lleva Q/N y toda
// la hidráulica (HW, control, velocidad) se calcula por barril; los caudales se
// reportan por barril y totales (×N).
export function disenarAlcantarilla(o) {
  const cfg = TIPOS_ALC[o.tipo] || TIPOS_ALC['horm-recto'];
  const forma = cfg.forma;
  const D = +o.D || 1, B = forma === 'cajon' ? (+o.B || D) : D;
  const n = o.n != null ? +o.n : cfg.n;
  const L = +o.L || 20, S = o.S != null ? +o.S : 0.02, TW = +o.TW || 0, Q = +o.Q || 0;
  const N = Math.max(1, Math.round(+o.nBarriles || 1));
  const Qb = Q / N;                                  // caudal por barril
  const Aful = areaLlena(forma, { D, B }), Rful = radioLleno(forma, { D, B });
  const dc = tiranteCritico(forma, Qb, { D, B });
  const gc = geomBarril(forma, Math.min(dc, D * 0.999), { D, B });
  const Vc = dc > 0 ? Qb / gc.A : 0;
  const HcD = (dc + Vc * Vc / G2) / D;
  const ic = controlEntrada(Qb, { D, Aful, K: cfg.K, M: cfg.M, c: cfg.c, Y: cfg.Y, form: cfg.form, S, mitered: cfg.mitered, HcD });
  const oc = controlSalida(Qb, { Aful, Rful, n, L, S, Ke: cfg.Ke, D, TW, dc });
  const HWi = ic.HWD * D, HWo = oc.HW;
  const control = HWi >= HWo ? 'entrada' : 'salida';
  const HW = Math.max(HWi, HWo, 0);
  const dn = tiranteNormal(forma, Qb, { D, B, n, S });
  // Velocidad de salida (por barril): control de entrada → a tirante normal; salida → lleno.
  const Vout = control === 'entrada'
    ? (dn > 0 ? Qb / geomBarril(forma, Math.min(dn, D * 0.999), { D, B }).A : 0)
    : oc.V;
  const overtop = (o.cotaEntrada != null && o.cotaCorona != null) ? (o.cotaEntrada + HW) > o.cotaCorona : null;
  return {
    Q, nBarriles: N, Qbarril: Qb, forma, D, B, n, L, S, TW, control, HW, HWi, HWo, HWD: HW / D,
    sumergido: HW / D > 1.2, regimenEntrada: ic.regimen, dc, dn, Vc, Vout,
    Aful, AfulTotal: Aful * N, Vlleno: oc.V, Hbarril: oc.H, ho: oc.ho, overtop, tipo: o.tipo, label: cfg.label,
  };
}

// Curva de gasto (performance curve): HW vs Q, marcando control y anegamiento.
export function curvaGasto(o, { Qmax, nPtos = 24 } = {}) {
  const cfg = TIPOS_ALC[o.tipo] || TIPOS_ALC['horm-recto'];
  const D = +o.D || 1, B = cfg.forma === 'cajon' ? (+o.B || D) : D;
  const N = Math.max(1, Math.round(+o.nBarriles || 1));
  const Aful = areaLlena(cfg.forma, { D, B });
  const qm = Qmax || N * 2.5 * Aful * Math.sqrt(G * D); // ~caudal a barriles llenos (×N)
  const pts = [];
  for (let i = 1; i <= nPtos; i++) {
    const Q = (qm * i) / nPtos;
    const r = disenarAlcantarilla({ ...o, Q });
    pts.push({ Q, HW: r.HW, HWD: r.HWD, control: r.control });
  }
  return pts;
}
