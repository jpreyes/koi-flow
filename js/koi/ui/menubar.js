// ─────────────────────────────────────────────────────────────────────────────
// menubar.js — barra de menús tipo software de escritorio (koi-flow).
// Menús desplegables (Archivo / Editar / Ver / Análisis / Ayuda): clic abre/cierra,
// al tener uno abierto el hover cambia de menú, clic fuera o Esc cierra. Cada ítem
// lleva data-action y se despacha contra el mapa `actions` que pasa boot.
// ─────────────────────────────────────────────────────────────────────────────
export function setupMenubar(actions = {}) {
  const bar = document.getElementById('appmenu'); if (!bar) return;
  const menus = [...bar.querySelectorAll('.menu')];
  let open = null;
  const close = () => { if (open) { open.classList.remove('open'); open = null; } };
  const abrir = (m) => { if (open === m) return; close(); m.classList.add('open'); open = m; };
  for (const m of menus) {
    const btn = m.querySelector('.menu-btn');
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (open === m) close(); else abrir(m); });
    btn.addEventListener('mouseenter', () => { if (open) abrir(m); });
  }
  bar.addEventListener('click', (e) => {
    const it = e.target.closest('.menu-item');
    if (!it || !bar.contains(it)) return;
    e.stopPropagation();
    if (it.classList.contains('disabled') || it.getAttribute('aria-disabled') === 'true') {
      const msg = it.title || it.nextElementSibling?.textContent;
      if (msg) window.__koiToast?.(msg, 'warn');
      return;
    }
    close();
    actions[it.dataset.action]?.();
  });
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
