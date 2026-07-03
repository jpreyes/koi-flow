// ─────────────────────────────────────────────────────────────────────────────
// convolucion_ui.js — HUD de hidrograma de crecida por convolución (koi-flow).
// Morfometría (de la cuenca delineada) + lluvia total + CN → hidrograma completo por
// convolución del HU Linsley. Deja el hidrograma en koi.hidrogramaCrecida para que el
// tránsito en cauce y el embalse lo usen en vez del triangular.
// ─────────────────────────────────────────────────────────────────────────────
import { hidrogramaTormenta } from './convolucion.js?v=6';
import { registrar } from '../informe/registro.js?v=6';
import { fijarCrecida } from '../ui/seleccion.js?v=6';

const f = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirConvolucionHUD(koi, huds) {
  const hud = huds.open('convolucion', { title: '📈 Hidrograma de crecida (HU)', w: 470, h: 590 });
  if (hud._cvWired) { hud.focus?.(); return hud; }
  hud.setBody(form(koi));
  wire(hud, koi);
  hud._cvWired = true;
  return hud;
}

function morfoActiva(koi) {
  const m = koi.hydro?._punto?.cuenca?.morfometria;
  if (!m) return null;
  return { A: m.A, L: m.L, Lg: m.Lg || (m.L ? 0.6 * m.L : null), S: m.S };
}

function form(koi) {
  const m = morfoActiva(koi) || {};
  return `
    <div class="cfg-grp">Morfometría de la cuenca ${m.A ? '(autocompletada)' : ''}</div>
    <div class="cfg-form">
      <label>Área A [km²]<input id="cv-a" type="number" step="1" value="${m.A ?? 300}"></label>
      <label>Long. cauce L [km]<input id="cv-l" type="number" step="0.5" value="${m.L ?? 40}"></label>
      <label>L al centroide Lg [km]<input id="cv-lg" type="number" step="0.5" value="${m.Lg ? m.Lg.toFixed(1) : 24}"></label>
      <label>Pendiente S [m/m]<input id="cv-s" type="number" step="0.001" value="${m.S ?? 0.02}"></label>
      <label>Zona (Arteaga-Benítez)<select id="cv-z">
        <option value="1">1 · III a VI</option>
        <option value="2">2 · VII</option>
        <option value="3" selected>3 · VIII a X (sur)</option></select></label>
    </div>
    <div class="cfg-grp">Tormenta de diseño</div>
    <div class="cfg-form">
      <label>Lluvia total P [mm]<input id="cv-p" type="number" step="1" value="80"></label>
      <label>Duración [h]<input id="cv-dur" type="number" step="1" value="24"></label>
      <label>Curva número CN<input id="cv-cn" type="number" step="1" value="75"></label>
      <label>Flujo base [m³/s]<input id="cv-qb" type="number" value="0"></label>
      <label style="grid-column:1/3">Distribución temporal<select id="cv-pat">
        <option value="alterno">Bloques alternos (pico central)</option>
        <option value="triangular">Triangular</option>
        <option value="uniforme">Uniforme</option></select></label>
    </div>
    <button class="hp-run" id="cv-run" style="margin-top:8px">📈 Calcular hidrograma</button>
    <div id="cv-out"></div>`;
}

function wire(hud, koi) {
  const $ = (s) => hud.body.querySelector(s);
  $('#cv-run').addEventListener('click', () => {
    const morfo = { A: +$('#cv-a').value, L: +$('#cv-l').value, Lg: +$('#cv-lg').value, S: +$('#cv-s').value };
    const out = $('#cv-out');
    if (!(morfo.A > 0) || !(morfo.L > 0) || !(morfo.S > 0)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Ingresa A, L y S.</p>'; return; }
    const r = hidrogramaTormenta(morfo, {
      Ptotal: +$('#cv-p').value, durH: +$('#cv-dur').value, CN: +$('#cv-cn').value,
      zona: +$('#cv-z').value, patron: $('#cv-pat').value, baseflow: +$('#cv-qb').value || 0,
    });
    fijarCrecida(koi, { hidrograma: r.out, reologia: null, fuente: 'convolucion' });   // se guarda en la cuenca activa
    let iPk = 0; r.out.forEach((p, ii) => { if (p.Q > r.out[iPk].Q) iPk = ii; });
    registrar('convolucion', { Ptotal: +$('#cv-p').value, durH: +$('#cv-dur').value, CN: +$('#cv-cn').value, PeTotal: r.PeTotal, Qpico: r.Qpico, tPicoH: r.out[iPk].t / 3600, volMm3: r.volumen / 1e6 });
    out.innerHTML = `<div class="hp-kv">
        <div><span>Caudal pico</span><b>${f(r.Qpico)} m³/s</b></div>
        <div><span>Lluvia efectiva total</span><b>${f(r.PeTotal)} mm</b></div>
        <div><span>Volumen escorrentía</span><b>${f(r.volumen / 1e6, 2)} Mm³</b></div>
        <div><span>tp · paso Δt</span><b>${f(r.tp, 1)} h · ${f(r.tu, 2)} h</b></div></div>
      ${svgHidro(r.out)}
      <p class="hud-note">Convolución del HU Linsley (volumen unitario, masa conservada) con el hietograma de diseño. <b>Guardado</b> como hidrograma de crecida: el tránsito en cauce y el embalse lo ofrecen como entrada.</p>`;
  });
}

function svgHidro(o) {
  const W = 410, H = 150, pad = 28;
  const tMax = o[o.length - 1].t || 1, qMax = Math.max(...o.map((p) => p.Q)) || 1;
  const X = (t) => pad + (t / tMax) * (W - 2 * pad), Y = (q) => H - pad - (q / qMax) * (H - 2 * pad);
  const pts = o.map((p) => `${X(p.t).toFixed(1)},${Y(p.Q).toFixed(1)}`).join(' ');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">${(tMax / 3600).toFixed(1)} h</text>
    <text x="${pad + 2}" y="${pad - 6}" font-size="8" fill="var(--text2)">Q [m³/s] · pico ${qMax.toFixed(0)}</text></svg>`;
}
