// ─────────────────────────────────────────────────────────────────────────────
// config_ui.js — panel ⚙ de configuración (koi-flow). Abre un HUD flotante con los
// parámetros por defecto editables (getConfig/SCHEMA). Guardar → setConfig; los
// formularios los toman como default a partir de ese momento.
// ─────────────────────────────────────────────────────────────────────────────
import { getConfig, setConfig, resetConfig, SCHEMA } from '../config.js?v=8';

export function abrirConfigHUD(huds) {
  const c = getConfig();
  const grupos = SCHEMA.map((g) => `
    <div class="cfg-grp">${g.grupo}</div>
    <div class="cfg-form">
      ${g.campos.map(([k, lbl, step]) => `<label>${lbl}<input type="number" step="${step}" data-cfg="${k}" value="${c[k]}"></label>`).join('')}
    </div>`).join('');
  const html = `${grupos}
    <div class="cfg-btns">
      <button class="hp-run" id="cfg-save">Guardar configuración</button>
      <button class="bp-b" id="cfg-reset">Restablecer</button>
    </div>
    <p class="hud-note">Estos valores se usan como <b>default</b> en los formularios nuevos (hidráulica, socavación, red de drenaje, malla 2D).</p>`;
  const hud = huds.open('config', { title: '⚙ Configuración', w: 380, h: 460, html });
  hud.body.querySelector('#cfg-save').addEventListener('click', () => {
    const upd = {};
    hud.body.querySelectorAll('[data-cfg]').forEach((i) => { const v = parseFloat(i.value); if (isFinite(v)) upd[i.dataset.cfg] = v; });
    setConfig(upd);
    const b = hud.body.querySelector('#cfg-save'); b.textContent = '✓ Guardado'; setTimeout(() => { b.textContent = 'Guardar configuración'; }, 1200);
  });
  hud.body.querySelector('#cfg-reset').addEventListener('click', () => { resetConfig(); abrirConfigHUD(huds); });
  return hud;
}
