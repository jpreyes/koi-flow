// ─────────────────────────────────────────────────────────────────────────────
// caudales.js — Caudales máximos de diseño en cuencas sin control fluviométrico
// (koi-flow, Fase 1). Métodos MC-V3 / DGA 1995: Racional Modificado, Verni-King
// Modificado y DGA-AC (análisis regional). Cada uno da Q(T) en m³/s.
// Validado vs informe S17 (Verni-King y DGA-AC Q10 coinciden con las tablas).
//
// Rangos de validez por área pluvial Ap [km²]:
//   Racional      Ap < 25
//   Verni-King    10 ≤ Ap ≤ 10000
//   DGA-AC        Ap > 20
//   Hidrograma U. 10 ≤ Ap ≤ 4500   (pendiente de implementar)
// ─────────────────────────────────────────────────────────────────────────────

const factor = (tabla, T) => {
  if (tabla[T] != null) return tabla[T];
  // interpolación/extrapolación log-lineal en T si falta el valor exacto
  const ks = Object.keys(tabla).map(Number).sort((a, b) => a - b);
  if (T <= ks[0]) return tabla[ks[0]];
  if (T >= ks[ks.length - 1]) return tabla[ks[ks.length - 1]];
  for (let i = 0; i < ks.length - 1; i++) if (T >= ks[i] && T <= ks[i + 1]) {
    const t = (Math.log(T) - Math.log(ks[i])) / (Math.log(ks[i + 1]) - Math.log(ks[i]));
    return tabla[ks[i]] + t * (tabla[ks[i + 1]] - tabla[ks[i]]);
  }
};

// Racional Modificado: Q = C(T)·I(tc,T)·A/3.6   (I en mm/hr, A en km²)
//   coefC (opcional) sobrescribe el C10 regional (el usuario lo lee del mapa DGA).
export function racional({ A, region, Itc, coefC }, coef, Ts) {
  const regiones = Object.keys(coef.racional.C10_por_region);
  const C10 = coefC != null && isFinite(+coefC) ? +coefC : coef.racional.C10_por_region[region];
  const ok = C10 != null && isFinite(C10);
  const out = {};
  for (const T of Ts) {
    const C = ok ? C10 * factor(coef.racional.factor_frecuencia_C, T) : null;
    out[T] = { C, I: Itc[T], Q: ok ? (C * Itc[T] * A) / 3.6 : null };
  }
  return { metodo: 'Racional Modificado', aplica: ok && A < 25, sinCoef: !ok, rango: 'Ap < 25 km²', regiones, C10, valores: out };
}

// Verni-King Modificado: Q = C(T)·k·A^a·P24(T)^p. El coeficiente C es ESPACIAL
// (mapa DGA, 0.027–0.89 entre la III y la IX Región): coefC (opcional) lo sobrescribe.
export function verniKing({ A, region, pp24, coefC }, coef, Ts) {
  const { k, expA, expP, C10_por_region } = coef.verni_king;
  const regiones = Object.keys(C10_por_region);
  const C10 = coefC != null && isFinite(+coefC) ? +coefC : C10_por_region[region];
  const ok = C10 != null && isFinite(C10);
  const out = {};
  for (const T of Ts) {
    const C = ok ? C10 * factor(coef.racional.factor_frecuencia_C, T) : null;
    out[T] = { C, P24: pp24[T], Q: ok ? C * k * Math.pow(A, expA) * Math.pow(pp24[T], expP) : null };
  }
  return { metodo: 'Verni-King Modificado', aplica: ok && A >= 10 && A <= 10000, sinCoef: !ok, rango: '10–10000 km²', regiones, C10, valores: out };
}

// Lee la curva de frecuencia adimensional Q(T)/Q10 de una zona homogénea DGA-AC.
// Interpola log-lineal en T dentro del rango tabulado [2,100] y EXTRAPOLA log-lineal
// (con los dos últimos puntos) para T>100, marcándolo — el manual sólo llega a T=100.
function curvaDGA(Tcurva, vals, T) {
  const n = Tcurva.length;
  if (T <= Tcurva[0]) return { v: vals[0], extrap: false };
  if (T >= Tcurva[n - 1]) {
    const a = Tcurva[n - 2], b = Tcurva[n - 1];
    const s = (vals[n - 1] - vals[n - 2]) / (Math.log(b) - Math.log(a));
    return { v: vals[n - 1] + s * (Math.log(T) - Math.log(b)), extrap: T > b };
  }
  for (let i = 0; i < n - 1; i++) if (T >= Tcurva[i] && T <= Tcurva[i + 1]) {
    const t = (Math.log(T) - Math.log(Tcurva[i])) / (Math.log(Tcurva[i + 1]) - Math.log(Tcurva[i]));
    return { v: vals[i] + t * (vals[i + 1] - vals[i]), extrap: false };
  }
  return { v: vals[n - 1], extrap: true };
}

// DGA-AC (análisis regional): Q10 = k·A^a·P24_10^p (fórmula regional) ;
// Q(T) = Q10 · [Q(T)/Q10]_zona · α_zona. La cuenca se asigna a una ZONA HOMOGÉNEA
// (Dp…Zp, Manual DGA 1995) que fija la curva de frecuencia, el factor α y la región
// de la fórmula Q10. `zona` es el código de zona homogénea; si falta → sinZona.
export function dgaAC({ A, pp24, zona }, coef, Ts) {
  const dz = coef.dga_ac;
  const zonas = Object.keys(dz.zonas);
  const z = dz.zonas[zona];
  if (!z) {
    const out = Object.fromEntries(Ts.map((T) => [T, { ratio: null, Q: null }]));
    return { metodo: 'DGA-AC', aplica: false, sinZona: true, rango: 'Ap > 20 km²', zonas, valores: out };
  }
  const f = dz.Q10_por_region[z.region];
  const Q10 = f.k * Math.pow(A, f.expA) * Math.pow(pp24['10'], f.expP);
  const out = {}; let extrapolado = false;
  for (const T of Ts) {
    const c = curvaDGA(dz.T_curva, z.curva, T);
    if (c.extrap) extrapolado = true;
    out[T] = { ratio: c.v, extrap: c.extrap, Q: Q10 * c.v * z.alfa };
  }
  return {
    metodo: 'DGA-AC', aplica: A > 20, sinZona: false, rango: 'Ap > 20 km²',
    zona, zonaNombre: z.nombre, region: z.region, dist: z.dist, alfa: z.alfa,
    Q10, extrapolado, zonas, valores: out,
  };
}

// Zona homogénea DGA-AC por defecto según la zona/región de Verni-King, para que el
// flujo automático (pipeline) tenga una asignación razonable. El análisis por punto
// permite elegir la zona exacta (Dp…Zp). Aproximación por macrozona/cuenca típica.
const ZONA_DGA_POR_REGION = {
  'III': 'Ip', 'IV-Elqui': 'Ip', 'IV-Limari': 'Jp', 'IV-Choapa': 'Kp',
  'V': 'Lp', 'VI': 'Op', 'VII': 'Rp', 'VIII': 'Sp', 'IX': 'Vp',
};

// Ejecuta los métodos aplicables y arma un resumen por T.
//   inputs: { A, region, pp24:{T:mm}, Itc:{T:mm/hr}, zonaDGA? }
export function calcular(inputs, coef, Ts) {
  const zonaDGA = inputs.zonaDGA || ZONA_DGA_POR_REGION[inputs.region] || 'Dp';
  const metodos = [racional(inputs, coef, Ts), verniKing(inputs, coef, Ts), dgaAC({ ...inputs, zona: zonaDGA }, coef, Ts)];
  const resumen = Ts.map((T) => {
    const fila = { T };
    for (const m of metodos) fila[m.metodo] = m.valores[T].Q;
    return fila;
  });
  return { metodos, resumen, aplicables: metodos.filter((m) => m.aplica).map((m) => m.metodo) };
}

// Métodos pluviales (basados en IDF/precipitación) — referenciales en zona árida.
const ES_PLUVIAL = (m) => /Racional|Verni|DGA-AC|Hidrograma/i.test(m.metodo);

// Caudales de diseño ADOPTADOS combinando métodos pluviales y fluviométricos.
//   metodos: lista con { metodo, valores:{T:{Q}}, aplica?, gobierna? } (transposición/HU/pluviales)
//   opts.zona: 'arida' (norte de Chile) → gobierna el método fluviométrico directo;
//              los pluviales/IDF quedan como referenciales (no válidos en la zona).
// Devuelve, por T, el método que gobierna y su Q, más la matriz comparativa.
export function adoptar(metodos, Ts, opts = {}) {
  const zona = opts.zona || 'general';
  const directo = metodos.find((m) => m.gobierna || /Transposici|fluviom/i.test(m.metodo));
  const aplicables = metodos.filter((m) => m.aplica !== false);

  const filas = Ts.map((T) => {
    const fila = { T };
    for (const m of metodos) fila[m.metodo] = m.valores?.[T]?.Q ?? null;
    let gobierna, Q;
    if (zona === 'arida' && directo && directo.valores?.[T]) {
      gobierna = directo.metodo; Q = directo.valores[T].Q;          // fluviométrico gobierna
    } else {
      // sin control fluviométrico: criterio conservador entre métodos aplicables
      const cands = aplicables.filter((m) => m.valores?.[T]).map((m) => ({ m: m.metodo, Q: m.valores[T].Q }));
      const top = cands.reduce((a, b) => (b.Q > a.Q ? b : a), cands[0] || { Q: null });
      gobierna = top?.m; Q = top?.Q;
    }
    fila.adoptado = Q; fila.gobierna = gobierna;
    return fila;
  });

  return {
    zona, gobiernaMetodo: zona === 'arida' && directo ? directo.metodo : 'máximo aplicable',
    referenciales: zona === 'arida' ? metodos.filter(ES_PLUVIAL).map((m) => m.metodo) : [],
    adoptados: Object.fromEntries(filas.map((f) => [f.T, f.adoptado])),
    tabla: filas,
    nota: zona === 'arida'
      ? 'Zona árida: los métodos pluviales (IDF/Racional/Verni-King/DGA-AC) son referenciales; el caudal de diseño lo gobierna el método directo con control fluviométrico.'
      : 'Caudal adoptado = máximo entre métodos aplicables.',
  };
}
