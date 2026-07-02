// ─────────────────────────────────────────────────────────────────────────────
// bus.js — bus de eventos mínimo (pub/sub) in-house para que los paneles y los HUD
// de koi-flow "conversen": cuando cambia la selección, se abre un proyecto, se
// registra un resultado o se descarga una serie, quien tenga interés se entera y se
// refresca. Sin librerías. Eventos usados:
//   'proyecto:abierto'   {id, name}
//   'seleccion:cambio'   {tipo:'tramo'|'punto'|'cuenca', nombre, ...}
//   'reg:actualizado'    {modulo}
//   'datos:serie-cargada'{tipo, ...}
// ─────────────────────────────────────────────────────────────────────────────
const _subs = new Map();   // evento → Set<fn>

export function on(evento, fn) {
  if (!_subs.has(evento)) _subs.set(evento, new Set());
  _subs.get(evento).add(fn);
  return () => off(evento, fn);   // devuelve un des-suscriptor
}

export function off(evento, fn) { _subs.get(evento)?.delete(fn); }

export function emit(evento, datos) {
  const s = _subs.get(evento);
  if (!s) return;
  for (const fn of [...s]) { try { fn(datos); } catch (e) { console.warn('bus', evento, e); } }
}

// Acceso global para módulos que no importan directamente (o desde la consola).
export const bus = { on, off, emit };
if (typeof window !== 'undefined') window.__koiBus = bus;
