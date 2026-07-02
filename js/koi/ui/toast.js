// ─────────────────────────────────────────────────────────────────────────────
// toast.js — notificaciones no bloqueantes + indicador global de cómputo (koi-flow).
// Reemplaza los alert() (bloqueaban y no son tematizables) por toasts apilados en
// la esquina inferior derecha, y agrega un badge "⏳ calculando…" en el menubar
// mientras haya trabajos activos (workers 2D, informes, descargas largas).
// Se expone también en window.__koiToast / __koiBusy para módulos no-ESM.
// ─────────────────────────────────────────────────────────────────────────────

let _wrap = null;
function wrap() {
  if (_wrap && document.body.contains(_wrap)) return _wrap;
  _wrap = document.createElement('div');
  _wrap.id = 'koi-toasts';
  _wrap.setAttribute('role', 'status');
  _wrap.setAttribute('aria-live', 'polite');
  document.body.appendChild(_wrap);
  return _wrap;
}

// toast('mensaje', 'info'|'ok'|'warn'|'error', {ms})
export function toast(msg, tipo = 'info', { ms } = {}) {
  const t = document.createElement('div');
  t.className = `koi-toast koi-toast-${tipo}`;
  t.innerHTML = `<span class="kt-ico">${{ info: 'ℹ️', ok: '✔️', warn: '⚠️', error: '✖️' }[tipo] || 'ℹ️'}</span><span>${msg}</span>`;
  t.addEventListener('click', () => t.remove());
  wrap().appendChild(t);
  const dur = ms ?? (tipo === 'error' ? 8000 : tipo === 'warn' ? 6000 : 3800);
  setTimeout(() => { t.classList.add('kt-out'); setTimeout(() => t.remove(), 350); }, dur);
  return t;
}

// ── indicador global de cómputo ───────────────────────────────────────────────
const _jobs = new Map();
let _seq = 0, _badge = null;

function badge() {
  if (_badge && document.body.contains(_badge)) return _badge;
  _badge = document.createElement('div');
  _badge.id = 'koi-busy';
  _badge.innerHTML = `<span class="kb-spin"></span><span class="kb-txt"></span>`;
  (document.getElementById('menubar') || document.body).appendChild(_badge);
  return _badge;
}
function pinta() {
  const b = badge();
  if (_jobs.size === 0) { b.classList.remove('on'); return; }
  b.classList.add('on');
  const labels = [..._jobs.values()];
  b.querySelector('.kb-txt').textContent = labels.length === 1 ? labels[0] : `${labels[0]} (+${labels.length - 1})`;
}

// busyStart('Momentum 2D…') → id; busyEnd(id) al terminar (usar en try/finally).
export function busyStart(label = 'calculando…') { const id = ++_seq; _jobs.set(id, label); pinta(); return id; }
export function busyEnd(id) { _jobs.delete(id); pinta(); }

// estilos (inyectados una vez — no requiere tocar koi.css)
const CSS = `
#koi-toasts { position: fixed; right: 14px; bottom: 14px; z-index: 4000; display: flex; flex-direction: column; gap: 8px; max-width: 340px; }
.koi-toast { display: flex; gap: 8px; align-items: flex-start; background: var(--panel, #10222e); color: var(--text, #e7f0f4);
  border: 1px solid var(--border2, #29414f); border-left-width: 4px; border-radius: 9px; padding: 9px 12px;
  font: 12.5px/1.45 system-ui, sans-serif; box-shadow: 0 6px 22px rgba(0,0,0,.28); cursor: pointer;
  animation: kt-in .22s ease-out; }
.koi-toast-ok { border-left-color: #2dd4bf; } .koi-toast-info { border-left-color: #38bdf8; }
.koi-toast-warn { border-left-color: #fbbf24; } .koi-toast-error { border-left-color: #ef6c5a; }
.kt-ico { flex: 0 0 auto; }
.kt-out { opacity: 0; transform: translateY(6px); transition: all .3s; }
@keyframes kt-in { from { opacity: 0; transform: translateY(8px); } }
#koi-busy { display: none; align-items: center; gap: 7px; margin-left: auto; padding: 3px 10px; border-radius: 999px;
  background: rgba(49,195,206,.14); border: 1px solid rgba(49,195,206,.4); color: var(--text, #cfe); font: 11.5px system-ui, sans-serif; }
#koi-busy.on { display: inline-flex; }
.kb-spin { width: 11px; height: 11px; border: 2px solid rgba(49,195,206,.35); border-top-color: #31c3ce; border-radius: 50%; animation: kb-rot .8s linear infinite; }
@keyframes kb-rot { to { transform: rotate(360deg); } }
`;
if (typeof document !== 'undefined' && !document.getElementById('koi-toast-css')) {
  const st = document.createElement('style'); st.id = 'koi-toast-css'; st.textContent = CSS; document.head.appendChild(st);
}
if (typeof window !== 'undefined') { window.__koiToast = toast; window.__koiBusy = { start: busyStart, end: busyEnd }; }
