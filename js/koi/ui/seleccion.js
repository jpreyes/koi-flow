// ─────────────────────────────────────────────────────────────────────────────
// seleccion.js — OBJETO ACTIVO explícito de koi-flow (Tanda 1 del rediseño UX).
// Un único "seleccionado" a la vez ({tipo, id, nombre, meta}). Al cambiarlo se
// emite 'seleccion:cambio' por el bus, y el indicador "Trabajando en: X" + los
// paneles reaccionan. Mata el "estado activo implícito" (lo último en memoria):
// ahora SIEMPRE se ve y se elige qué objeto se está calculando.
// ─────────────────────────────────────────────────────────────────────────────
import { emit } from './bus.js?v=3';

// Tipos de objeto del proyecto (label + color + ícono) — molde extensible (§6.2).
export const TIPOS = {
  tramo:      { label: 'Tramo',      color: '#e23b5a', ico: '🌊' },
  reach:      { label: 'Reach',      color: '#e23b5a', ico: '🌊' },
  punto:      { label: 'Punto',      color: '#ef6c5a', ico: '📍' },
  cuenca:     { label: 'Cuenca',     color: '#2563eb', ico: '⬡' },
  seccion:    { label: 'Sección',    color: '#0d7a94', ico: '⊥' },
  dominio:    { label: 'Dominio 2D', color: '#31c3ce', ico: '▦' },
  estructura: { label: 'Estructura', color: '#a855f7', ico: '🌉' },
  presa:      { label: 'Presa/Depósito', color: '#d97706', ico: '⛰' },
  entrada:    { label: 'Entrada Q',  color: '#16a34a', ico: '⇥' },
  estacion:   { label: 'Estación',   color: '#22c55e', ico: '🌧' },
};

let _activo = null;

export function getActivo() { return _activo; }

// obj: { tipo, id?, nombre, meta? } | null. Siempre emite (aunque sea el mismo)
// para que los paneles se re-sincronicen.
export function setActivo(obj) {
  _activo = obj || null;
  emit('seleccion:cambio', _activo);
  return _activo;
}

export function infoTipo(tipo) { return TIPOS[tipo] || { label: tipo || '—', color: '#8aa', ico: '•' }; }

// Fija la CRECIDA activa (hidrograma + reología) para el 2D/tránsito/embalse y la
// guarda en el PUNTO/cuenca activo, para que CADA objeto lleve la suya — se acaba el
// singleton global `koi.hidrogramaCrecida` (dos cuencas ya no comparten hidrograma).
// crecida: { hidrograma:[{t,Q}], reologia?, fuente } | null.
export function fijarCrecida(koi, crecida) {
  const c = crecida ? { hidrograma: crecida.hidrograma || null, reologia: crecida.reologia || null, fuente: crecida.fuente || null } : null;
  koi.hidrogramaCrecida = c?.hidrograma || null;
  koi.reologia = c?.reologia || null;
  const p = koi.hydro?._punto;         // el punto de análisis activo
  if (p) p.crecida = c;
  emit('crecida:cambio', { fuente: c?.fuente || null });
  return c;
}

// Devuelve la crecida guardada en un objeto (o null).
export function crecidaDe(obj) { return obj?.crecida || null; }

if (typeof window !== 'undefined') window.__koiSel = { get: getActivo, set: setActivo, TIPOS };
