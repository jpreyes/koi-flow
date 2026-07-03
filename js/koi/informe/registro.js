// ─────────────────────────────────────────────────────────────────────────────
// registro.js — registro de resultados para el INFORME (koi-flow).
// Cada HUD publica aquí un resumen de su último cálculo (entradas clave +
// resultados) y el informe lo lee de koi.reg.<modulo>. Vive en memoria (no se
// persiste): el informe refleja lo calculado en la sesión actual.
// ─────────────────────────────────────────────────────────────────────────────
import { emit } from '../ui/bus.js?v=3';

export function registrar(modulo, datos) {
  const k = window.__koi;
  if (!k) return;
  k.reg = k.reg || {};
  k.reg[modulo] = { ...datos, _fecha: Date.now() };
  emit('reg:actualizado', { modulo });   // los paneles (chips) y HUD se refrescan
}
