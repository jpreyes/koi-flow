// ─────────────────────────────────────────────────────────────────────────────
// calibracion_ui.js — HUD de calibración del modelo continuo (koi-flow, HMS-lite).
// Optimizador Nelder-Mead in-house que ajusta Cm/Smax/kBase maximizando Nash-Sutcliffe.
// Modo demo (experimento gemelo): genera una serie "observada" desde parámetros
// "verdaderos" + ruido y verifica que la calibración los recupera. Acepta Qobs pegada.
// ─────────────────────────────────────────────────────────────────────────────
import { serieSintetica, simularContinuo } from './continuo.js?v=4';
import { calibrarContinuo } from './calibracion.js?v=4';
import { registrar } from '../informe/registro.js?v=4';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirCalibracionHUD(koi, huds) {
  const hud = huds.open('calibracion', { title: '🎯 Calibración (Nelder-Mead)', w: 520, h: 620 });
  if (hud._caWired) { hud.focus?.(); return hud; }
  hud.setBody(form());
  wire(hud);
  hud._caWired = true;
  return hud;
}

function form() {
  return `
    <div class="cfg-grp">Clima y cuenca</div>
    <div class="cfg-form">
      <label>Precip. anual [mm]<input id="ca-p" type="number" value="1800"></label>
      <label>Temp. media [°C]<input id="ca-tm" type="number" value="4"></label>
      <label>Amplitud térmica [°C]<input id="ca-at" type="number" value="9"></label>
      <label>Área [km²]<input id="ca-a" type="number" value="300"></label>
    </div>
    <div class="cfg-grp">Serie observada</div>
    <div class="cfg-form">
      <label style="grid-column:1/3">Q observado [m³/s], separado por coma/espacio (vacío = demo gemelo)
        <textarea id="ca-obs" rows="2" style="width:100%" placeholder="vacío → genera observada sintética con los parámetros verdaderos de abajo"></textarea></label>
    </div>
    <div class="cfg-grp">Parámetros "verdaderos" (solo modo demo) + ruido</div>
    <div class="cfg-form">
      <label>Cm verdadero<input id="ca-cm" type="number" step="0.5" value="5"></label>
      <label>Smax verdadero<input id="ca-sm" type="number" value="120"></label>
      <label>kBase verdadero<input id="ca-kb" type="number" step="0.01" value="0.04"></label>
      <label>Ruido [%]<input id="ca-noise" type="number" value="3"></label>
    </div>
    <button class="hp-run" id="ca-run" style="margin-top:8px">🎯 Calibrar (Nelder-Mead)</button>
    <div id="ca-out"></div>
    <p class="hud-note">Ajusta Cm (grado-día), Smax (capacidad de suelo) y kBase (recesión) maximizando Nash-Sutcliffe. En modo demo genera la observada con los parámetros verdaderos y verifica que los recupera. Calibración real requiere serie de caudales observada del mismo año.</p>`;
}

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  $('#ca-run').addEventListener('click', () => {
    const serie = serieSintetica({ Panual: +$('#ca-p').value, Tmedia: +$('#ca-tm').value, amplitudT: +$('#ca-at').value });
    const area = +$('#ca-a').value;
    const raw = $('#ca-obs').value.trim();
    let Qobs, truth = null;
    if (raw) {
      Qobs = raw.split(/[\s,;]+/).map(Number).filter((x) => isFinite(x));
    } else {
      truth = { area, Cm: +$('#ca-cm').value, Smax: +$('#ca-sm').value, kBase: +$('#ca-kb').value };
      const noise = (+$('#ca-noise').value || 0) / 100;
      Qobs = simularContinuo(serie, truth).serie.map((d) => d.Q * (1 + noise * Math.sin(d.dia * 1.7)));
    }
    const out = $('#ca-out');
    if (Qobs.length < 30) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Serie observada insuficiente (mín 30 valores).</p>'; return; }
    const cal = calibrarContinuo(serie, Qobs, { base: { area }, claves: ['Cm', 'Smax', 'kBase'] });
    registrar('calibracion', { nse0: cal.nse0 ?? null, nse: cal.nse, iter: cal.iteraciones ?? cal.iter ?? null, params: cal.params });
    const cmp = (lbl, got, tru) => `<div><span>${lbl}</span><b>${f(got)}${tru != null ? ` <span style="color:var(--text2)">(real ${f(tru)})</span>` : ''}</b></div>`;
    out.innerHTML = `<div class="hp-kv">
        <div><span>Nash-Sutcliffe (NSE)</span><b style="color:${cal.nse > 0.7 ? 'var(--teal)' : 'var(--coral)'}">${f(cal.nse, 4)}</b></div>
        <div><span>RMSE</span><b>${f(cal.rmse)} m³/s</b></div>
        ${cmp('Cm (grado-día)', cal.params.Cm, truth?.Cm)}
        ${cmp('Smax (mm)', cal.params.Smax, truth?.Smax)}
        ${cmp('kBase', cal.params.kBase, truth?.kBase)}</div>
      <div class="hp-mini" style="margin-top:8px">Observado (coral) vs calibrado (azul)</div>
      ${svg(Qobs, cal.sim)}
      <p class="hud-note">NSE&gt;0.7 buen ajuste · &gt;0.5 aceptable. ${truth ? 'Modo demo: los parámetros calibrados deberían coincidir con los "reales".' : ''}</p>`;
  });
}

function svg(obs, sim) {
  const W = 500, H = 160, pad = 28;
  const n = Math.min(obs.length, sim.length), tMax = n - 1;
  const qMax = Math.max(...obs.slice(0, n), ...sim.slice(0, n)) || 1;
  const X = (i) => pad + (i / tMax) * (W - 2 * pad), Y = (q) => H - pad - (q / qMax) * (H - 2 * pad);
  const line = (arr, color) => `<polyline points="${arr.slice(0, n).map((q, i) => `${X(i).toFixed(1)},${Y(q).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.4"/>`;
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    ${line(obs, '#ef6c5a')}${line(sim, '#2563eb')}
    <text x="${pad}" y="12" font-size="8" fill="#ef6c5a">— observado</text>
    <text x="${pad + 70}" y="12" font-size="8" fill="#2563eb">— calibrado</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">día →</text></svg>`;
}
