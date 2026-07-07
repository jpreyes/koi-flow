// ─────────────────────────────────────────────────────────────────────────────
// red_ui.js — HUD de red de cuencas (koi-flow, HMS-lite). Define subcuencas, tramos y
// uniones con su topología (aguas abajo), aplica una tormenta de diseño común y
// entrega el hidrograma en el punto de cierre + picos por nodo.
// ─────────────────────────────────────────────────────────────────────────────
import { simularRed } from './red.js?v=13';
import { registrar } from '../informe/registro.js?v=13';

const f = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

// red de ejemplo (editable)
const DEMO = () => ([
  { id: 'S1', tipo: 'subcuenca', aguasAbajo: 'T1', A: 150, L: 25, Lg: 15, S: 0.02 },
  { id: 'S2', tipo: 'subcuenca', aguasAbajo: 'T1', A: 200, L: 30, Lg: 18, S: 0.015 },
  { id: 'T1', tipo: 'tramo', aguasAbajo: 'U1', L: 12000, So: 0.004, B: 40 },
  { id: 'S3', tipo: 'subcuenca', aguasAbajo: 'U1', A: 100, L: 18, Lg: 10, S: 0.03 },
  { id: 'U1', tipo: 'union', aguasAbajo: 'OUT' },
  { id: 'OUT', tipo: 'salida', aguasAbajo: '' },
]);

export function abrirRedHUD(koi, huds) {
  const hud = huds.open('red', { title: '🕸️ Red de cuencas (HMS-lite)', w: 560, h: 640 });
  if (hud._redWired) { hud.focus?.(); return hud; }
  hud._red = { els: DEMO() };
  hud.setBody(shell());
  render(hud);
  wire(hud);
  hud._redWired = true;
  return hud;
}

function shell() {
  return `
    <div class="cfg-grp">Tormenta de diseño (común a las subcuencas)</div>
    <div class="cfg-form">
      <label>Lluvia P [mm]<input id="rd-p" type="number" value="80"></label>
      <label>Duración [h]<input id="rd-dur" type="number" value="24"></label>
      <label>CN<input id="rd-cn" type="number" value="75"></label>
      <label>Zona<select id="rd-z"><option value="1">1·III-VI</option><option value="2">2·VII</option><option value="3" selected>3·VIII-X</option></select></label>
    </div>
    <div class="cfg-grp">Elementos de la red <button class="bp-b" id="rd-add" style="float:right">+ elemento</button></div>
    <div id="rd-els"></div>
    <button class="hp-run" id="rd-run" style="margin-top:8px">🕸️ Simular red</button>
    <div id="rd-out"></div>
    <p class="hud-note">Cada elemento apunta a su aguas abajo. subcuenca = fuente (HU) · tramo = tránsito Muskingum-Cunge · unión = confluencia · salida = punto de cierre. Editable.</p>`;
}

function nodosDestino(els, self) {
  return els.filter((e) => e.id !== self).map((e) => e.id);
}

function render(hud) {
  const cont = hud.body.querySelector('#rd-els');
  const els = hud._red.els;
  cont.innerHTML = els.map((e, i) => {
    const dests = ['', ...nodosDestino(els, e.id)];
    const destSel = `<select data-f="aguasAbajo" data-i="${i}" style="width:64px">${dests.map((d) => `<option value="${d}"${d === e.aguasAbajo ? ' selected' : ''}>${d || '(cierre)'}</option>`).join('')}</select>`;
    let params = '';
    if (e.tipo === 'subcuenca') params = `A${inp(i, 'A', e.A, 46)} L${inp(i, 'L', e.L, 40)} Lg${inp(i, 'Lg', e.Lg, 40)} S${inp(i, 'S', e.S, 52)}`;
    else if (e.tipo === 'tramo') params = `L${inp(i, 'L', e.L, 56)} So${inp(i, 'So', e.So, 52)} B${inp(i, 'B', e.B, 40)}`;
    return `<div class="rd-row" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:3px;font-size:11px">
      <input data-f="id" data-i="${i}" value="${e.id}" style="width:46px">
      <select data-f="tipo" data-i="${i}" style="width:82px">
        ${['subcuenca', 'tramo', 'union', 'salida'].map((t) => `<option value="${t}"${t === e.tipo ? ' selected' : ''}>${t}</option>`).join('')}</select>
      →${destSel} ${params}
      <button class="bp-b" data-del="${i}" title="borrar">✕</button></div>`;
  }).join('');
}

const inp = (i, f, v, w) => `<input data-f="${f}" data-i="${i}" value="${v ?? ''}" style="width:${w}px">`;

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  const els = hud._red.els;
  $('#rd-els').addEventListener('input', (ev) => {
    const t = ev.target, i = +t.dataset.i, fld = t.dataset.f;
    if (i == null || !fld) return;
    els[i][fld] = (fld === 'id' || fld === 'tipo' || fld === 'aguasAbajo') ? t.value : parseFloat(t.value);
  });
  $('#rd-els').addEventListener('change', (ev) => {
    if (ev.target.dataset.f === 'tipo') render(hud);   // cambia los params visibles
  });
  $('#rd-els').addEventListener('click', (ev) => {
    const del = ev.target.dataset.del;
    if (del != null) { els.splice(+del, 1); render(hud); }
  });
  $('#rd-add').addEventListener('click', () => { els.push({ id: 'N' + (els.length + 1), tipo: 'subcuenca', aguasAbajo: '', A: 100, L: 15, Lg: 9, S: 0.02 }); render(hud); });
  $('#rd-run').addEventListener('click', () => run(hud));
}

function run(hud) {
  const $ = (s) => hud.body.querySelector(s);
  const P = +$('#rd-p').value, durH = +$('#rd-dur').value, CN = +$('#rd-cn').value, zona = +$('#rd-z').value;
  const els = hud._red.els.map((e) => e.tipo === 'subcuenca'
    ? { ...e, morfo: { A: e.A, L: e.L, Lg: e.Lg, S: e.S }, Ptotal: P, durH, CN, zona, patron: 'alterno' }
    : (e.tipo === 'tramo' ? { ...e, metodo: 'cunge', n: 0.04 } : { ...e }));
  const out = $('#rd-out');
  try {
    const r = simularRed(els, { dt: 600 });
    { let iPk = 0; r.out.forEach((p, ii) => { if (p.Q > r.out[iPk].Q) iPk = ii; });
      registrar('red', { nElementos: els.length, Qpico: r.Qpico, tPicoH: r.out[iPk].t / 3600 }); }
    const picos = Object.entries(r.picos).map(([k, v]) => `<tr><td>${k}</td><td>${f(v)}</td></tr>`).join('');
    out.innerHTML = `<div class="hp-kv"><div><span>Punto de cierre</span><b>${r.salida}</b></div>
        <div><span>Caudal pico en el cierre</span><b>${f(r.Qpico)} m³/s</b></div></div>
      ${svgHidro(r.out)}
      <table class="hp-tbl"><thead><tr><th>Nodo</th><th>Q pico [m³/s]</th></tr></thead><tbody>${picos}</tbody></table>`;
  } catch (e) { out.innerHTML = `<p class="hud-note" style="color:var(--red)">${e.message}</p>`; }
}

function svgHidro(o) {
  const W = 500, H = 150, pad = 28;
  const tMax = o[o.length - 1].t || 1, qMax = Math.max(...o.map((p) => p.Q)) || 1;
  const X = (t) => pad + (t / tMax) * (W - 2 * pad), Y = (q) => H - pad - (q / qMax) * (H - 2 * pad);
  const pts = o.map((p) => `${X(p.t).toFixed(1)},${Y(p.Q).toFixed(1)}`).join(' ');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">${(tMax / 3600).toFixed(1)} h</text>
    <text x="${pad + 2}" y="${pad - 6}" font-size="8" fill="var(--text2)">hidrograma en el cierre · pico ${qMax.toFixed(0)} m³/s</text></svg>`;
}
