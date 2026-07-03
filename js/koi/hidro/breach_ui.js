// ─────────────────────────────────────────────────────────────────────────────
// breach_ui.js — HUD de rotura de presa / depósito de relaves (koi-flow).
// Volumen + altura de brecha + modo de falla → parámetros de brecha (Froehlich),
// Qp (Froehlich vs MacDonald-L-M) e hidrograma de rotura conservando el volumen.
// El hidrograma queda en koi.hidrogramaCrecida y, si es RELAVE, la reología de la
// mezcla queda en koi.reologia → el 2D de momentum los toma con el check "crecida".
// ─────────────────────────────────────────────────────────────────────────────
import { hidrogramaRotura } from './breach.js?v=3';
import { registrar } from '../informe/registro.js?v=3';
import { fijarCrecida, getActivo } from '../ui/seleccion.js?v=3';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d)));

// Presa activa (si el objeto seleccionado es una presa/depósito) → Vw y altura del vaso.
function presaActiva(koi) {
  const a = getActivo();
  return a?.tipo === 'presa' ? (koi.presas || []).find((p) => p.id === a.id) || null : null;
}

export function abrirBreachHUD(koi, huds) {
  const hud = huds.open('breach', { title: '💥 Rotura de presa / relaves (Froehlich)', w: 480, h: 640 });
  if (hud._brWired) { hud.focus?.(); return hud; }
  hud.setBody(form(koi));
  wire(hud, koi);
  hud._brWired = true;
  return hud;
}

function form(koi) {
  const pr = presaActiva(koi);
  const vw = pr ? Math.round(pr.volumen) : 500000;
  const hb = pr ? (pr.altura || 15) : 15;
  return `
    ${pr ? `<div class="ins-desfase">Usando el vaso de <b>${pr.nombre}</b> (del DEM): <b>${(pr.volumen / 1e6).toFixed(2)} Mm³</b> · muro ${pr.altura} m. La onda entrará al 2D en la posición de la presa.</div>` : '<p class="hud-note">Colocá una <b>presa/depósito</b> (menú Riesgo) y selecciónala para sacar Vw y la altura del vaso desde el DEM; si no, ingrésalos a mano.</p>'}
    <div class="cfg-grp">Embalse / depósito y modo de falla</div>
    <div class="cfg-form">
      <label title="Volumen almacenado al momento de la falla (agua o relave licuado)">Volumen Vw [m³]<input id="br-vw" type="number" step="10000" value="${vw}"></label>
      <label title="Altura desde el fondo de la brecha final hasta el nivel del agua/relave">Altura de brecha hb [m]<input id="br-hb" type="number" step="0.5" value="${hb}"></label>
      <label title="Carga sobre el fondo de la brecha (= hb si el nivel llega al coronamiento)">Carga hw [m]<input id="br-hw" type="number" step="0.5" placeholder="= hb"></label>
      <label>Modo de falla<select id="br-modo">
        <option value="sobrevertimiento">Sobrevertimiento (overtopping)</option>
        <option value="tubificacion">Tubificación (piping)</option></select></label>
      <label title="Froehlich suele gobernar en presas chicas; MLM en volúmenes grandes">Qp a usar<select id="br-qp">
        <option value="froehlich">Froehlich (1995)</option>
        <option value="mlm">MacDonald-L-M</option>
        <option value="max">Máx de ambos (conservador)</option></select></label>
    </div>
    <div class="cfg-grp">Material (para rutear en el 2D)</div>
    <div class="cfg-form">
      <label>Tipo<select id="br-mat">
        <option value="agua">Agua clara</option>
        <option value="relave">Relave / mezcla (no-newtoniano)</option></select></label>
      <span id="br-reo" style="display:none;grid-column:1/3">
        <span class="cfg-form" style="display:grid">
        <label title="Esfuerzo de fluencia de la mezcla (relaves 100–2000 Pa típico según Cv)">τy [Pa]<input id="br-ty" type="number" step="50" value="400"></label>
        <label title="Viscosidad dinámica de la mezcla">μ [Pa·s]<input id="br-mu" type="number" step="0.1" value="0.5"></label>
        <label title="Concentración volumétrica de sólidos (relaves licuados 0.35–0.55)">Cv [–]<input id="br-cv" type="number" step="0.05" value="0.45"></label>
        <label title="Parámetro de resistencia laminar (24 def; mayor con vegetación)">K laminar<input id="br-k" type="number" step="1" value="24"></label>
        </span>
      </span>
    </div>
    <button class="hp-run" id="br-run" style="margin-top:8px">💥 Generar hidrograma de rotura</button>
    <div id="br-out"></div>
    <p class="hud-note">Relaciones empíricas de Froehlich (2008/1995) y MacDonald &amp; Langridge-Monopolis. El hidrograma conserva el volumen embalsado y queda disponible como <b>crecida del pipeline</b>: rutéalo con <b>Momentum 2D</b> (pestaña Hidráulica) marcando "Crecida"; si es relave, la reología de O'Brien se aplica automáticamente. DS 50 (DGA) · GISTM.</p>`;
}

function wire(hud, koi) {
  const $ = (s) => hud.body.querySelector(s);
  const syncMat = () => { $('#br-reo').style.display = $('#br-mat').value === 'relave' ? '' : 'none'; };
  $('#br-mat').addEventListener('change', syncMat);
  syncMat();

  $('#br-run').addEventListener('click', () => {
    const out = $('#br-out');
    let r;
    try {
      r = hidrogramaRotura(
        { Vw: +$('#br-vw').value, hb: +$('#br-hb').value, hw: $('#br-hw').value ? +$('#br-hw').value : null, modo: $('#br-modo').value },
        { Qp: $('#br-qp').value });
    } catch (e) { out.innerHTML = `<p class="hud-note" style="color:var(--red)">${e.message}</p>`; return; }

    const esRelave = $('#br-mat').value === 'relave';
    const reologia = esRelave ? { tauY: +$('#br-ty').value || 0, mu: +$('#br-mu').value || 0, Cv: +$('#br-cv').value || 0.45, K: +$('#br-k').value || 24 } : null;
    fijarCrecida(koi, { hidrograma: r.out, reologia, fuente: 'breach' });   // → momentum 2D / tránsito / embalse
    // Si hay una presa activa: la crecida vive EN la presa y la onda entra al 2D en su muro.
    const pr = presaActiva(koi);
    if (pr) { pr.crecida = { hidrograma: r.out, reologia, fuente: 'breach' }; pr.entrada2D = [pr.lon, pr.lat]; koi.entradaCrecida = [pr.lon, pr.lat]; }
    else koi.entradaCrecida = null;
    registrar('breach', { modo: $('#br-modo').value, Vw: r.Vw, hb: r.hb, Bavg: r.Bavg, tfMin: r.tf / 60, Qp: r.QpUsado });

    out.innerHTML = `
      <div class="hp-kv" style="margin-top:8px">
        <div><span>Ancho medio de brecha B<sub>avg</sub></span><b>${f(r.Bavg, 1)} m</b></div>
        <div><span>Tiempo de formación t<sub>f</sub></span><b>${f(r.tf / 60, 1)} min</b></div>
        <div><span>Qp Froehlich / MLM</span><b>${f(r.QpFroehlich, 0)} / ${f(r.QpMLM, 0)} m³/s</b></div>
        <div><span>Qp usado</span><b>${f(r.QpUsado, 0)} m³/s</b></div>
        <div><span>Duración total del hidrograma</span><b>${f(r.tTot / 60, 1)} min</b></div>
        <div><span>Volumen del hidrograma (=Vw)</span><b>${f(r.volumenHidro, 0)} m³</b></div>
      </div>
      ${svgHidro(r.out)}
      <div class="bp-resalto" style="border-color:var(--accent)">
        ✔ Hidrograma guardado como <b>crecida del pipeline</b>${esRelave ? ' + <b>reología de relave</b> activa (τy=' + f(+$('#br-ty').value, 0) + ' Pa, Cv=' + f(+$('#br-cv').value) + ')' : ''}.
        Ve a <b>Hidráulica → Momentum 2D</b> y marca "Crecida" para rutear la onda de rotura.
      </div>`;
  });
}

function svgHidro(o) {
  const W = 430, H = 150, pad = 28;
  const tMax = o[o.length - 1].t || 1, qMax = Math.max(...o.map((p) => p.Q)) || 1;
  const X = (t) => pad + (t / tMax) * (W - 2 * pad), Y = (q) => H - pad - (q / qMax) * (H - 2 * pad);
  const pts = o.map((p) => `${X(p.t).toFixed(1)},${Y(p.Q).toFixed(1)}`).join(' ');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    <polygon points="${X(0)},${Y(0)} ${pts} ${X(tMax).toFixed(1)},${Y(0)}" fill="rgba(239,108,90,.25)"/>
    <polyline points="${pts}" fill="none" stroke="#ef6c5a" stroke-width="1.8"/>
    <text x="${pad + 2}" y="${pad - 6}" font-size="8" fill="var(--text2)">Q [m³/s] · pico ${qMax.toFixed(0)}</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">${(tMax / 60).toFixed(0)} min</text></svg>`;
}
