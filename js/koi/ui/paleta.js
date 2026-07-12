// ─────────────────────────────────────────────────────────────────────────────
// paleta.js — Command palette (Ctrl/Cmd+K) de koi-flow (Fase B · B4).
// Busca y lanza CUALQUIER acción del menú superior sin recorrerlo: lee los
// `.menu-item[data-action]` (se mantiene en sync solo), filtra difuso, navega con
// teclado y dispara la acción por el bus (mismo despacho que menú/árbol). Las
// acciones desactivadas (sin su prerequisito) se ven en gris y no se lanzan.
// ─────────────────────────────────────────────────────────────────────────────
import { bus } from './bus.js?v=13';

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Puntaje difuso (subsecuencia + bonus por substring exacto). -1 = no calza.
function puntaje(q, texto) {
  const t = norm(texto); q = norm(q);
  if (!q) return 0;
  let ti = 0, score = 0, streak = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return -1;
    streak = idx === ti ? streak + 1 : 0;
    score += 1 + streak;
    ti = idx + 1;
  }
  if (t.includes(q)) score += 6;
  return score - t.length * 0.02;
}

// Lee las acciones vigentes del menú superior (etiqueta + menú padre + estado).
function leerAcciones() {
  const out = [];
  for (const it of document.querySelectorAll('#appmenu .menu-item[data-action]')) {
    const action = it.dataset.action;
    const label = it.textContent.trim();
    if (!action || !label) continue;
    const menu = it.closest('.menu')?.querySelector('.menu-btn')?.textContent.trim() || '';
    out.push({ action, label, menu, disabled: it.classList.contains('disabled') });
  }
  return out;
}

let _ov = null, _idx = 0, _items = [];

export function montarPaleta() {
  inyectarCSS();
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); abrir(); }
  });
  bus.on('paleta:abrir', abrir);
}

function abrir() {
  if (_ov) { cerrar(); return; }
  _ov = document.createElement('div');
  _ov.className = 'kp-ov';
  _ov.innerHTML = `
    <div class="kp-box" role="dialog" aria-label="Buscar acción">
      <input class="kp-input" type="text" placeholder="Buscar acción…  (por ejemplo: tormenta, cuenca, correr, informe)" autocomplete="off" spellcheck="false">
      <div class="kp-list" role="listbox"></div>
      <div class="kp-ft"><span>↑↓ navegar · ↵ ejecutar · Esc cerrar</span></div>
    </div>`;
  document.body.appendChild(_ov);
  const input = _ov.querySelector('.kp-input');
  _ov.addEventListener('mousedown', (e) => { if (e.target === _ov) cerrar(); });
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', onKey);
  render('');
  input.focus();
}

function cerrar() { _ov?.remove(); _ov = null; _items = []; _idx = 0; }

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); ejecutar(_items[_idx]); }
}

function mover(d) {
  if (!_items.length) return;
  _idx = (_idx + d + _items.length) % _items.length;
  pintarSel();
}

function pintarSel() {
  const rows = _ov.querySelectorAll('.kp-item');
  rows.forEach((r, i) => r.classList.toggle('sel', i === _idx));
  rows[_idx]?.scrollIntoView({ block: 'nearest' });
}

function ejecutar(item) {
  if (!item || item.disabled) return;
  cerrar();
  bus.emit('abrir:analisis', item.action);
}

function render(q) {
  const acciones = leerAcciones();
  _items = (q ? acciones.map((a) => ({ a, s: Math.max(puntaje(q, a.label), puntaje(q, `${a.menu} ${a.label}`)) }))
    .filter((x) => x.s > -1).sort((x, y) => y.s - x.s).map((x) => x.a)
    : acciones);
  _idx = 0;
  const list = _ov.querySelector('.kp-list');
  if (!_items.length) { list.innerHTML = '<div class="kp-empty">Sin coincidencias.</div>'; return; }
  list.innerHTML = _items.map((it, i) => `
    <div class="kp-item${i === 0 ? ' sel' : ''}${it.disabled ? ' dis' : ''}" data-i="${i}" role="option">
      <span class="kp-lbl">${it.label}</span>
      <span class="kp-menu">${it.menu}${it.disabled ? ' · requiere un paso previo' : ''}</span>
    </div>`).join('');
  list.querySelectorAll('.kp-item').forEach((r) => {
    r.addEventListener('mousemove', () => { _idx = +r.dataset.i; pintarSel(); });
    r.addEventListener('click', () => ejecutar(_items[+r.dataset.i]));
  });
}

function inyectarCSS() {
  if (document.getElementById('kp-css')) return;
  const st = document.createElement('style'); st.id = 'kp-css';
  st.textContent = `
.kp-ov{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.42);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}
.kp-box{width:min(560px,92vw);max-height:70vh;display:flex;flex-direction:column;background:var(--panel,#171b22);color:var(--fg,#e6e9ef);
  border:1px solid var(--border2,#2a2f3a);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.5);overflow:hidden}
.kp-input{border:0;border-bottom:1px solid var(--border,#2a2f3a);background:transparent;color:inherit;font-size:15px;padding:15px 18px;outline:none}
.kp-list{overflow:auto;padding:6px}
.kp-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer}
.kp-item.sel{background:color-mix(in srgb,var(--accent,#128aa5) 20%,transparent)}
.kp-item.dis{opacity:.45;cursor:not-allowed}
.kp-lbl{flex:1;font-size:13.5px}
.kp-menu{font-size:11px;color:var(--muted,#8b93a3);white-space:nowrap}
.kp-empty{padding:16px;color:var(--muted,#8b93a3);font-size:13px;text-align:center}
.kp-ft{border-top:1px solid var(--border,#2a2f3a);padding:7px 14px;font-size:11px;color:var(--muted,#8b93a3)}`;
  document.head.appendChild(st);
}
