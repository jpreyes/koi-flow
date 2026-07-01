// ─────────────────────────────────────────────────────────────────────────────
// hidrograma.js — Hidrograma Unitario Sintético tipo Linsley (koi-flow, Fase 1).
// Parámetros sintéticos de Arteaga F. & Benítez A. (1985), por zona geográfica.
// Aplicable a área pluvial 10–4500 km². Abstracción de lluvia por curva número SCS.
//
// Validado vs informe S17 (Sector 17, Zona 1 / Región III): tp=24.83 h,
// tB=71.36 h, qp=11.18 lt/s/mm/km² (→ 10.63 m³/s·mm para A=951.3 km²).
//
// Parámetros morfométricos:
//   L  = longitud del cauce principal [km]
//   Lg = longitud al centro de gravedad de la cuenca [km]
//   S  = pendiente media del cauce [m/m]
//   A  = área de la cuenca [km²]
// ─────────────────────────────────────────────────────────────────────────────

// Coeficientes de Arteaga-Benítez por zona (tp, tB en horas; qp en lt/s/mm/km²).
export const ZONAS = {
  1: { regiones: 'III a VI', tp: [0.323, 0.422], tB: [5.377, 0.805], qp: [144.141, -0.796] },
  2: { regiones: 'VII',      tp: [0.584, 0.327], tB: [1.822, 1.412], qp: [522.514, -1.511] },
  3: { regiones: 'VIII a X', tp: [1.351, 0.237], tB: [5.428, 0.717], qp: [172.775, -0.835] },
};

// Tabla del coeficiente de distribución del HU sintético (t/tp → q/qp).
export const CURVA_DISTRIBUCION = [
  [0.00, 0.0], [0.30, 0.2], [0.50, 0.4], [0.60, 0.6], [0.75, 0.8],
  [1.00, 1.0], [1.30, 0.8], [1.50, 0.6], [1.80, 0.4], [2.30, 0.2], [2.70, 0.1],
];

// Parámetros del HU sintético Linsley. qp_unit en lt/s/mm/km²; qpA en m³/s por 1 mm efectivo.
export function linsley({ L, Lg, S, A }, zona = 1) {
  const z = ZONAS[zona];
  const X = (L * Lg) / Math.sqrt(S);
  const tp = z.tp[0] * Math.pow(X, z.tp[1]);
  const tB = z.tB[0] * Math.pow(tp, z.tB[1]);
  const qpUnit = z.qp[0] * Math.pow(tp, z.qp[1]);   // lt/s/mm/km²
  const tu = tp / 5.5;                               // duración lluvia efectiva unitaria
  const qpA = A != null ? (qpUnit * A) / 1000 : null; // m³/s por 1 mm efectivo
  return { zona, regiones: z.regiones, tp, tu, tB, qpUnit, qpA };
}

// Abstracción de lluvia SCS: retención S y precipitación efectiva Pe (mm).
export function abstraccionSCS(P, CN) {
  const S = 25400 / CN - 254;       // mm
  const Ia = 0.2 * S;               // abstracción inicial
  const Pe = P > Ia ? (P - Ia) ** 2 / (P - Ia + S) : 0;
  return { S, Ia, Pe };
}

// Ordenadas del HU unitario (1 mm) a partir de la curva de distribución.
export function ordenadasUH({ tp, qpA }) {
  return CURVA_DISTRIBUCION.map(([rt, rq]) => ({ t: rt * tp, q: rq * qpA }));
}

// Caudal peak por período de retorno: Qp(T) = qpA · Pe(T)  (HU lineal, lluvia ~ tu).
//   pp: { T: PP de la duración tu [mm] } o PP24 escalada; CN curva número.
export function caudalesHU({ L, Lg, S, A }, pp, CN, zona = 1) {
  const par = linsley({ L, Lg, S, A }, zona);
  const out = {};
  for (const [T, P] of Object.entries(pp)) {
    const { Pe } = abstraccionSCS(P, CN);
    out[T] = { Pe, Q: par.qpA * Pe };
  }
  return { metodo: 'Hidrograma Unitario (Linsley)', aplica: A >= 10 && A <= 4500, rango: '10–4500 km²', params: par, CN, valores: out };
}
