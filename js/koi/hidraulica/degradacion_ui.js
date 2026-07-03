// ─────────────────────────────────────────────────────────────────────────────
// degradacion_ui.js — HUD de degradación / agradación general a largo plazo (koi-flow).
// Hidráulica dominante + razón de aporte de sedimentos + largo del tramo → descenso
// (o ascenso) del lecho por pendiente de equilibrio y acorazamiento (MC-V3 3.707.4).
// El resultado se suma a la socavación general + local para la socavación TOTAL.
// ─────────────────────────────────────────────────────────────────────────────
import { degradacionLargoPlazo } from './degradacion.js?v=3';
import { registrar } from '../informe/registro.js?v=3';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

export function abrirDegradacionHUD(koi, huds) {
  const hud = huds.open('degradacion', { title: '⬇️ Degradación a largo plazo', w: 460, h: 560 });
  if (hud._degWired) { hud.focus?.(); return hud; }
  hud.setBody(form(koi));
  wire(hud);
  hud._degWired = true;
  return hud;
}

function sugerir(koi) {
  const s = { h: '', J: '', B: '' };
  try {
    const bati = koi.bati, rem = bati?._remanso;
    if (rem?.perfil?.length) {
      s.h = Math.max(...rem.perfil.map((p) => p.profMax || 0)).toFixed(1);
      s.B = Math.max(...rem.perfil.map((p) => (p.A && p.profMax ? p.A / p.profMax : 0))).toFixed(0);
      if (rem.pendienteMedia) s.J = rem.pendienteMedia.toFixed(4);
    }
  } catch { /* opcional */ }
  return s;
}

function form(koi) {
  const s = sugerir(koi);
  return `
    <div class="cfg-grp">Hidráulica dominante</div>
    <div class="cfg-form">
      <label>Calado h [m]<input id="dg-h" type="number" step="0.1" value="${s.h || 2.5}"></label>
      <label>Pendiente S₀ [m/m]<input id="dg-j" type="number" step="0.001" value="${s.J || 0.006}"></label>
      <label>Ancho B [m]<input id="dg-b" type="number" step="1" value="${s.B || 25}"></label>
      <label>D50 lecho [mm]<input id="dg-d50" type="number" step="1" value="20"></label>
    </div>
    <div class="cfg-grp">Balance de sedimentos</div>
    <div class="cfg-form">
      <label>Razón de aporte r = Qs_ap/Qs_cap<input id="dg-r" type="number" step="0.05" value="0.5"></label>
      <label>Largo del tramo (pivote) [m]<input id="dg-l" type="number" step="50" value="1000"></label>
      <label>Fracción gruesa (coraza)<input id="dg-pc" type="number" step="0.05" value="0.10"></label>
      <label>Densidad roca s<input id="dg-s" type="number" step="0.05" value="2.65"></label>
    </div>
    <button class="hp-run" id="dg-run" style="margin-top:8px">⬇️ Estimar degradación</button>
    <div id="dg-out"></div>
    <p class="hud-note">r &lt; 1 (déficit de aporte, p.ej. aguas abajo de embalse/extracción) ⇒ degrada; r &gt; 1 ⇒ agrada. Se adopta el menor entre pendiente de equilibrio y acorazamiento. Este descenso se SUMA a la socavación general + local (socavación total, MC 3.707.4).</p>`;
}

function wire(hud) {
  const $ = (s) => hud.body.querySelector(s);
  $('#dg-run').addEventListener('click', () => {
    const o = {
      h: +$('#dg-h').value, J: +$('#dg-j').value, B: +$('#dg-b').value, D50mm: +$('#dg-d50').value,
      razonAporte: +$('#dg-r').value, L: +$('#dg-l').value, fraccionGruesa: +$('#dg-pc').value, s: +$('#dg-s').value || 2.65,
    };
    const out = $('#dg-out');
    if (!(o.h > 0) || !(o.J > 0) || !(o.B > 0)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Ingresa h, S₀ y B.</p>'; return; }
    const r = degradacionLargoPlazo(o);
    registrar('degradacion', {
      dzPend: Math.abs(r.dzPendiente), dzCoraza: isFinite(r.dzCoraza) ? r.dzCoraza : null,
      dzAdoptado: r.tendencia === 'degradación' ? r.degradacion : (r.tendencia === 'agradación' ? -r.agradacion : 0),
      mecanismo: r.limitadaPorCoraza ? 'acorazamiento' : 'pendiente de equilibrio',
    });
    const degra = r.tendencia === 'degradación', agra = r.tendencia === 'agradación';
    const col = degra ? 'var(--coral)' : agra ? 'var(--teal)' : 'var(--border2)';
    const val = degra ? `descenso del lecho <b>${f(r.degradacion)} m</b>` : agra ? `ascenso del lecho <b>${f(r.agradacion)} m</b>` : 'sin cambio neto';
    out.innerHTML = `
      <div class="bp-resalto" style="border-color:${col}">
        <b>${r.tendencia.toUpperCase()}</b> — ${val}
        ${r.limitadaPorCoraza ? '<br><span class="hud-note">Limitada por acorazamiento (se forma coraza antes de alcanzar la pendiente de equilibrio).</span>' : ''}
      </div>
      <div class="hp-kv">
        <div><span>Pendiente equilibrio Se / S₀</span><b>${f(r.Se, 5)} / ${f(r.S0, 5)}</b></div>
        <div><span>Δz por pendiente de equilibrio</span><b>${f(Math.abs(r.dzPendiente))} m</b></div>
        <div><span>Δz por acorazamiento</span><b>${isFinite(r.dzCoraza) ? f(r.dzCoraza) + ' m' : '—'}</b></div>
        <div><span>Tamaño competente Dc</span><b>${f(r.Dc_mm, 0)} mm</b></div>
        <div><span>Capacidad de transporte Qs</span><b>${r.QsCap.toExponential(2)} m³/s</b></div>
      </div>
      ${degra ? `<p class="hud-note">Socavación total = <b>${f(r.degradacion)} m</b> (degradación) + socavación general + local. Ingrésalo como "socavación de diseño" en el enrocado para empotrar el pie.</p>` : ''}`;
  });
}
