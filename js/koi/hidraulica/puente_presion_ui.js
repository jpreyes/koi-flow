// ─────────────────────────────────────────────────────────────────────────────
// puente_presion_ui.js — HUD de puente en flujo a presión / vertedero (koi-flow).
// Geometría del cruce (solera, bajo-tablero, rasante, vano, pilas) + caudal y
// tirante aguas abajo → régimen, cota de energía aguas arriba, reparto
// presión/vertedero, velocidad por el vano, afección (remanso) y revancha/gálibo.
// ─────────────────────────────────────────────────────────────────────────────
import { puentePresion, curvaPuente } from './puente_presion.js?v=13';
import { socavacionEstribo } from './socavacion.js?v=13';
import { registrar } from '../informe/registro.js?v=13';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirPuenteHUD(koi, huds) {
  const hud = huds.open('puente-presion', { title: '🌉 Puente (presión / vertedero)', w: 480, h: 640 });
  if (hud._ppWired) { hud.focus?.(); return hud; }
  hud.setBody(form(koi));
  wire(hud, koi);
  hud._ppWired = true;
  return hud;
}

// Intenta prefijar cotas desde el eje 1D activo y el tablero colocado, si existen.
function sugerir(koi) {
  const s = { Zinvert: '', Zlow: '', Zcrest: '', Bopen: '', TW: '', Q: '' };
  try {
    const bati = koi.bati;
    const rem = bati?._remanso?.perfil;
    if (rem?.length) {
      const zs = rem.map((p) => p.WSE - p.profMax).filter(isFinite);
      if (zs.length) s.Zinvert = Math.min(...zs).toFixed(1);
      s.TW = rem[0].WSE?.toFixed(1) || '';           // aguas abajo (1ª sección del perfil)
    }
    const q = bati?.body?.querySelector?.('#bp-q')?.value; if (q) s.Q = q;
    const dk = koi.estr?.piezas?.find?.((p) => p.tipo === 'tablero');
    if (dk && s.Zinvert !== '') { s.Zcrest = (dk.cota ?? +s.Zinvert + 4).toFixed?.(1); s.Zlow = (dk.cota - (dk.espesor || 0.8)).toFixed?.(1); }
  } catch { /* opcional */ }
  return s;
}

function form(koi) {
  const s = sugerir(koi);
  return `
    <div class="cfg-grp">Geometría del cruce [cotas m]</div>
    <div class="cfg-form">
      <label>Cota solera (fondo vano)<input id="pp-zi" type="number" step="0.5" value="${s.Zinvert}"></label>
      <label>Cota bajo-tablero (soffit)<input id="pp-zl" type="number" step="0.5" value="${s.Zlow}"></label>
      <label>Cota rasante (calzada)<input id="pp-zc" type="number" step="0.5" value="${s.Zcrest}"></label>
      <label>Ancho del vano B [m]<input id="pp-b" type="number" step="0.5" value="${s.Bopen || 20}"></label>
      <label>Σ ancho de pilas [m]<input id="pp-pi" type="number" step="0.1" value="0"></label>
      <label>Largo de calzada (vertedero) [m]<input id="pp-lw" type="number" step="0.5" placeholder="= B"></label>
    </div>
    <div class="cfg-grp">Hidráulica</div>
    <div class="cfg-form">
      <label>Caudal Q [m³/s]<input id="pp-q" type="number" step="1" value="${s.Q || 150}"></label>
      <label>WSE aguas abajo TW [m]<input id="pp-tw" type="number" step="0.1" value="${s.TW}"></label>
    </div>
    <details class="cfg-adv"><summary>Coeficientes (avanzado)</summary>
      <div class="cfg-form">
        <label>Cd compuerta<input id="pp-cd" type="number" step="0.05" value="0.5"></label>
        <label>Co orificio<input id="pp-co" type="number" step="0.05" value="0.8"></label>
        <label>Cw vertedero<input id="pp-cw" type="number" step="0.05" value="1.66"></label>
      </div>
    </details>
    <details class="cfg-adv"><summary>Socavación de estribos (HEC-18)</summary>
      <div class="cfg-form">
        <label>Calado de aproximación ya [m]<input id="pp-ea-ya" type="number" step="0.1" placeholder="= vano"></label>
        <label>Froude de aproximación Fr<input id="pp-ea-fr" type="number" step="0.05" placeholder="auto"></label>
        <label>Largo obstruido L' [m]<input id="pp-ea-l" type="number" step="1" value="15"></label>
        <label>Forma del estribo<select id="pp-ea-forma">
          <option value="derrame">Derrame (spill-through)</option>
          <option value="alas">Vertical con aletas</option>
          <option value="vertical">Muro vertical</option></select></label>
        <label>Ángulo terraplén θ [°]<input id="pp-ea-th" type="number" step="5" value="90"></label>
      </div>
    </details>
    <button class="hp-run" id="pp-run" style="margin-top:8px">🌉 Analizar puente (HEC-RAS)</button>
    <div id="pp-out"></div>`;
}

function wire(hud, koi) {
  const $ = (s) => hud.body.querySelector(s);
  $('#pp-run').addEventListener('click', () => {
    const o = {
      Zinvert: +$('#pp-zi').value, Zlow: +$('#pp-zl').value, Zcrest: +$('#pp-zc').value,
      Bopen: +$('#pp-b').value, pilas: +$('#pp-pi').value, Lw: $('#pp-lw').value ? +$('#pp-lw').value : undefined,
      Q: +$('#pp-q').value, TW: +$('#pp-tw').value,
      Cd: +$('#pp-cd').value, Co: +$('#pp-co').value, Cw: +$('#pp-cw').value,
    };
    const out = $('#pp-out');
    if (!(o.Zlow > o.Zinvert) || !(o.Zcrest >= o.Zlow)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Las cotas deben cumplir solera &lt; bajo-tablero ≤ rasante.</p>'; return; }
    if (!(o.Q > 0)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Ingresa el caudal Q.</p>'; return; }
    const r = puentePresion(o);
    if (r.presuriza) registrar('puentePresion', { regimen: r.regimen, Eu: r.Eu, Qpresion: r.Qpresion, Qvertedero: r.Qvertedero, afeccion: r.afeccion, revancha: r.revancha, Vvano: r.Vvano });
    if (!r.presuriza) {
      out.innerHTML = `<div class="bp-resalto" style="border-color:var(--teal)"><b>Superficie libre</b> — ${r.nota}
        <div class="hp-kv"><div><span>Q incipiente de presión</span><b>${f(r.Qincip, 0)} m³/s</b></div>
        <div><span>Área del vano</span><b>${f(r.Anet, 1)} m² (${f(r.Bnet, 1)}×${f(r.hVano, 1)})</b></div></div></div>`;
      return;
    }
    const overtop = r.sobreRasante > 0.001;
    out.innerHTML = `
      <div class="hp-mini" style="margin-top:8px">Régimen: <b>${r.regimen}</b></div>
      <div class="hp-kv">
        <div><span>Cota de energía aguas arriba</span><b>${f(r.Eu)} m</b></div>
        <div><span>Afección (remanso del puente)</span><b>${f(r.afeccion)} m</b></div>
        <div><span>Q a presión / por vertedero</span><b>${f(r.Qpresion, 0)} / ${f(r.Qvertedero, 0)} m³/s</b></div>
        <div><span>Velocidad por el vano</span><b>${f(r.Vvano)} m/s</b></div>
        <div><span>Área neta del vano</span><b>${f(r.Anet, 1)} m² (${f(r.Bnet, 1)}×${f(r.hVano, 1)})</b></div>
      </div>
      <div class="bp-resalto" style="border-color:${overtop ? 'var(--coral)' : 'var(--teal)'}">
        ${overtop
          ? `⚠️ <b>Vierte sobre la calzada</b>: ${f(r.sobreRasante)} m de lámina sobre la rasante (revancha negativa).`
          : `✔️ <b>Sin vertido</b>: revancha/gálibo = <b>${f(r.revancha)} m</b> bajo la rasante.`}
      </div>
      ${svgPerfil(r)}
      ${svgCurva(o, r)}
      ${bloqueEstribo($, r)}
      <p class="hud-note">Rutina HEC-RAS de presión/vertedero. La cota de energía aguas arriba se resuelve de Q = Q<sub>presión</sub> + Q<sub>vertedero</sub>. Verifica la revancha contra la exigida por el MC y V&gt;4–5 m/s exige protección de estribos.</p>`;
  });
}

// Bloque de socavación de estribos (HEC-18), con prefijado desde la hidráulica del puente.
function bloqueEstribo($, r) {
  const ya = $('#pp-ea-ya').value ? +$('#pp-ea-ya').value : r.hVano;
  const Lp = +$('#pp-ea-l').value || 0;
  if (!(ya > 0) || !(Lp > 0)) return '';
  const Fr = $('#pp-ea-fr').value ? +$('#pp-ea-fr').value : Math.min(0.9, r.Vvano / Math.sqrt(9.81 * ya));
  const forma = $('#pp-ea-forma').value, theta = +$('#pp-ea-th').value || 90;
  const e = socavacionEstribo({ ya, Fr, Lp, forma, theta });
  registrar('estribo', { metodo: e.recomendado, ratio: e.ratio, ys: e.adoptada });
  return `<div class="hp-mini" style="margin-top:10px">Socavación de estribos (HEC-18)</div>
    <div class="hp-kv">
      <div><span>Froehlich / HIRE</span><b>${f(e.froehlich)} / ${f(e.hire)} m</b></div>
      <div><span>L'/ya · método</span><b>${f(e.ratio, 0)} · ${e.recomendado}</b></div>
      <div><span>Socavación adoptada</span><b>${f(e.adoptada)} m</b></div>
      <div><span>ya / Fr aprox · K1·K2</span><b>${f(ya, 1)} / ${f(Fr)} · ${f(e.K1, 2)}·${f(e.K2, 2)}</b></div>
    </div>
    <p class="hud-note">Froehlich (L'/ya&lt;25) e HIRE (≥25). Se recomienda el método según L'/ya; ambos son conservadores (MC-V3 3.707.4 exige comparar). ys medida bajo el lecho junto al estribo.</p>`;
}

// Esquema de la sección del cruce: vano, tablero, rasante, cotas de agua.
function svgPerfil(r) {
  const W = 440, H = 150, pad = 22;
  const zLo = Math.min(r.Zinv, r.TW) - 0.5, zHi = Math.max(r.Zcrest, r.Eu) + 0.5, zR = (zHi - zLo) || 1;
  const Y = (z) => pad + (zHi - z) / zR * (H - 2 * pad);
  const espesor = Y(r.Zlow) - Y(r.Zcrest);
  const bx = pad + 60, bw = W - 2 * pad - 120;
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <rect x="${pad}" y="${Y(r.Zinv).toFixed(1)}" width="${W - 2 * pad}" height="${(H - pad - Y(r.Zinv)).toFixed(1)}" fill="var(--border2)" opacity="0.25"/>
    <rect x="${bx}" y="${Y(r.Zcrest).toFixed(1)}" width="${bw}" height="${Math.max(2, espesor).toFixed(1)}" fill="#94a3b8"/>
    <line x1="${pad}" y1="${Y(r.Eu).toFixed(1)}" x2="${W - pad}" y2="${Y(r.Eu).toFixed(1)}" stroke="#2563eb" stroke-width="1.6"/>
    <text x="${pad + 2}" y="${(Y(r.Eu) - 3).toFixed(1)}" font-size="8" fill="#2563eb">E aguas arriba ${f(r.Eu)}</text>
    <line x1="${bx + bw}" y1="${Y(r.TW).toFixed(1)}" x2="${W - pad}" y2="${Y(r.TW).toFixed(1)}" stroke="#0ea5b7" stroke-width="1.4" stroke-dasharray="4 2"/>
    <text x="${(W - pad).toFixed(1)}" y="${(Y(r.TW) - 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#0ea5b7">TW ${f(r.TW)}</text>
    <text x="${bx + 2}" y="${(Y(r.Zcrest) - 3).toFixed(1)}" font-size="8" fill="var(--text2)">rasante ${f(r.Zcrest)}</text>
    ${r.sobreRasante > 0.001 ? `<rect x="${bx}" y="${Y(r.Eu).toFixed(1)}" width="${bw}" height="${Math.max(1, Y(r.Zcrest) - Y(r.Eu)).toFixed(1)}" fill="#ef6c5a" opacity="0.4"/>` : ''}
    </svg>`;
}

function svgCurva(o, rd) {
  let pts;
  try { pts = curvaPuente(o, { Qmax: Math.max(rd.Q * 1.6, rd.Q + 40), nPtos: 24 }); } catch { return ''; }
  const W = 440, H = 150, pad = 26;
  const qMax = Math.max(...pts.map((p) => p.Q)) || 1;
  const eLo = Math.min(o.Zlow, ...pts.map((p) => p.Eu)), eHi = Math.max(...pts.map((p) => p.Eu), rd.Eu) || 1;
  const eR = (eHi - eLo) || 1;
  const X = (q) => pad + q / qMax * (W - 2 * pad);
  const Y = (e) => H - pad - (e - eLo) / eR * (H - 2 * pad);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.Q).toFixed(1)},${Y(p.Eu).toFixed(1)}`).join(' ');
  const lineZ = (z, c, t) => `<line x1="${pad}" y1="${Y(z).toFixed(1)}" x2="${W - pad}" y2="${Y(z).toFixed(1)}" stroke="${c}" stroke-dasharray="3 3"/><text x="${W - pad}" y="${(Y(z) - 2).toFixed(1)}" text-anchor="end" font-size="8" fill="${c}">${t}</text>`;
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    ${lineZ(o.Zcrest, '#ef6c5a', 'rasante')}${lineZ(o.Zlow, '#94a3b8', 'bajo-tablero')}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
    <circle cx="${X(rd.Q).toFixed(1)}" cy="${Y(rd.Eu).toFixed(1)}" r="4" fill="#2563eb" stroke="#fff"/>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">Q ${qMax.toFixed(0)} m³/s</text>
    <text x="${pad + 3}" y="${pad - 4}" font-size="8" fill="var(--text2)">cota de energía aguas arriba vs Q</text></svg>`;
}
