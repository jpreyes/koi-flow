// ─────────────────────────────────────────────────────────────────────────────
// login_ui.js — pantalla de acceso de koi-flow (Fase A). Overlay full-screen con
// Ingresar / Crear cuenta / Recuperar clave, en el mismo estilo vanilla + tema.
// Cuando hay sesión válida, se quita solo y llama onEntrar() para arrancar la app.
// ─────────────────────────────────────────────────────────────────────────────
import { registrar, login, resetPassword, estaAutenticado, usuario } from './auth.js?v=13';

const CSS = `
.koi-auth-ov{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
  background:var(--bg,#0e1116);color:var(--fg,#e6e9ef);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:20px}
.koi-auth-card{width:min(400px,94vw);background:var(--panel,#171b22);border:1px solid var(--border,#2a2f3a);
  border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45);padding:28px 26px}
.koi-auth-brand{display:flex;align-items:baseline;gap:6px;font-size:26px;font-weight:800;margin:0 0 2px}
.koi-auth-brand .k{color:#e23b5a}.koi-auth-brand .f{color:#31c3ce}
.koi-auth-sub{margin:0 0 20px;color:var(--muted,#8b93a3);font-size:13px}
.koi-auth-tabs{display:flex;gap:4px;margin-bottom:18px;background:var(--bg,#0e1116);border-radius:9px;padding:4px}
.koi-auth-tab{flex:1;padding:8px;border:0;border-radius:6px;background:transparent;color:var(--muted,#8b93a3);
  font-weight:600;cursor:pointer;font-size:14px}
.koi-auth-tab.on{background:var(--panel,#171b22);color:var(--fg,#e6e9ef);box-shadow:0 1px 3px rgba(0,0,0,.3)}
.koi-auth-f{display:block;margin-bottom:14px}
.koi-auth-f span{display:block;font-size:12px;color:var(--muted,#8b93a3);margin-bottom:5px}
.koi-auth-f input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid var(--border,#2a2f3a);
  background:var(--bg,#0e1116);color:var(--fg,#e6e9ef);font-size:15px}
.koi-auth-f input:focus{outline:0;border-color:#31c3ce}
.koi-auth-btn{width:100%;padding:11px;border:0;border-radius:8px;background:#e23b5a;color:#fff;font-weight:700;
  font-size:15px;cursor:pointer;margin-top:4px}
.koi-auth-btn:disabled{opacity:.6;cursor:default}
.koi-auth-link{background:0;border:0;color:#31c3ce;cursor:pointer;font-size:13px;padding:0;margin-top:12px}
.koi-auth-msg{margin:12px 0 0;padding:10px 12px;border-radius:8px;font-size:13px;display:none}
.koi-auth-msg.err{display:block;background:rgba(226,59,90,.12);color:#f4859b;border:1px solid rgba(226,59,90,.3)}
.koi-auth-msg.ok{display:block;background:rgba(49,195,206,.12);color:#7fe3ea;border:1px solid rgba(49,195,206,.3)}`;

// Monta la puerta de acceso. Si ya hay sesión, llama onEntrar de una.
// opts.onEntrar(): arranca la app. opts.target: dónde montar (default body).
export function montarPuertaAuth({ onEntrar, target = document.body } = {}) {
  if (estaAutenticado()) { onEntrar?.(usuario()); return null; }

  if (!document.getElementById('koi-auth-css')) {
    const st = document.createElement('style'); st.id = 'koi-auth-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const ov = document.createElement('div'); ov.className = 'koi-auth-ov';
  ov.innerHTML = `
    <div class="koi-auth-card">
      <h1 class="koi-auth-brand"><span class="k">Koi</span><span class="f">Flow</span></h1>
      <p class="koi-auth-sub">Estudios hidrológico-hidráulicos · acceso profesional</p>
      <div class="koi-auth-tabs">
        <button class="koi-auth-tab on" data-tab="login">Ingresar</button>
        <button class="koi-auth-tab" data-tab="signup">Crear cuenta</button>
      </div>
      <form class="koi-auth-form">
        <label class="koi-auth-f"><span>Correo</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="koi-auth-f"><span>Contraseña</span><input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
        <button type="submit" class="koi-auth-btn">Ingresar</button>
      </form>
      <button class="koi-auth-link" data-reset>¿Olvidaste tu contraseña?</button>
      <div class="koi-auth-msg"></div>
    </div>`;
  target.appendChild(ov);

  const $ = (s) => ov.querySelector(s);
  const form = $('.koi-auth-form'), btn = $('.koi-auth-btn'), msg = $('.koi-auth-msg'), pass = form.password;
  let modo = 'login';

  const decir = (t, tipo) => { msg.className = 'koi-auth-msg ' + tipo; msg.textContent = t; };
  const limpiar = () => { msg.className = 'koi-auth-msg'; msg.textContent = ''; };

  const setModo = (m) => {
    modo = m; limpiar();
    ov.querySelectorAll('.koi-auth-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === m));
    btn.textContent = m === 'signup' ? 'Crear cuenta' : 'Ingresar';
    pass.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  };
  ov.querySelectorAll('.koi-auth-tab').forEach((t) => t.addEventListener('click', () => setModo(t.dataset.tab)));

  $('[data-reset]').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) { decir('Escribe tu correo arriba y vuelve a tocar el enlace.', 'err'); return; }
    try { await resetPassword(email); decir(`Te enviamos un correo para restablecer la contraseña a ${email}.`, 'ok'); }
    catch (e) { decir(e.message, 'err'); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); limpiar();
    const email = form.email.value.trim(), password = pass.value;
    btn.disabled = true; const txt = btn.textContent; btn.textContent = '…';
    try {
      if (modo === 'signup') {
        const { necesitaConfirmar } = await registrar(email, password);
        if (necesitaConfirmar) { decir(`Cuenta creada. Revisa tu correo (${email}) y confirma para ingresar.`, 'ok'); setModo('login'); }
        else { cerrar(); onEntrar?.(usuario()); }
      } else {
        await login(email, password);
        cerrar(); onEntrar?.(usuario());
      }
    } catch (err) {
      const m = /not confirmed/i.test(err.message) ? 'Tu correo aún no está confirmado. Revisa tu bandeja.' : err.message;
      decir(m, 'err');
    } finally { btn.disabled = false; btn.textContent = txt; }
  });

  function cerrar() { ov.remove(); }
  return { cerrar };
}
