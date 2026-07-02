// ─────────────────────────────────────────────────────────────────────────────
// insumos.js — bloque estándar "Insumos usados" para los HUD de análisis (koi-flow).
// Muestra, al tope de cada resultado, TODO lo que el motor recibió (estación, área,
// Tc, CN, distribución…), marcando en ámbar los que salieron de un DEFAULT y no de
// un dato del proyecto. Así el usuario ve exactamente con qué se calculó — resuelve
// "los HUD no muestran lo que realmente hacen los motores".
// ─────────────────────────────────────────────────────────────────────────────

// items: [{ k:'Área A', v:'951 km²', def:false }]  ·  def=true → resaltado ámbar.
export function bloqueInsumos(items, { titulo = 'Insumos usados' } = {}) {
  const filas = (items || []).filter(Boolean).map((it) =>
    `<tr class="${it.def ? 'ins-def' : ''}"><td>${it.k}</td><td>${it.v ?? '—'}${it.def ? ' <span class="ins-tag">def</span>' : ''}</td></tr>`).join('');
  const hayDef = (items || []).some((it) => it && it.def);
  return `<details class="ins-box" open><summary>${titulo}</summary>
    <table class="ins-tbl"><tbody>${filas}</tbody></table>
    ${hayDef ? '<p class="ins-note">Los valores marcados <b>def</b> son por defecto (no vienen del proyecto): revísalos.</p>' : ''}
  </details>`;
}

// Aviso "calculado para X, seleccionado Y — recalcular" cuando cambia la selección
// con un HUD abierto. Devuelve HTML (o '' si coinciden).
export function avisoDesfase(calculadoPara, seleccionActual) {
  if (!calculadoPara || !seleccionActual || calculadoPara === seleccionActual) return '';
  return `<div class="ins-desfase">Calculado para <b>${calculadoPara}</b>, seleccionado ahora <b>${seleccionActual}</b> — recalcula para actualizar.</div>`;
}
