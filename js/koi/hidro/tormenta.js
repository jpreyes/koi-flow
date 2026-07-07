// ─────────────────────────────────────────────────────────────────────────────
// tormenta.js — Tormenta de diseño (hietograma) de koi-flow.
// Construye el hietograma de diseño por el MÉTODO DE BLOQUES ALTERNOS (Chow,
// Maidment & Mays; práctica MC-V3/DGA) derivado de la curva IDF, es decir de los
// coeficientes de duración CD(t)=P(t)/P(24h) de la estación pluviográfica y la
// precipitación de diseño de 24 h (PP24 = cuantil × 1.10 Varas-Sánchez).
//
// El hietograma que entrega alimenta AGUAS ABAJO: la convolución con el HU, la
// transformada de ModClark y —vía pérdidas SCS-CN— el hidrograma de entrada del 2D.
//
// NOTA ZONA ÁRIDA (norte): la lluvia-escorrentía es REFERENCIAL; el caudal de diseño
// lo gobierna la transposición fluviométrica del cauce (ver pipeline). La tormenta
// sirve para la forma del hidrograma y el tránsito, no para fijar el caudal punta.
// ─────────────────────────────────────────────────────────────────────────────
import { cd } from './idf.js?v=13';

// Método de bloques alternos a partir de la IDF (coeficientes de duración).
//   pp24: precipitación de diseño de 24 h [mm] (ya amplificada ×1.10 si aplica).
//   coefArr: [[durMin, CD]…] de la estación (CD = P(dur)/P(24h)).
//   opts.TdMin: duración total de la tormenta [min] (def 1440 = 24 h).
//   opts.dtMin: paso de tiempo del hietograma [min] (def 60).
//   opts.r: posición relativa del peak en [0,1] (0.5 = central/clásico; <0.5
//           adelantada; >0.5 atrasada). Reordena los bloques alrededor de ese punto.
// Devuelve { bloques:[{t0,t1,durMin,mm,i}], serie:[{t,mm}], Ptotal, imax, TdMin, dtMin, r, metodo }.
export function bloquesAlternos(pp24, coefArr, { TdMin = 1440, dtMin = 60, r = 0.5 } = {}) {
  const n = Math.max(1, Math.round(TdMin / dtMin));
  // Profundidad acumulada a cada duración k·dt = PP24 · CD(k·dt) → incrementos.
  const Pac = Array.from({ length: n }, (_, k) => pp24 * cd(coefArr, (k + 1) * dtMin));
  const incr = Pac.map((v, i) => (i ? v - Pac[i - 1] : v)).map((x) => Math.max(0, x));
  const desc = [...incr].sort((a, b) => b - a);            // incrementos de mayor a menor

  // Posición del peak y orden de llenado alternando derecha/izquierda desde ahí.
  const p = Math.min(n - 1, Math.max(0, Math.round(r * (n - 1))));
  const orden = [p]; let l = p, rr = p + 1, derecha = true;
  while (orden.length < n) {
    if (derecha && rr < n) orden.push(rr++);
    else if (!derecha && l - 1 >= 0) orden.push(--l);
    else if (rr < n) orden.push(rr++);
    else if (l - 1 >= 0) orden.push(--l);
    derecha = !derecha;
  }
  const mm = new Array(n).fill(0);
  orden.forEach((pos, i) => { mm[pos] = desc[i]; });        // el mayor va al peak

  return armar(mm, dtMin, r, 'bloques-alternos');
}

// Hietograma de intensidad uniforme (mismo mm en cada bloque). Ptot = pp24·CD(Td).
export function uniforme(pp24, coefArr, { TdMin = 1440, dtMin = 60 } = {}) {
  const n = Math.max(1, Math.round(TdMin / dtMin));
  const Ptot = pp24 * cd(coefArr, TdMin);
  const mm = new Array(n).fill(Ptot / n);
  return armar(mm, dtMin, 0.5, 'uniforme');
}

// Empaqueta un vector de mm por bloque en la estructura común del hietograma.
function armar(mm, dtMin, r, metodo) {
  const dtH = dtMin / 60;
  const bloques = mm.map((v, i) => ({ t0: i * dtMin, t1: (i + 1) * dtMin, durMin: dtMin, mm: v, i: v / dtH }));
  const serie = mm.map((v, i) => ({ t: (i + 0.5) * dtMin, mm: v }));   // centro de cada bloque
  const Ptotal = mm.reduce((a, b) => a + b, 0);
  const imax = bloques.reduce((mx, b) => Math.max(mx, b.i), 0);
  return { bloques, serie, mm, Ptotal, imax, TdMin: mm.length * dtMin, dtMin, r, metodo };
}

// Vector incremental (mm por bloque) para consumir por la convolución / SCS-CN.
export function hietoIncremental(tormenta) { return tormenta.mm.slice(); }

// Dispatcher por nombre de método (para la UI).
export function hietograma(metodo, pp24, coefArr, opts = {}) {
  return metodo === 'uniforme' ? uniforme(pp24, coefArr, opts) : bloquesAlternos(pp24, coefArr, opts);
}
