// ─────────────────────────────────────────────────────────────────────────────
// sismo_estribo_ui.js — HUD de empuje sísmico en estribos/muros (Mononobe-Okabe).
// Geometría + relleno + zona sísmica → K_A/K_AE, empujes (estático, total sísmico,
// incremento dinámico con su punto de aplicación) y verificación simplificada de
// deslizamiento/volcamiento. Complementa la hidráulica del puente: el mismo estribo
// que se verifica a socavación se verifica aquí al sismo (MC 3.1004 / NCh433).
// ─────────────────────────────────────────────────────────────────────────────
import { sismoEstribo, ZONAS_SISMICAS } from './sismo_estribo.js?v=13';
import { registrar } from '../informe/registro.js?v=13';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirSismoEstriboHUD(koi, huds) {
  const hud = huds.open('sismo-estribo', { title: '🫨 Sísmica de estribos (Mononobe-Okabe)', w: 480, h: 640 });
  if (hud._smWired) { hud.focus?.(); return hud; }
  hud.setBody(form());
  wire(hud);
  hud._smWired = true;
  return hud;
}

function form() {
  return `
    <div class="cfg-grp">Muro / estribo y relleno</div>
    <div class="cfg-form">
      <label title="Altura del muro desde el sello de fundación">Altura H [m]<input id="sm-h" type="number" step="0.5" value="6"></label>
      <label title="Peso unitario del relleno compactado (18–21 típico)">γ relleno [kN/m³]<input id="sm-g" type="number" step="0.5" value="19"></label>
      <label title="Ángulo de fricción interna del relleno (30–36° granular)">φ [°]<input id="sm-phi" type="number" step="1" value="32"></label>
      <label title="Fricción muro-relleno; vacío = φ/2 (usual)">δ [°]<input id="sm-delta" type="number" step="1" placeholder="= φ/2"></label>
      <label title="Inclinación de la superficie del relleno tras el muro">Talud relleno β [°]<input id="sm-beta" type="number" step="1" value="0"></label>
      <label title="Inclinación del trasdós desde la vertical">Trasdós θ [°]<input id="sm-theta" type="number" step="1" value="0"></label>
    </div>
    <div class="cfg-grp">Sismo (MC 3.1004 / NCh433)</div>
    <div class="cfg-form">
      <label>Zona sísmica<select id="sm-zona">
        <option value="1">Zona 1 (A₀ = 0.20g)</option>
        <option value="2">Zona 2 (A₀ = 0.30g)</option>
        <option value="3" selected>Zona 3 (A₀ = 0.40g — costa)</option></select></label>
      <label title="Si lo dejas vacío se usa kh = A₀/2g (práctica usual para muros)">kh (manda sobre la zona)<input id="sm-kh" type="number" step="0.05" placeholder="= A₀/2g"></label>
    </div>
    <div class="cfg-grp">Verificación del muro (opcional)</div>
    <div class="cfg-form">
      <label title="Peso propio del muro por metro de largo">Peso W [kN/m]<input id="sm-w" type="number" step="10" placeholder="opcional"></label>
      <label>Ancho de base Bz [m]<input id="sm-bz" type="number" step="0.2" placeholder="opcional"></label>
      <label title="Coeficiente de fricción hormigón-suelo (0.45–0.6)">μ base<input id="sm-mu" type="number" step="0.05" value="0.55"></label>
    </div>
    <button class="hp-run" id="sm-run" style="margin-top:8px">🫨 Calcular empuje sísmico (M-O)</button>
    <div id="sm-out"></div>
    <p class="hud-note">Mononobe-Okabe pseudo-estático: el estático P<sub>A</sub> se aplica a H/3 y el incremento dinámico ΔP<sub>AE</sub> a 0.6·H (Seed &amp; Whitman). Verificación simplificada (sin empuje pasivo ni sobrecarga — conservadora): FS sísmicos usuales ≥ 1.1 (deslizamiento) y ≥ 1.15 (volcamiento). Para el diseño estructural completo del estribo, exporta a nodex/structweb3d.</p>`;
}

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  $('#sm-run').addEventListener('click', () => {
    const out = $('#sm-out');
    let r;
    try {
      r = sismoEstribo({
        H: +$('#sm-h').value, gamma: +$('#sm-g').value, phi: +$('#sm-phi').value,
        delta: $('#sm-delta').value ? +$('#sm-delta').value : null,
        beta: +$('#sm-beta').value || 0, theta: +$('#sm-theta').value || 0,
        zona: +$('#sm-zona').value, kh: $('#sm-kh').value ? +$('#sm-kh').value : null,
        W: $('#sm-w').value ? +$('#sm-w').value : null, Bz: $('#sm-bz').value ? +$('#sm-bz').value : null,
        muBase: +$('#sm-mu').value || 0.55,
      });
    } catch (e) { out.innerHTML = `<p class="hud-note" style="color:var(--red)">${e.message}</p>`; return; }
    if (!r.valido) { out.innerHTML = `<p class="hud-note" style="color:var(--red)">⚠️ ${r.nota}</p>`; return; }

    registrar('sismo', { zona: r.zona, kh: r.kh, KA: r.KA, KAE: r.KAE, PA: r.PA, PAE: r.PAE, dPAE: r.dPAE, FSdesl: r.FSdesl, FSvolc: r.FSvolc });

    const chk = (fs, lim, cumple) => fs == null ? '—'
      : `<b style="color:${cumple ? 'var(--teal)' : 'var(--coral)'}">${f(fs)} ${cumple ? '✓' : '✗'} (mín ${lim})</b>`;
    out.innerHTML = `
      <div class="hp-kv" style="margin-top:8px">
        <div><span>kh · ψ</span><b>${f(r.kh)} · ${f(r.psi, 1)}°</b></div>
        <div><span>K_A (estático) / K_AE (sísmico)</span><b>${f(r.KA, 3)} / ${f(r.KAE, 3)}</b></div>
        <div><span>P_A (a H/3)</span><b>${f(r.PA, 1)} kN/m</b></div>
        <div><span>P_AE total sísmico</span><b>${f(r.PAE, 1)} kN/m</b></div>
        <div><span>ΔP_AE dinámico (a 0.6·H)</span><b>${f(r.dPAE, 1)} kN/m</b></div>
        <div><span>Momento volcante del empuje</span><b>${f(r.Msolic, 1)} kN·m/m</b></div>
        ${r.Fmuro != null ? `<div><span>Inercia del muro kh·W</span><b>${f(r.Fmuro, 1)} kN/m</b></div>` : ''}
      </div>
      ${r.FSdesl != null ? `<div class="bp-resalto" style="border-color:${r.cumpleDesl && r.cumpleVolc ? 'var(--teal)' : 'var(--coral)'}">
        <div class="hp-kv">
          <div><span>FS deslizamiento</span>${chk(r.FSdesl, '1.1', r.cumpleDesl)}</div>
          <div><span>FS volcamiento</span>${chk(r.FSvolc, '1.15', r.cumpleVolc)}</div>
        </div>
        ${!(r.cumpleDesl && r.cumpleVolc) ? '<span class="hud-note">Aumenta el peso/base del muro, ancla la fundación o considera el empuje pasivo del pie (no incluido, conservador).</span>' : ''}
      </div>` : '<p class="hud-note">Ingresa W y Bz para verificar deslizamiento y volcamiento.</p>'}
      ${svgEsquema(r)}`;
  });
}

// Esquema del muro con los dos empujes y sus puntos de aplicación.
function svgEsquema(r) {
  const W = 430, H = 170, pad = 20;
  const hM = H - 2 * pad;                      // muro dibujado a toda la altura
  const y = (fr) => H - pad - fr * hM;         // fr = fracción de H desde la base
  const xM = 150;
  const flecha = (yy, len, color, txt) => `
    <line x1="${xM + 8 + len}" y1="${yy}" x2="${xM + 8}" y2="${yy}" stroke="${color}" stroke-width="2.2" marker-end="url(#fl-${color.replace('#', '')})"/>
    <text x="${xM + 14 + len}" y="${yy + 3}" font-size="9" fill="${color}">${txt}</text>`;
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <defs>
      <marker id="fl-2563eb" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#2563eb"/></marker>
      <marker id="fl-ef6c5a" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ef6c5a"/></marker>
    </defs>
    <rect x="${xM - 16}" y="${pad}" width="16" height="${hM}" fill="#94a3b8"/>
    <rect x="${xM - 34}" y="${H - pad - 8}" width="52" height="8" fill="#94a3b8"/>
    <polygon points="${xM},${pad} ${W - pad},${pad} ${W - pad},${H - pad} ${xM},${H - pad}" fill="rgba(163,128,90,.25)"/>
    ${flecha(y(1 / 3), 60, '#2563eb', `P_A = ${f(r.PA, 0)} kN/m (H/3)`)}
    ${flecha(y(0.6), 45, '#ef6c5a', `ΔP_AE = ${f(r.dPAE, 0)} kN/m (0.6H)`)}
    <text x="${pad}" y="${H - 8}" font-size="8" fill="var(--text2)">zona ${r.zona} · kh=${f(r.kh)} · K_AE=${f(r.KAE, 3)}</text></svg>`;
}
