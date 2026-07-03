// ─────────────────────────────────────────────────────────────────────────────
// enrocado_ui.js — HUD de dimensionamiento de enrocado / defensas (koi-flow).
// Aplicación (ribera/lecho/pila/estribo), velocidad, calado, talud y socavación →
// D50 por método (Isbash / Maynord-HEC-11 / HEC-23), D50 adoptado, peso de la roca,
// espesor de capa, granulometría y empotramiento del pie. MC-V3 3.707/3.708.
// ─────────────────────────────────────────────────────────────────────────────
import { dimensionarEnrocado } from './enrocado.js?v=7';
import { registrar } from '../informe/registro.js?v=7';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirEnrocadoHUD(koi, huds) {
  const hud = huds.open('enrocado', { title: '🪨 Enrocado / defensas (MC 3.708)', w: 470, h: 620 });
  if (hud._enrWired) { hud.focus?.(); return hud; }
  hud.setBody(form(koi));
  wire(hud);
  hud._enrWired = true;
  return hud;
}

// Prefija V y socavación desde el eje 1D / socavación calculada, si existen.
function sugerir(koi) {
  const s = { V: '', h: '', socav: '' };
  try {
    const bati = koi.bati;
    const rem = bati?._remanso?.perfil;
    if (rem?.length) {
      s.V = Math.max(...rem.map((p) => p.V || 0)).toFixed(1);
      s.h = Math.max(...rem.map((p) => p.profMax || 0)).toFixed(1);
    }
    const sal = bati?._salida?.filas;
    if (sal?.length) s.socav = Math.max(...sal.map((x) => x.socavGeneral || 0)).toFixed(1);
  } catch { /* opcional */ }
  return s;
}

function form(koi) {
  const s = sugerir(koi);
  return `
    <div class="cfg-grp">Aplicación y flujo</div>
    <div class="cfg-form">
      <label style="grid-column:1/3">Protección de<select id="en-ap">
        <option value="ribera">Ribera (talud)</option>
        <option value="lecho">Lecho (fondo)</option>
        <option value="pila">Pila de puente</option>
        <option value="estribo">Estribo de puente</option></select></label>
      <label>Velocidad V [m/s]<input id="en-v" type="number" step="0.1" value="${s.V || 3.5}"></label>
      <label>Calado h [m]<input id="en-h" type="number" step="0.1" value="${s.h || 2}"></label>
      <label id="en-talwrap">Talud ribera H:V<input id="en-tal" type="number" step="0.5" value="2"></label>
      <label id="en-formawrap" style="display:none">Forma<select id="en-forma">
        <option value="derrame">Derrame / redonda</option>
        <option value="vertical">Vertical</option>
        <option value="cuadrada">Cuadrada</option></select></label>
      <label>Turbulencia<select id="en-turb">
        <option value="alta">Alta (junto a estructura)</option>
        <option value="baja">Baja (tramo recto)</option></select></label>
      <label>Densidad roca s<input id="en-s" type="number" step="0.05" value="2.65"></label>
      <label>Socavación de diseño [m]<input id="en-soc" type="number" step="0.1" value="${s.socav}"></label>
    </div>
    <button class="hp-run" id="en-run" style="margin-top:8px">🪨 Dimensionar enrocado</button>
    <div id="en-out"></div>`;
}

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  const sync = () => {
    const ap = $('#en-ap').value;
    $('#en-talwrap').style.display = ap === 'ribera' ? '' : 'none';
    $('#en-formawrap').style.display = (ap === 'pila' || ap === 'estribo') ? '' : 'none';
  };
  $('#en-ap').addEventListener('change', sync);
  sync();

  $('#en-run').addEventListener('click', () => {
    const o = {
      aplicacion: $('#en-ap').value, V: +$('#en-v').value, h: +$('#en-h').value,
      taludHV: +$('#en-tal').value, forma: $('#en-forma').value, turbulencia: $('#en-turb').value,
      s: +$('#en-s').value || 2.65, socavacion: +$('#en-soc').value || 0,
    };
    const out = $('#en-out');
    if (!(o.V > 0) || !(o.h > 0)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Ingresa V y h.</p>'; return; }
    const r = dimensionarEnrocado(o);
    registrar('enrocado', {
      aplicacion: o.aplicacion, V: o.V,
      d50Isbash: r.metodos?.isbash, d50Maynord: r.metodos?.maynord,
      d50Hec23: r.metodos?.hec23pila ?? r.metodos?.hec23estribo,
      d50: r.D50, W50: r.W50_ton * 1000, espesor: r.espesor,
    });
    const metRows = Object.entries(r.metodos).filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `<div><span>${NOM[k] || k}</span><b>${f(v)} m</b></div>`).join('');
    out.innerHTML = `
      <div class="hp-mini" style="margin-top:8px">Roca por método (adopta la envolvente)</div>
      <div class="hp-kv">${metRows}
        ${r.K1 != null ? `<div><span>Factor de talud K1</span><b>${f(r.K1)}</b></div>` : ''}
        ${r.Fr != null ? `<div><span>Froude de aproximación</span><b>${f(r.Fr)}</b></div>` : ''}</div>
      <div class="bp-resalto" style="border-color:var(--accent)">
        <b>D50 adoptado = ${f(r.D50)} m</b> · peso ${f(r.W50_ton)} t
        <div class="hp-kv">
          <div><span>Espesor de capa</span><b>${f(r.espesor)} m (≥1.5·D50 ó D100)</b></div>
          <div><span>Granulometría D15 / D85 / D100</span><b>${f(r.D15)} / ${f(r.D85)} / ${f(r.D100)} m</b></div>
          <div><span>Roca máxima W100</span><b>${f(r.W100_ton)} t</b></div>
          <div><span>Empotramiento del pie</span><b>${r.pieEmpotrado != null ? f(r.pieEmpotrado) + ' m' : '— (ingresa socavación)'}</b></div>
        </div>
      </div>
      ${svgSeccion(r)}
      <p class="hud-note">Isbash y Maynord/HEC-11 para ribera/lecho; HEC-23 para pila/estribo. Se adopta el mayor. Espesor mínimo = máx(1.5·D50, D100). Bajo el enrocado va <b>filtro</b> (geotextil o capa granular). El pie se empotra bajo la socavación de diseño + resguardo (MC 3.708).</p>`;
  });
}

const NOM = { isbash: 'Isbash (USACE)', maynord: 'Maynord / HEC-11', hec23pila: 'HEC-23 pila', hec23estribo: 'HEC-23 estribo' };

// Esquema de la sección de la defensa: talud/lecho con capa de enrocado + empotramiento.
function svgSeccion(r) {
  const W = 440, H = 150, pad = 14;
  const ribera = r.aplicacion === 'ribera';
  const t = Math.max(6, Math.min(30, r.espesor * 12));    // escala visual del espesor
  const pie = r.pieEmpotrado ? Math.max(8, Math.min(40, r.pieEmpotrado * 12)) : 0;
  const gx = pad, gy = H - pad;
  let terreno, capa;
  if (ribera) {
    const dx = 150, dy = 90;
    terreno = `M${gx},${gy - dy} L${gx + dx},${gy} L${W - pad},${gy}`;
    capa = `M${gx + 8},${gy - dy + 6} L${gx + dx + 8},${gy - 2} L${gx + dx + 8},${gy - 2 - pie} L${gx + dx + 8 - t},${gy - 2 - pie} L${gx + 8 - t},${gy - dy + 6} Z`;
  } else {
    const bed = gy - 30;
    terreno = `M${gx},${gy - 60} L${gx + 90},${bed} L${W - pad - 90},${bed} L${W - pad},${gy - 60}`;
    capa = `M${gx + 90},${bed} L${W - pad - 90},${bed} L${W - pad - 90},${bed + t} L${gx + 90},${bed + t} Z`;
  }
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <path d="${terreno}" fill="none" stroke="var(--border2)" stroke-width="1.5"/>
    <path d="${capa}" fill="#94a3b8" opacity="0.55" stroke="#64748b" stroke-width="1"/>
    <text x="${W - pad}" y="14" text-anchor="end" font-size="9" fill="var(--text2)">${ribera ? 'ribera' : 'lecho'} · enrocado D50 ${f(r.D50)} m</text>
    ${pie ? `<text x="${W - pad}" y="26" text-anchor="end" font-size="8" fill="#ef6c5a">pie empotrado ${f(r.pieEmpotrado)} m</text>` : ''}
    </svg>`;
}
