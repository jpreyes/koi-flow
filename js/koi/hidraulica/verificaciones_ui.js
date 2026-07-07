// ─────────────────────────────────────────────────────────────────────────────
// verificaciones_ui.js — HUD de verificaciones normativas (koi-flow): período de
// retorno de diseño por tipo de obra (MC-V3 3.702) y chequeo de revancha / gálibo
// bajo el tablero (MC-V3 3.707.4). Puede fijar el T por defecto del proyecto.
// ─────────────────────────────────────────────────────────────────────────────
import { PERIODOS_RETORNO, sugerirT, chequeoRevancha, revanchaRecomendada } from './normas.js?v=13';
import { getConfig, setConfig } from '../config.js?v=13';
import { registrar } from '../informe/registro.js?v=13';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirVerificacionesHUD(koi, huds) {
  const hud = huds.open('verificaciones', { title: '📐 Verificaciones (T · revancha)', w: 480, h: 600 });
  if (hud._verWired) { hud.focus?.(); return hud; }
  hud.setBody(form(koi));
  wire(hud, koi);
  hud._verWired = true;
  return hud;
}

function form(koi) {
  const opts = PERIODOS_RETORNO.map((p, i) => `<option value="${i}">${p.obra}</option>`).join('');
  const rows = PERIODOS_RETORNO.map((p) => `<tr><td>${p.obra}</td><td>${p.T}</td><td>${p.Tver}</td></tr>`).join('');
  // prefill WSE de diseño desde el eje 1D
  let wse = '';
  try { const rem = koi.bati?._remanso?.perfil; if (rem?.length) wse = Math.max(...rem.map((p) => p.WSE || 0)).toFixed(1); } catch { /* */ }
  return `
    <div class="cfg-grp">Período de retorno de diseño (MC-V3 3.702)</div>
    <table class="hp-tbl"><thead><tr><th>Tipo de obra</th><th>T diseño</th><th>T verif.</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="cfg-form" style="margin-top:6px">
      <label style="grid-column:1/3">Aplicar al proyecto<select id="ve-obra">${opts}</select></label>
    </div>
    <button class="hp-run" id="ve-setT" style="margin-top:4px">Fijar T de diseño del proyecto</button>
    <span class="hp-dl-status" id="ve-setT-st"></span>

    <div class="cfg-grp" style="margin-top:12px">Revancha / gálibo bajo el tablero (MC-V3 3.707.4)</div>
    <div class="cfg-form">
      <label>WSE de diseño [m]<input id="ve-wse" type="number" step="0.1" value="${wse}"></label>
      <label>Cota bajo-tablero [m]<input id="ve-zl" type="number" step="0.1"></label>
      <label>Arrastre de material<select id="ve-arr">
        <option value="bajo">Bajo (sin arrastre)</option>
        <option value="medio" selected>Medio (sedimento grueso)</option>
        <option value="alto">Alto (palizada)</option>
        <option value="extremo">Extremo (troncos)</option></select></label>
      <label>Revancha mínima [m]<input id="ve-rev" type="number" step="0.1" value="1.0"></label>
    </div>
    <button class="hp-run" id="ve-rev-run" style="margin-top:4px">Verificar revancha</button>
    <div id="ve-out"></div>
    <p class="hud-note">Los T son referenciales (MC-V3 3.702.203.A): verifica la categoría del camino y la edición vigente. La revancha mínima crece con el arrastre de material flotante.</p>`;
}

function wire(hud, koi) {
  const $ = (s) => hud.body.querySelector(s);
  // sincroniza revancha recomendada con el arrastre elegido
  $('#ve-arr').addEventListener('change', () => { $('#ve-rev').value = revanchaRecomendada($('#ve-arr').value).toFixed(1); });

  $('#ve-setT').addEventListener('click', () => {
    const p = PERIODOS_RETORNO[+$('#ve-obra').value] || PERIODOS_RETORNO[0];
    try { setConfig({ ...getConfig(), T: p.T }); $('#ve-setT-st').textContent = ` ✓ T=${p.T} años (${p.obra})`; }
    catch { $('#ve-setT-st').textContent = ' (no se pudo fijar)'; }
  });

  $('#ve-rev-run').addEventListener('click', () => {
    const wseDiseno = +$('#ve-wse').value, cotaBajoTablero = +$('#ve-zl').value, revanchaMin = +$('#ve-rev').value || 1.0;
    const out = $('#ve-out');
    if (!isFinite(wseDiseno) || !isFinite(cotaBajoTablero)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Ingresa el WSE de diseño y la cota del bajo-tablero.</p>'; return; }
    const r = chequeoRevancha({ wseDiseno, cotaBajoTablero, revanchaMin });
    const p = PERIODOS_RETORNO[+$('#ve-obra').value] || PERIODOS_RETORNO[0];
    registrar('verificaciones', { obra: p.obra, Tdis: p.T, Tver: p.Tver, revanchaReq: revanchaMin, revanchaDisp: r.galibo, cumple: r.cumple });
    out.innerHTML = `<div class="bp-resalto" style="border-color:${r.cumple ? 'var(--teal)' : 'var(--coral)'}">
      ${r.cumple ? '✔️ <b>CUMPLE</b>' : '⚠️ <b>NO CUMPLE</b>'} — gálibo disponible <b>${f(r.galibo)} m</b> vs mínimo <b>${f(r.revanchaMin)} m</b>.
      ${r.cumple ? '' : `<div class="hp-kv"><div><span>Déficit de revancha</span><b>${f(r.deficit)} m</b></div>
        <div><span>Subir el tablero a</span><b>≥ ${f(wseDiseno + revanchaMin)} m</b></div></div>`}
    </div>`;
  });
}
