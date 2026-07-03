// ─────────────────────────────────────────────────────────────────────────────
// modclark_ui.js — HUD de transformada Clark / ModClark grillado (koi-flow, HMS-lite).
// Tc + R + tormenta + sesgo espacial de lluvia → hidrograma por traslación tiempo-área
// y ruteo por reservorio lineal. El sesgo mueve el pico (lluvia cerca/lejos del cierre).
// ─────────────────────────────────────────────────────────────────────────────
import { hidrogramaModClark } from './modclark.js?v=3';
import { registrar } from '../informe/registro.js?v=3';

const f = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirModClarkHUD(koi, huds) {
  const hud = huds.open('modclark', { title: '🗺️ ModClark grillado (HMS-lite)', w: 500, h: 580 });
  if (hud._mcWired) { hud.focus?.(); return hud; }
  hud.setBody(form());
  wire(hud);
  hud._mcWired = true;
  return hud;
}

function form() {
  return `
    <div class="cfg-grp">Cuenca y transformada de Clark</div>
    <div class="cfg-form">
      <label>Área [km²]<input id="mc-a" type="number" value="300"></label>
      <label>Tc [h]<input id="mc-tc" type="number" step="0.5" value="6"></label>
      <label>Coef. almacenamiento R [h]<input id="mc-r" type="number" step="0.5" value="4"></label>
      <label>Δt [s]<input id="mc-dt" type="number" value="600"></label>
    </div>
    <div class="cfg-grp">Tormenta y lluvia grillada</div>
    <div class="cfg-form">
      <label>Lluvia P [mm]<input id="mc-p" type="number" value="80"></label>
      <label>Duración [h]<input id="mc-dur" type="number" value="24"></label>
      <label>CN<input id="mc-cn" type="number" value="75"></label>
      <label>Sesgo lluvia (−1 lejos … +1 cerca)<input id="mc-g" type="number" step="0.2" min="-1" max="1" value="0"></label>
    </div>
    <button class="hp-run" id="mc-run" style="margin-top:8px">🗺️ Calcular (ModClark)</button>
    <div id="mc-out"></div>
    <p class="hud-note">Traslación por histograma tiempo-área (isócronas) + reservorio lineal (R). El sesgo simula lluvia distribuida: +1 concentra la lluvia cerca del punto de cierre (pico más temprano), −1 aguas arriba (pico más tardío). Grilla real: futura desde el DEM delineado.</p>`;
}

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  $('#mc-run').addEventListener('click', () => {
    const base = { Tc: +$('#mc-tc').value, R: +$('#mc-r').value, area: +$('#mc-a').value, dt: +$('#mc-dt').value || 600 };
    const r = hidrogramaModClark(base, { Ptotal: +$('#mc-p').value, durH: +$('#mc-dur').value, CN: +$('#mc-cn').value, sesgo: +$('#mc-g').value });
    let iPk = 0; r.out.forEach((p, i) => { if (p.Q > r.out[iPk].Q) iPk = i; });
    registrar('modclark', { Tc: base.Tc, R: base.R, Nb: r.Nb, Qpico: r.Qpico, tPicoH: r.out[iPk].t / 3600 });
    const out = $('#mc-out');
    out.innerHTML = `<div class="hp-kv">
        <div><span>Caudal pico</span><b>${f(r.Qpico)} m³/s</b></div>
        <div><span>Tiempo al pico</span><b>${f(r.out[iPk].t / 3600, 1)} h</b></div>
        <div><span>Bandas tiempo-área · lluvia efectiva</span><b>${r.Nb} · ${f(r.PeTotal)} mm</b></div></div>
      ${svg(r.out)}
      <p class="hud-note">Cambia el sesgo y recalcula: verás moverse el pico (cerca→antes, lejos→después) — el efecto de la lluvia distribuida sobre la forma del hidrograma.</p>`;
  });
}

function svg(o) {
  const W = 480, H = 160, pad = 28;
  const tMax = o[o.length - 1].t || 1, qMax = Math.max(...o.map((p) => p.Q)) || 1;
  const X = (t) => pad + (t / tMax) * (W - 2 * pad), Y = (q) => H - pad - (q / qMax) * (H - 2 * pad);
  const pts = o.map((p) => `${X(p.t).toFixed(1)},${Y(p.Q).toFixed(1)}`).join(' ');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>
    <text x="${pad + 2}" y="${pad - 6}" font-size="8" fill="var(--text2)">Q [m³/s] · pico ${qMax.toFixed(0)}</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">${(tMax / 3600).toFixed(1)} h</text></svg>`;
}
