// ─────────────────────────────────────────────────────────────────────────────
// routing_ui.js — HUD de tránsito de crecida en cauce (koi-flow). Muskingum (K,x) o
// Muskingum-Cunge (desde geometría del tramo). Entra un hidrograma triangular y sale
// el hidrograma laminado con atenuación y desfase. Complementa el ruteo en embalse.
// ─────────────────────────────────────────────────────────────────────────────
import { muskingum, muskingumCunge } from './routing.js?v=13';
import { hidrogramaTriangular } from './embalse.js?v=13';
import { registrar } from '../informe/registro.js?v=13';

let _koi = null;

const f = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirRoutingHUD(koi, huds) {
  _koi = koi;
  const hud = huds.open('routing', { title: '🌊 Tránsito en cauce (Muskingum)', w: 460, h: 560 });
  if (hud._rtWired) { hud.focus?.(); return hud; }
  hud.setBody(form());
  wire(hud);
  hud._rtWired = true;
  return hud;
}

function form() {
  return `
    <div class="cfg-grp">Hidrograma de entrada (triangular)</div>
    <div class="cfg-form">
      <label>Q pico [m³/s]<input id="rt-qp" type="number" value="120"></label>
      <label>t al pico [h]<input id="rt-tp" type="number" step="0.5" value="2"></label>
      <label>t base [h]<input id="rt-tb" type="number" step="0.5" value="8"></label>
      <label>Δt [s]<input id="rt-dt" type="number" value="600"></label>
      <label>Flujo base [m³/s]<input id="rt-qb" type="number" value="0"></label>
      <label style="grid-column:1/3"><input id="rt-usecrec" type="checkbox"> Usar hidrograma de crecida (convolución) en vez del triangular</label>
    </div>
    <div class="cfg-grp">Método de tránsito</div>
    <div class="cfg-form">
      <label style="grid-column:1/3">Método<select id="rt-metodo">
        <option value="cunge">Muskingum-Cunge (desde geometría)</option>
        <option value="musk">Muskingum (K, x directos)</option></select></label>
    </div>
    <div class="cfg-form" id="rt-cunge">
      <label>Largo tramo L [m]<input id="rt-l" type="number" value="8000"></label>
      <label>Pendiente So [m/m]<input id="rt-so" type="number" step="0.001" value="0.003"></label>
      <label>Ancho B [m]<input id="rt-b" type="number" value="30"></label>
      <label>Manning n<input id="rt-n" type="number" step="0.005" value="0.040"></label>
    </div>
    <div class="cfg-form" id="rt-musk" style="display:none">
      <label>K [h]<input id="rt-k" type="number" step="0.5" value="2"></label>
      <label>x (0–0.5)<input id="rt-x" type="number" step="0.05" value="0.2"></label>
    </div>
    <button class="hp-run" id="rt-run" style="margin-top:8px">🌊 Transitar crecida</button>
    <div id="rt-out"></div>`;
}

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  $('#rt-metodo').addEventListener('change', () => {
    const c = $('#rt-metodo').value === 'cunge';
    $('#rt-cunge').style.display = c ? '' : 'none';
    $('#rt-musk').style.display = c ? 'none' : '';
  });
  $('#rt-run').addEventListener('click', () => {
    let dt = +$('#rt-dt').value || 600, qb = +$('#rt-qb').value || 0;
    const out = $('#rt-out');
    const usarCrec = $('#rt-usecrec').checked && _koi?.hidrogramaCrecida?.length;
    let inflow;
    if (usarCrec) {
      inflow = remuestrear(_koi.hidrogramaCrecida, dt);   // a Δt fino (estabilidad Muskingum)
    } else {
      inflow = hidrogramaTriangular(+$('#rt-qp').value || 120, { tpico: (+$('#rt-tp').value || 2) * 3600, tbase: (+$('#rt-tb').value || 8) * 3600 });
    }
    let r;
    if ($('#rt-metodo').value === 'cunge') {
      r = muskingumCunge(inflow, { L: +$('#rt-l').value, So: +$('#rt-so').value, n: +$('#rt-n').value, B: +$('#rt-b').value, dt });
      if (!(r.QoutPico > 0)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Revisa la geometría del tramo (So, B, n).</p>'; return; }
    } else {
      r = muskingum(inflow, { K: (+$('#rt-k').value || 2) * 3600, x: +$('#rt-x').value, dt });
    }
    if (qb) r.out = r.out.map((p) => ({ ...p, I: p.I + qb, O: p.O + qb }));
    registrar('routing', {
      metodo: $('#rt-metodo').value === 'cunge' ? 'Muskingum-Cunge' : 'Muskingum',
      K: r.K, x: r.x, QpicoIn: r.IinPico + qb, QpicoOut: r.QoutPico + qb,
      atenPct: r.atenuacion * 100, desfaseH: r.desfaseHoras,
    });
    const extra = $('#rt-metodo').value === 'cunge'
      ? `<div><span>K · x (derivados)</span><b>${f(r.K / 3600, 2)} h · ${f(r.x, 3)}</b></div>
         <div><span>Celeridad · tirante</span><b>${f(r.c, 2)} m/s · ${f(r.y, 2)} m</b></div>`
      : `<div><span>Coef. C0 / C1 / C2</span><b>${f(r.C0, 3)} / ${f(r.C1, 3)} / ${f(r.C2, 3)}</b></div>`;
    out.innerHTML = `<div class="hp-kv">
        <div><span>Q entrada (pico)</span><b>${f(r.IinPico + qb)} m³/s</b></div>
        <div><span>Q salida (pico)</span><b>${f(r.QoutPico + qb)} m³/s</b></div>
        <div><span>Atenuación del pico</span><b>${(r.atenuacion * 100).toFixed(0)} %</b></div>
        <div><span>Desfase del pico</span><b>${f(r.desfaseHoras, 2)} h</b></div>
        ${extra}</div>
      ${svgHidro(r.out)}
      <p class="hud-note">Tránsito hidrológico en cauce. La curva coral es la salida laminada. Muskingum-Cunge deriva K y x de la geometría (sin calibrar); Muskingum usa K y x directos. Requiere 2Kx ≤ Δt ≤ 2K(1−x) para estabilidad.</p>`;
  });
}

// Remuestrea un hidrograma [{t,Q}] a paso uniforme dt (interpolación lineal).
function remuestrear(hg, dt) {
  const tMax = hg[hg.length - 1].t, n = Math.max(2, Math.round(tMax / dt));
  const interp = (t) => {
    if (t <= hg[0].t) return hg[0].Q;
    if (t >= tMax) return hg[hg.length - 1].Q;
    for (let i = 1; i < hg.length; i++) if (t <= hg[i].t) { const a = hg[i - 1], b = hg[i], r = (t - a.t) / ((b.t - a.t) || 1); return a.Q + r * (b.Q - a.Q); }
    return hg[hg.length - 1].Q;
  };
  return Array.from({ length: n + 1 }, (_, i) => ({ t: i * dt, Q: interp(i * dt) }));
}

function svgHidro(o) {
  const W = 400, H = 150, pad = 26;
  const tMax = o[o.length - 1].t || 1, qMax = Math.max(...o.map((p) => Math.max(p.I, p.O))) || 1;
  const X = (t) => pad + (t / tMax) * (W - 2 * pad), Y = (q) => H - pad - (q / qMax) * (H - 2 * pad);
  const line = (key, color) => `<polyline points="${o.map((p) => `${X(p.t).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"/>`;
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    ${line('I', '#2563eb')}${line('O', '#ef6c5a')}
    <text x="${pad}" y="12" font-size="9" fill="#2563eb">— entrada</text>
    <text x="${pad + 70}" y="12" font-size="9" fill="#ef6c5a">— salida (transitada)</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">${(tMax / 3600).toFixed(1)} h</text></svg>`;
}
