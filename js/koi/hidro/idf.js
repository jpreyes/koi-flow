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
