// ─────────────────────────────────────────────────────────────────────────────
// continuo_ui.js — HUD de simulación continua + deshielo (koi-flow, HMS-lite).
// Genera un año diario sintético (P estacional + T sinusoidal) y corre el balance de
// humedad con deshielo por grado-día → hidrograma continuo, manto nival y estadísticos.
// ─────────────────────────────────────────────────────────────────────────────
import { serieSintetica, simularContinuo } from './continuo.js?v=5';
import { registrar } from '../informe/registro.js?v=5';

const f = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirContinuoHUD(koi, huds) {
  const hud = huds.open('continuo', { title: '❄️ Continua + deshielo (HMS-lite)', w: 520, h: 640 });
  if (hud._coWired) { hud.focus?.(); return hud; }
  hud.setBody(form());
  wire(hud);
  hud._coWired = true;
  return hud;
}

function form() {
  return `
    <div class="cfg-grp">Clima del año (sintético)</div>
    <div class="cfg-form">
      <label>Precip. anual [mm]<input id="co-p" type="number" value="1800"></label>
      <label>Temp. media [°C]<input id="co-tm" type="number" value="4"></label>
      <label>Amplitud térmica [°C]<input id="co-at" type="number" value="9"></label>
      <label>Área cuenca [km²]<input id="co-a" type="number" value="300"></label>
    </div>
    <div class="cfg-grp">Nieve y suelo</div>
    <div class="cfg-form">
      <label>T umbral nieve/fusión [°C]<input id="co-tb" type="number" step="0.5" value="0"></label>
      <label>Grado-día Cm [mm/°C/d]<input id="co-cm" type="number" step="0.5" value="4"></label>
      <label>Capac. suelo Smax [mm]<input id="co-sm" type="number" value="100"></label>
      <label>Recesión base k<input id="co-kb" type="number" step="0.01" value="0.03"></label>
    </div>
    <button class="hp-run" id="co-run" style="margin-top:8px">❄️ Simular año</button>
    <div id="co-out"></div>
    <p class="hud-note">Deshielo por índice de temperatura (grado-día). En cuencas nivo-pluviales el pico de caudal se corre a primavera-verano por fusión del manto. Modelo continuo de balance diario; para régimen permanente correr con spin-up multianual.</p>`;
}

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  $('#co-run').addEventListener('click', () => {
    const serie = serieSintetica({ Panual: +$('#co-p').value, Tmedia: +$('#co-tm').value, amplitudT: +$('#co-at').value });
    const r = simularContinuo(serie, { area: +$('#co-a').value, Tb: +$('#co-tb').value, Cm: +$('#co-cm').value, Smax: +$('#co-sm').value, kBase: +$('#co-kb').value });
    registrar('continuo', { nDias: r.serie.length, Qmedio: r.Qmedia, Qmax: r.Qmax, sweMax: r.sweMax, fracNival: r.fraccionNival });
    const out = $('#co-out');
    out.innerHTML = `<div class="hp-kv">
        <div><span>Caudal medio / máx / mín</span><b>${f(r.Qmedia)} / ${f(r.Qmax)} / ${f(r.Qmin, 2)} m³/s</b></div>
        <div><span>Manto nival máximo (SWE)</span><b>${f(r.sweMax)} mm</b></div>
        <div><span>Fusión total · fracción nival</span><b>${f(r.volFusion_mm, 0)} mm · ${(r.fraccionNival * 100).toFixed(0)} %</b></div></div>
      <div class="hp-mini" style="margin-top:8px">Caudal (azul) y manto nival SWE (celeste)</div>
      ${svg(r.serie)}
      <p class="hud-note">El caudal (azul) crece cuando el manto (celeste) se funde: pico nival en la estación cálida, no en la de lluvia.</p>`;
  });
}

function svg(serie) {
  const W = 500, H = 170, pad = 30;
  const n = serie.length, tMax = n - 1;
  const qMax = Math.max(...serie.map((d) => d.Q)) || 1, sMax = Math.max(...serie.map((d) => d.SWE)) || 1;
  const X = (i) => pad + (i / tMax) * (W - 2 * pad);
  const Yq = (q) => H - pad - (q / qMax) * (H - 2 * pad);
  const Ys = (s) => H - pad - (s / sMax) * (H - 2 * pad);
  const lineQ = serie.map((d, i) => `${X(i).toFixed(1)},${Yq(d.Q).toFixed(1)}`).join(' ');
  const lineS = serie.map((d, i) => `${X(i).toFixed(1)},${Ys(d.SWE).toFixed(1)}`).join(' ');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    <polyline points="${lineS}" fill="none" stroke="#7dd3fc" stroke-width="1.4"/>
    <polyline points="${lineQ}" fill="none" stroke="#2563eb" stroke-width="1.6"/>
    <text x="${pad}" y="12" font-size="8" fill="#2563eb">Q pico ${qMax.toFixed(0)} m³/s</text>
    <text x="${pad + 90}" y="12" font-size="8" fill="#38bdf8">SWE máx ${sMax.toFixed(0)} mm</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">día del año →</text></svg>`;
}
