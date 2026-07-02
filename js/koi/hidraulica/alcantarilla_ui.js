// ─────────────────────────────────────────────────────────────────────────────
// alcantarilla_ui.js — HUD de diseño de alcantarillas FHWA HDS-5 (koi-flow).
// Elige tipo/forma/dimensiones, caudal, pendiente, largo y tirante aguas abajo →
// carga de agua (HW = máx control entrada/salida), velocidad de salida, régimen,
// chequeo de anegamiento de la rasante y curva de gasto (performance curve).
// ─────────────────────────────────────────────────────────────────────────────
import { disenarAlcantarilla, curvaGasto, TIPOS_ALC } from './alcantarilla.js?v=2';
import { registrar } from '../informe/registro.js?v=2';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirAlcantarillaHUD(koi, huds) {
  const hud = huds.open('alcantarilla', { title: '🛢️ Alcantarilla (FHWA HDS-5)', w: 470, h: 620 });
  if (hud._alcWired) { hud.focus?.(); return hud; }
  hud.setBody(form());
  wire(hud);
  hud._alcWired = true;
  return hud;
}

function form() {
  const opts = Object.entries(TIPOS_ALC).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  return `
    <div class="cfg-grp">Barril y embocadura</div>
    <div class="cfg-form">
      <label style="grid-column:1/3">Tipo / embocadura<select id="al-tipo">${opts}</select></label>
      <label>Alto / Ø D [m]<input id="al-d" type="number" step="0.1" value="1.2"></label>
      <label id="al-bwrap" style="display:none">Ancho B [m]<input id="al-b" type="number" step="0.1" value="2"></label>
      <label>Largo L [m]<input id="al-l" type="number" value="25"></label>
      <label>Pendiente S [m/m]<input id="al-s" type="number" step="0.005" value="0.02"></label>
      <label>Manning n<input id="al-n" type="number" step="0.001" placeholder="por material"></label>
      <label>Nº de barriles<input id="al-nb" type="number" min="1" step="1" value="1"></label>
    </div>
    <div class="cfg-grp">Hidráulica</div>
    <div class="cfg-form">
      <label>Caudal Q [m³/s]<input id="al-q" type="number" step="0.5" value="3"></label>
      <label>Tirante aguas abajo TW [m]<input id="al-tw" type="number" step="0.1" value="0.5"></label>
      <label>Cota solera entrada [m]<input id="al-ce" type="number" step="0.5" placeholder="opcional"></label>
      <label>Cota rasante/corona [m]<input id="al-cc" type="number" step="0.5" placeholder="opcional"></label>
    </div>
    <button class="hp-run" id="al-run" style="margin-top:8px">🛢️ Calcular (HDS-5)</button>
    <div id="al-out"></div>`;
}

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  const syncForma = () => {
    const cfg = TIPOS_ALC[$('#al-tipo').value];
    $('#al-bwrap').style.display = cfg && cfg.forma === 'cajon' ? '' : 'none';
    $('#al-n').placeholder = 'n=' + (cfg ? cfg.n : 0.013);
  };
  $('#al-tipo').addEventListener('change', syncForma);
  syncForma();

  $('#al-run').addEventListener('click', () => {
    const o = {
      tipo: $('#al-tipo').value, D: +$('#al-d').value, B: +$('#al-b').value, nBarriles: +$('#al-nb').value || 1,
      L: +$('#al-l').value, S: +$('#al-s').value, Q: +$('#al-q').value, TW: +$('#al-tw').value,
      n: $('#al-n').value ? +$('#al-n').value : undefined,
      cotaEntrada: $('#al-ce').value ? +$('#al-ce').value : undefined,
      cotaCorona: $('#al-cc').value ? +$('#al-cc').value : undefined,
    };
    const out = $('#al-out');
    if (!(o.Q > 0) || !(o.D > 0)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Ingresa D y Q.</p>'; return; }
    const r = disenarAlcantarilla(o);
    registrar('alcantarilla', {
      tipo: r.label, dim: r.forma === 'cajon' ? `cajón ${f(r.B, 1)}×${f(r.D, 1)} m` : `Ø ${f(r.D, 1)} m`,
      nBarriles: r.nBarriles || 1, Q: r.Q, Qbarril: r.Qbarril ?? r.Q,
      HWe: r.HWi, HWs: r.HWo, gobierna: r.control, HWD: r.HWD, Vsal: r.Vout,
    });
    const ctrlTxt = r.control === 'entrada' ? 'CONTROL DE ENTRADA' : 'CONTROL DE SALIDA';
    const ot = r.overtop == null ? '' :
      `<div class="bp-resalto" style="border-color:${r.overtop ? 'var(--coral)' : 'var(--teal)'}">
         ${r.overtop ? '⚠️ <b>Anega la rasante</b>: la carga de agua supera la corona.' : '✔️ La carga no alcanza la rasante (sin vertido sobre la calzada).'}
         <div class="hp-kv"><div><span>Cota agua entrada</span><b>${f(o.cotaEntrada + r.HW)} m</b></div>
         <div><span>Cota corona</span><b>${f(o.cotaCorona)} m</b></div></div></div>`;
    out.innerHTML = `
      <div class="hp-mini" style="margin-top:8px">${r.label} · ${r.forma === 'cajon' ? `cajón ${f(r.B, 1)}×${f(r.D, 1)} m` : `Ø ${f(r.D, 1)} m`}${r.nBarriles > 1 ? ` · ${r.nBarriles} barriles` : ''}</div>
      <div class="hp-kv">
        ${r.nBarriles > 1 ? `<div><span>Caudal por barril (de ${f(r.Q, 0)} total)</span><b>${f(r.Qbarril)} m³/s</b></div>` : ''}
        <div><span>Carga de agua HW</span><b>${f(r.HW)} m (HW/D ${f(r.HWD)})</b></div>
        <div><span>Gobierna</span><b>${ctrlTxt}</b></div>
        <div><span>HW control entrada / salida</span><b>${f(r.HWi)} / ${f(r.HWo)} m</b></div>
        <div><span>Régimen entrada</span><b>${r.regimenEntrada}${r.sumergido ? ' · sumergido' : ''}</b></div>
        <div><span>Velocidad de salida</span><b>${f(r.Vout)} m/s</b></div>
        <div><span>Tirante crítico / normal</span><b>${f(r.dc)} / ${f(r.dn)} m</b></div>
      </div>
      ${ot}
      ${svgCurva(o, r)}
      <p class="hud-note">HW = máx(control entrada, control salida) sobre la solera de entrada (FHWA HDS-5). El punto coral es el caudal de diseño. Velocidad de salida alta (&gt;4–5 m/s) exige disipador/enrocado (MC 3.703).</p>`;
  });
}

function svgCurva(o, rd) {
  let pts;
  try { pts = curvaGasto(o, { nPtos: 24 }); } catch { return ''; }
  const W = 420, H = 170, pad = 30;
  const qMax = Math.max(...pts.map((p) => p.Q), rd.Q) || 1;
  const hMax = Math.max(...pts.map((p) => p.HW), rd.HW) || 1;
  const X = (q) => pad + (q / qMax) * (W - 2 * pad);
  const Y = (h) => H - pad - (h / hMax) * (H - 2 * pad);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.Q).toFixed(1)},${Y(p.HW).toFixed(1)}`).join(' ');
  // segmenta el color por control (entrada=azul, salida=coral)
  const dots = pts.map((p) => `<circle cx="${X(p.Q).toFixed(1)}" cy="${Y(p.HW).toFixed(1)}" r="1.8" fill="${p.control === 'salida' ? '#ef6c5a' : '#2563eb'}"/>`).join('');
  const dTop = rd.D ? `<line x1="${pad}" y1="${Y(rd.D).toFixed(1)}" x2="${W - pad}" y2="${Y(rd.D).toFixed(1)}" stroke="var(--border2)" stroke-dasharray="3 3"/><text x="${W - pad}" y="${Y(rd.D) - 3}" text-anchor="end" font-size="8" fill="var(--text2)">HW=D</text>` : '';
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="var(--border2)"/>
    ${dTop}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>${dots}
    <circle cx="${X(rd.Q).toFixed(1)}" cy="${Y(rd.HW).toFixed(1)}" r="4" fill="#ef6c5a" stroke="#fff"/>
    <text x="${W - pad}" y="${H - 8}" text-anchor="end" font-size="8" fill="var(--text2)">Q ${qMax.toFixed(0)} m³/s</text>
    <text x="${pad + 3}" y="${pad + 2}" font-size="8" fill="var(--text2)">HW ${hMax.toFixed(1)} m</text>
    <text x="${pad + 3}" y="${H - 4}" font-size="8" fill="var(--text2)">curva de gasto · azul entrada / coral salida</text></svg>`;
}
