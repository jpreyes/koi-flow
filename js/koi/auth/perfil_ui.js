// ─────────────────────────────────────────────────────────────────────────────
// perfil_ui.js — control de PERFIL a la derecha del menubar (Fase A).
// Muestra avatar + correo + organización, y un menú desplegable (flecha) con
// Configuración / Cambiar tema / Ayuda / Cerrar sesión. Reemplaza el "Salir" pelado.
// Los ítems que ya existen en la barra se disparan reusando sus data-action.
// ─────────────────────────────────────────────────────────────────────────────
import { onAuth, logout } from './auth.js?v=13';
import { perfilOrg } from './proyectos_nube.js?v=13';

const CSS = `
#koi-profile{margin-left:auto;position:relative;display:none;align-items:center}
#koi-profile.on{display:flex}
.koi-pf-btn{display:flex;align-items:center;gap:9px;background:transparent;border:0;color:var(--fg,#e6e9ef);
  cursor:pointer;padding:5px 8px;border-radius:8px;font:inherit}
.koi-pf-btn:hover{background:var(--hover,rgba(255,255,255,.07))}
.koi-pf-av{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#e23b5a,#31c3ce);
  color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:0 0 auto}
.koi-pf-txt{display:flex;flex-direction:column;line-height:1.15;text-align:left;max-width:200px}
.koi-pf-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.koi-pf-org{font-size:11px;color:var(--muted,#8b93a3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.koi-pf-caret{color:var(--muted,#8b93a3);font-size:11px}
.koi-pf-menu{position:absolute;top:calc(100% + 6px);right:0;min-width:220px;background:var(--panel,#171b22);
  color:var(--fg,#e6e9ef);border:1px solid var(--border,#2a2f3a);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.4);
  padding:6px;z-index:1000}
.koi-pf-menu[hidden]{display:none}
.koi-pf-head{padding:8px 10px 10px;border-bottom:1px solid var(--border,#2a2f3a);margin-bottom:6px}
.koi-pf-head .n{font-weight:600;font-size:13px;word-break:break-all}
.koi-pf-head .o{font-size:12px;color:var(--muted,#8b93a3);margin-top:2px}
.koi-pf-item{width:100%;display:flex;align-items:center;gap:9px;background:0;border:0;color:inherit;
  text-align:left;padding:9px 10px;border-radius:7px;cursor:pointer;font:inherit;font-size:13px}
.koi-pf-item:hover{background:var(--hover,rgba(255,255,255,.07))}
.koi-pf-item.danger{color:#f4859b}`;

// Dispara una acción que YA existe en la barra de menú (reusa su wiring).
function accion(a) { document.querySelector(`.menu-item[data-action="${a}"]`)?.click(); }

export function montarPerfil() {
  if (!document.getElementById('koi-perfil-css')) {
    const st = document.createElement('style'); st.id = 'koi-perfil-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const bar = document.getElementById('menubar'); if (!bar) return;
  let pf = document.getElementById('koi-profile');
  if (!pf) {
    pf = document.createElement('div'); pf.id = 'koi-profile';
    pf.innerHTML = `
      <button class="koi-pf-btn" aria-haspopup="true" aria-expanded="false">
        <span class="koi-pf-av"></span>
        <span class="koi-pf-txt"><span class="koi-pf-name"></span><span class="koi-pf-org">…</span></span>
        <span class="koi-pf-caret">▾</span>
      </button>
      <div class="koi-pf-menu" hidden>
        <div class="koi-pf-head"><div class="n"></div><div class="o">Cargando organización…</div></div>
        <button class="koi-pf-item" data-prof="config">⚙ Configuración</button>
        <button class="koi-pf-item" data-prof="tema">◐ Cambiar tema</button>
        <button class="koi-pf-item" data-prof="ayuda">? Ayuda y tutorial</button>
        <button class="koi-pf-item danger" data-prof="logout">⎋ Cerrar sesión</button>
      </div>`;
    bar.appendChild(pf);

    const btn = pf.querySelector('.koi-pf-btn'), menu = pf.querySelector('.koi-pf-menu');
    const abrir = (v) => { menu.hidden = !v; btn.setAttribute('aria-expanded', String(v)); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); abrir(menu.hidden); });
    document.addEventListener('click', () => abrir(false));
    menu.addEventListener('click', (e) => e.stopPropagation());
    menu.querySelector('[data-prof="config"]').addEventListener('click', () => { abrir(false); accion('config'); });
    menu.querySelector('[data-prof="tema"]').addEventListener('click', () => { abrir(false); accion('tema'); });
    menu.querySelector('[data-prof="ayuda"]').addEventListener('click', () => { abrir(false); accion('ayuda'); });
    menu.querySelector('[data-prof="logout"]').addEventListener('click', async () => { abrir(false); await logout(); location.reload(); });
  }

  // Reacciona a la sesión: pinta correo + carga la organización.
  onAuth(async (s) => {
    if (!s?.user) { pf.classList.remove('on'); return; }
    const email = s.user.email || '';
    const ini = (email[0] || '?').toUpperCase();
    pf.querySelector('.koi-pf-av').textContent = ini;
    pf.querySelector('.koi-pf-name').textContent = email;
    pf.querySelector('.koi-pf-head .n').textContent = email;
    pf.classList.add('on');
    try {
      const org = await perfilOrg();
      const txt = org ? `${org.nombre} · ${org.rol}` : 'Sin organización';
      pf.querySelector('.koi-pf-org').textContent = org ? org.nombre : 'Sin organización';
      pf.querySelector('.koi-pf-head .o').textContent = txt;
    } catch (e) {
      pf.querySelector('.koi-pf-org').textContent = '—';
      pf.querySelector('.koi-pf-head .o').textContent = 'Organización no disponible';
    }
  });
}
