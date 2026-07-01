// ─────────────────────────────────────────────────────────────────────────────
// config.js — parámetros por defecto de koi-flow (localStorage).
// Los formularios (hidráulica/socavación, red de drenaje, malla 2D) leen estos
// valores como default; el usuario los cambia en el panel ⚙ Configuración.
// ─────────────────────────────────────────────────────────────────────────────
const KEY = 'koi_config';

export const DEFAULTS = {
  Q: 120, n: 0.035, J: 0.005, D50: 20, sg: 2.65, T: 100, Cc: 0.1, Ce: 0.3, pila: 0,
  umbralRed: 0.05, snap: 60, hCauce: 8, hPlanicie: 40, anchoCauce: 30, nPlanicie: 0.06,
};

// Esquema para construir el formulario de configuración (grupos + campos).
export const SCHEMA = [
  { grupo: 'Hidráulica / socavación', campos: [
    ['Q', 'Caudal Q [m³/s]', 1], ['n', 'n Manning', 0.005], ['J', 'Pendiente J [m/m]', 0.001],
    ['D50', 'D50 [mm]', 1], ['sg', 'Densidad rel. s', 0.05], ['T', 'Período retorno T [años]', 1],
    ['Cc', 'Contracción Cc', 0.05], ['Ce', 'Expansión Ce', 0.05], ['pila', 'Ancho pila a [m]', 0.1],
  ] },
  { grupo: 'Cuenca / red de drenaje', campos: [
    ['umbralRed', 'Umbral red [km²]', 0.01], ['snap', 'Snap exutorio [m]', 10],
  ] },
  { grupo: 'Malla 2D', campos: [
    ['hCauce', 'h cauce [m]', 1], ['hPlanicie', 'h planicie [m]', 1],
    ['anchoCauce', 'Ancho cauce [m]', 1], ['nPlanicie', 'n planicie', 0.005],
  ] },
];

export function getConfig() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch { return { ...DEFAULTS }; }
}
export function setConfig(c) { localStorage.setItem(KEY, JSON.stringify({ ...getConfig(), ...c })); }
export function resetConfig() { localStorage.removeItem(KEY); }
