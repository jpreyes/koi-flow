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
export function racional({ A, region, Itc }, coef, Ts) {
  const C10 = coef.racional.C10_por_region[region];
  const out = {};
  for (const T of Ts) {
    const C = C10 * factor(coef.racional.factor_frecuencia_C, T);
    out[T] = { C, I: Itc[T], Q: (C * Itc[T] * A) / 3.6 };
  }
  return { metodo: 'Racional Modificado', aplica: A < 25, rango: 'Ap < 25 km²', C10, valores: out };
}

// Verni-King Modificado: Q = C(T)·k·A^a·P24(T)^p
export function verniKing({ A, region, pp24 }, coef, Ts) {
  const { k, expA, expP, C10_por_region } = coef.verni_king;
  const C10 = C10_por_region[region];
  const out = {};
  for (const T of Ts) {
    const C = C10 * factor(coef.racional.factor_frecuencia_C, T);
    out[T] = { C, P24: pp24[T], Q: C * k * Math.pow(A, expA) * Math.pow(pp24[T], expP) };
  }
  return { metodo: 'Verni-King Modificado', aplica: A >= 10 && A <= 10000, rango: '10–10000 km²', C10, valores: out };
}

// DGA-AC: Q10 = k·A^a·P24_10^p ; Q(T) = Q10 · [Q(T)/Q(10)] · α
export function dgaAC({ A, pp24 }, coef, Ts) {
  const { k, expA, expP } = coef.dga_ac.Q10_formula;
  const curva = coef.dga_ac.curva_regional_Dp_exorreica_media;
  const alfa = coef.dga_ac.alfa_CMMD_a_CIMD;
  const Q10 = k * Math.pow(A, expA) * Math.pow(pp24['10'], expP);
  const out = {};
  for (const T of Ts) out[T] = { ratio: factor(curva, T), Q: Q10 * factor(curva, T) * alfa };
  return { metodo: 'DGA-AC', aplica: A > 20, rango: 'Ap > 20 km²', Q10, alfa, valores: out };
}

// Ejecuta los métodos aplicables y arma un resumen por T.
//   inputs: { A, region, pp24:{T:mm}, Itc:{T:mm/hr} }
export function calcular(inputs, coef, Ts) {
  const metodos = [racional(inputs, coef, Ts), verniKing(inputs, coef, Ts), dgaAC(inputs, coef, Ts)];
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
