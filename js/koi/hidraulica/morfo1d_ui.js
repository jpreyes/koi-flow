// ─────────────────────────────────────────────────────────────────────────────
// morfo1d_ui.js — HUD de lecho móvil 1D quasi-unsteady (koi-flow). Transita un
// hidrograma por un tramo y muestra la evolución del lecho (erosión/depósito) por
// nodo y en el tiempo. Usa el hidrograma de crecida (convolución) o uno triangular.
// ─────────────────────────────────────────────────────────────────────────────
import { morfo1d, tramoPrismatico } from './morfo1d.js?v=8';
import { hidrogramaTriangular } from '../hidro/embalse.js?v=8';
import { registrar } from '../informe/registro.js?v=8';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));
let _koi = null;

export function abrirMorfoHUD(koi, huds) {
  _koi = koi;
  const hud = huds.open('morfo1d', { title: '⛰️ Lecho móvil 1D (evolución)', w: 500, h: 620 });
  if (hud._mfWired) { hud.focus?.(); return hud; }
  hud.setBody(form());
  wire(hud);
  hud._mfWired = true;
  return hud;
}

function form() {
  return `
    <div class="cfg-grp">Tramo (prismático)</div>
    <div class="cfg-form">
      <label>Largo L [m]<input id="mf-l" type="number" value="2000"></label>
      <label>Nodos<input id="mf-n" type="number" value="11"></label>
      <label>Pendiente S₀ [m/m]<input id="mf-s" type="number" step="0.001" value="0.006"></label>
      <label>Ancho B [m]<input id="mf-b" type="number" value="30"></label>
      <label>Manning n<input id="mf-nm" type="number" step="0.005" value="0.035"></label>
      <label>D50 [mm]<input id="mf-d50" type="number" value="20"></label>
    </div>
    <div class="cfg-grp">Sedimento y evento</div>
    <div class="cfg-form">
      <label>Razón de aporte r<input id="mf-r" type="number" step="0.05" value="0.5"></label>
      <label>Porosidad<input id="mf-p" type="number" step="0.05" value="0.4"></label>
      <label style="grid-column:1/3"><input id="mf-usecrec" type="checkbox"> Usar hidrograma de crecida (convolución)</label>
      <label>Q pico triangular [m³/s]<input id="mf-qp" type="number" value="200"></label>
      <label>t pico / base [h]<input id="mf-tp" type="number" value="3" style="width:38px"> <input id="mf-tb" type="number" value="14" style="width:38px"></label>
    </div>
    <button class="hp-run" id="mf-run" style="margin-top:8px">⛰️ Simular evolución del lecho</button>
    <div id="mf-out"></div>
    <p class="hud-note">r&lt;1 (déficit de aporte, p.ej. aguas abajo de embalse/extracción) ⇒ degrada; r&gt;1 ⇒ agrada. La cota de lecho se actualiza por Exner a lo largo del hidrograma. El descenso se suma a la socavación total.</p>`;
}

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  $('#mf-run').addEventListener('click', () => {
    const nodos = tramoPrismatico({ L: +$('#mf-l').value, N: +$('#mf-n').value, S0: +$('#mf-s').value, B: +$('#mf-b').value, n: +$('#mf-nm').value, z0: 100 });
    let hg;
    if ($('#mf-usecrec').checked && _koi?.hidrogramaCrecida?.length) hg = _koi.hidrogramaCrecida;
    else hg = hidrogramaTriangular(+$('#mf-qp').value || 200, { tpico: (+$('#mf-tp').value || 3) * 3600, tbase: (+$('#mf-tb').value || 14) * 3600 });
    const r = morfo1d(nodos, hg, { D50mm: +$('#mf-d50').value, razonAporte: +$('#mf-r').value, poros: +$('#mf-p').value });
    registrar('morfo1d', { horas: (hg[hg.length - 1]?.t || 0) / 3600, eroMax: r.degradacionMax, depMax: r.agradacionMax });
    const out = $('#mf-out');
    const neta = r.perfil.reduce((a, p) => a + p.dz, 0);
    out.innerHTML = `<div class="hp-kv">
        <div><span>Degradación máxima</span><b style="color:var(--coral)">${f(r.degradacionMax)} m</b></div>
        <div><span>Agradación máxima</span><b style="color:var(--teal)">${f(r.agradacionMax)} m</b></div>
        <div><span>Balance del tramo</span><b>${neta < -1e-3 ? 'degradación neta' : neta > 1e-3 ? 'agradación neta' : 'equilibrio'}</b></div></div>
      <div class="hp-mini" style="margin-top:8px">Perfil del lecho (Δz por estación)</div>
      ${svgPerfil(r.perfil)}
      <div class="hp-mini" style="margin-top:6px">Evolución en el tiempo (nodo central)</div>
      ${svgSerie(r.serie)}
      <p class="hud-note">Δz&lt;0 erosión (coral) · Δz&gt;0 depósito (turquesa). La degradación máxima suele darse en el extremo con déficit; llévala al enrocado como socavación de diseño.</p>`;
  });
}

function svgPerfil(perfil) {
  const W = 460, H = 130, pad = 30;
  const xMax = perfil[perfil.length - 1].x || 1;
  const dzs = perfil.map((p) => p.dz), lim = Math.max(0.01, Math.max(...dzs.map(Math.abs)));
  const X = (x) => pad + (x / xMax) * (W - 2 * pad), Y = (dz) => H / 2 - (dz / lim) * (H / 2 - pad);
  const pts = perfil.map((p) => `${X(p.x).toFixed(1)},${Y(p.dz).toFixed(1)}`).join(' ');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${(H / 2).toFixed(1)}" x2="${W - pad}" y2="${(H / 2).toFixed(1)}" stroke="var(--border2)" stroke-dasharray="3 3"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>
    <text x="${pad}" y="12" font-size="8" fill="var(--text2)">Δz [m] (arriba=depósito, abajo=erosión)</text>
    <text x="${W - pad}" y="${H - 8}" text-anchor="end" font-size="8" fill="var(--text2)">aguas abajo → ${xMax.toFixed(0)} m</text></svg>`;
}

function svgSerie(serie) {
  const W = 460, H = 110, pad = 28;
  if (!serie.length) return '';
  const tMax = serie[serie.length - 1].t || 1, lim = Math.max(0.01, Math.max(...serie.map((p) => Math.abs(p.dz))));
  const X = (t) => pad + (t / tMax) * (W - 2 * pad), Y = (dz) => H - pad - ((dz + lim) / (2 * lim)) * (H - 2 * pad);
  const pts = serie.map((p) => `${X(p.t).toFixed(1)},${Y(p.dz).toFixed(1)}`).join(' ');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${Y(0).toFixed(1)}" x2="${W - pad}" y2="${Y(0).toFixed(1)}" stroke="var(--border2)" stroke-dasharray="3 3"/>
    <polyline points="${pts}" fill="none" stroke="var(--coral)" stroke-width="1.6"/>
    <text x="${pad}" y="12" font-size="8" fill="var(--text2)">Δz lecho (nodo central)</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">${(tMax / 3600).toFixed(1)} h</text></svg>`;
}
