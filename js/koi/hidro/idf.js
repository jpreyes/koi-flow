// ─────────────────────────────────────────────────────────────────────────────
// idf.js — Precipitaciones de diseño y curvas Intensidad-Duración-Frecuencia
// (koi-flow, Fase 1). MC-V3: PP diseño = cuantil × 1.10 (Varas-Sánchez); IDF a
// partir de coeficientes de duración CD(t)=P(t)/P(24h) de una estación pluviográfica.
// Validado contra el informe S17 (estación de coeficientes: Putre).
// ─────────────────────────────────────────────────────────────────────────────

// PP de diseño por período de retorno: cuantil (24h) amplificado por Varas-Sánchez.
export function ppDiseno(quantiles, factor = 1.10) {
  const out = {};
  for (const [T, p] of Object.entries(quantiles)) out[T] = p * factor;
  return out;
}

// Factor de reducción areal (FRA) de la lluvia PUNTUAL a la lluvia MEDIA sobre la
// cuenca. La PP de una estación NO cae uniforme sobre toda la cuenca: a mayor área,
// menor la lluvia media. Sin esto, los métodos pluviales sobre cuencas grandes dan
// caudales físicamente absurdos (p.ej. HU sobre el Choapa, 7544 km², daba miles de
// m³/s). Curva tipo 24 h (US Weather Bureau TP-40 / Manual de Carreteras), ajuste
// log en el área [km²], acotado a [0.4, 1]. Para cuencas chicas (≲25 km²) → ≈1.
export function factorReduccionAreal(A_km2) {
  const A = Math.max(1, +A_km2 || 0);
  return Math.min(1, Math.max(0.4, 1.1032 - 0.03474 * Math.log(A)));
}

// Aplica el FRA a un mapa {T: PP} de precipitación de diseño puntual.
export function ppReducidaAreal(pp, A_km2) {
  const fra = factorReduccionAreal(A_km2);
  const out = {};
  for (const [T, p] of Object.entries(pp)) out[T] = p * fra;
  out._fra = fra;
  return out;
}

// Coeficiente de duración interpolado (lineal) a una duración en minutos.
export function cd(coefArr, durMin) {
  const a = coefArr;
  if (durMin <= a[0][0]) return a[0][1];
  if (durMin >= a[a.length - 1][0]) return a[a.length - 1][1];
  for (let i = 0; i < a.length - 1; i++) {
    if (durMin >= a[i][0] && durMin <= a[i + 1][0]) {
      const t = (durMin - a[i][0]) / (a[i + 1][0] - a[i][0]);
      return a[i][1] + t * (a[i + 1][1] - a[i][1]);
    }
  }
  return a[a.length - 1][1];
}

// Intensidad (mm/hr) para PP de 24h de período T, a una duración en minutos.
export function intensidad(pp24, coefArr, durMin) {
  const p = pp24 * cd(coefArr, durMin);   // precipitación de esa duración (mm)
  return p / (durMin / 60);               // mm/hr
}

// Intensidad de diseño de Grunsky a la duración = tiempo de concentración (horas).
// I(tc) = I_24 · √(24/tc),  I_24 = PP24 / 24.
export function grunsky(pp24, tc_h) {
  return (pp24 / 24) * Math.sqrt(24 / tc_h);
}

// Tabla IDF completa: filas = duraciones (min), columnas = T.
export function tablaIDF(ppDis, coefArr, duraciones = [5, 10, 15, 30, 60, 90, 120, 240, 360, 480, 600, 720, 840, 1080, 1440]) {
  const Ts = Object.keys(ppDis);
  return duraciones.map((d) => {
    const fila = { durMin: d, cd: cd(coefArr, d) };
    for (const T of Ts) fila['T' + T] = intensidad(ppDis[T], coefArr, d);
    return fila;
  });
}
