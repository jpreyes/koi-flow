// ─────────────────────────────────────────────────────────────────────────────
// tormenta_ui.js — HUD de Tormenta de diseño (koi-flow).
// PP24 de diseño + curva IDF de la estación → hietograma por bloques alternos
// (posición de peak ajustable) o uniforme. Muestra el hietograma (barras) y, con la
// morfometría de la cuenca, el hidrograma resultante (SCS-CN + convolución del HU).
// Deja el hidrograma en koi.hidrogramaCrecida (para el 2D / tránsito / embalse) y
// registra la tormenta en koi.reg.tormenta (para el informe).
// ─────────────────────────────────────────────────────────────────────────────
import { bloquesAlternos, uniforme, hietoIncremental } from './tormenta.js?v=13';
import { hidrogramaDesdeHietograma } from './convolucion.js?v=13';
import { registrar } from '../informe/registro.js?v=13';
import { fetchJSON } from '../datos/fetch_json.js?v=13';
import { toast } from '../ui/toast.js?v=13';
import { bloqueInsumos } from '../ui/insumos.js?v=13';
import { on as busOn } from '../ui/bus.js?v=13';
import { fijarCrecida } from '../ui/seleccion.js?v=13';

const f = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

let _coefCache = null;
async function coefIDF() {
  if (!_coefCache) _coefCache = await fetchJSON('data/coef_hidro.json?v=13', { contexto: 'Coeficientes IDF' });
  return _coefCache.idf;
}

function morfoActiva(koi) {
  const m = koi.hydro?._punto?.cuenca?.morfometria;
  if (!m) return null;
  return { A: m.A, L: m.L, Lg: m.Lg || (m.L ? 0.6 * m.L : null), S: m.S };
}

// PP24 de diseño de un último pipeline, si existe (koi.reg.hidrologia.precipitacion).
function pp24Sugerida(koi) {
  const pp = koi.reg?.hidrologia?.precipitacion?.ppDiseno;
  if (pp && pp[100]) return { pp24: +(+pp[100]).toFixed(1), T: 100, estacion: koi.reg.hidrologia.precipitacion.estacion };
  return null;
}

export function abrirTormentaHUD(koi, huds) {
  const hud = huds.open('tormenta', { title: '🌧 Tormenta de diseño', w: 480, h: 640 });
  if (hud._twWired) { hud.focus?.(); return hud; }
  hud.setBody('<p class="hud-note">Cargando coeficientes IDF…</p>');
  coefIDF().then((idf) => {
    hud.setBody(form(koi, idf));
    wire(hud, koi, idf);
    hud._twWired = true;
  }).catch((e) => { hud.setBody(`<p class="hud-note" style="color:var(--red)">${e.message}</p>`); });
  return hud;
}

function form(koi, idf) {
  const m = morfoActiva(koi) || {};
  const sug = pp24Sugerida(koi);
  const estaciones = Object.keys(idf.estaciones || { Putre: 1 });
  const opts = estaciones.map((e) => `<option value="${e}"${e === 'Putre' ? ' selected' : ''}>${e}</option>`).join('');
  return `
    <div class="cfg-grp">Precipitación de diseño ${sug ? '(del pipeline)' : ''}</div>
    <div class="cfg-form">
      <label>PP24 de diseño [mm]<input id="tw-pp" type="number" step="1" value="${sug ? sug.pp24 : 80}"></label>
      <label>Período T [años]<input id="tw-t" type="number" step="1" value="${sug ? sug.T : 100}"></label>
      <label style="grid-column:1/3">Estación coef. IDF (CD)<select id="tw-est">${opts}</select></label>
    </div>
    <div class="cfg-grp">Distribución temporal</div>
    <div class="cfg-form">
      <label>Método<select id="tw-met">
        <option value="alternos" selected>Bloques alternos (IDF)</option>
        <option value="uniforme">Uniforme</option></select></label>
      <label>Duración Td [h]<input id="tw-td" type="number" step="1" value="24"></label>
      <label>Paso Δt [min]<input id="tw-dt" type="number" step="10" value="60"></label>
      <label>Posición del peak r<input id="tw-r" type="number" step="0.05" min="0" max="1" value="0.5"></label>
    </div>
    <div class="cfg-grp">Cuenca (para el hidrograma) ${m.A ? '(autocompletada)' : ''}</div>
    <div class="cfg-form">
      <label>Área A [km²]<input id="tw-a" type="number" step="1" value="${m.A ?? 300}"></label>
      <label>Long. L [km]<input id="tw-l" type="number" step="0.5" value="${m.L ?? 40}"></label>
      <label>Lg [km]<input id="tw-lg" type="number" step="0.5" value="${m.Lg ? m.Lg.toFixed(1) : 24}"></label>
      <label>Pendiente S [m/m]<input id="tw-s" type="number" step="0.001" value="${m.S ?? 0.02}"></label>
      <label>Curva número CN<input id="tw-cn" type="number" step="1" value="75"></label>
      <label>Zona HU<select id="tw-z">
        <option value="1">1 · III–VI</option><option value="2">2 · VII</option>
        <option value="3" selected>3 · VIII–X</option></select></label>
    </div>
    <button class="hp-run" id="tw-run" style="margin-top:8px">🌧 Calcular tormenta e hidrograma</button>
    <div id="tw-sel" class="hud-note" style="color:#f59e0b"></div>
    <div id="tw-out"></div>
    <p class="hud-note" style="margin-top:6px">⚠ Zona árida (norte): la tormenta es <b>referencial</b>; el caudal de diseño lo gobierna la transposición fluviométrica. Sirve para la forma del hidrograma y el tránsito.</p>`;
}

function wire(hud, koi, idf) {
  const $ = (s) => hud.body.querySelector(s);
  // El campo r solo aplica a bloques alternos.
  const syncMet = () => { $('#tw-r').closest('label').style.opacity = $('#tw-met').value === 'alternos' ? '1' : '0.4'; };
  $('#tw-met').addEventListener('change', syncMet); syncMet();

  // Conversar con la selección: si cambia la cuenca/tramo, re-autocompletar la
  // morfometría y avisar. (Resuelve "los paneles no conversan entre ellos".)
  const off = busOn('seleccion:cambio', () => {
    const m = morfoActiva(koi);
    const nota = $('#tw-sel');
    if (m) {
      if ($('#tw-a')) { $('#tw-a').value = m.A ?? $('#tw-a').value; $('#tw-l').value = m.L ?? $('#tw-l').value; if (m.Lg) $('#tw-lg').value = m.Lg.toFixed(1); $('#tw-s').value = m.S ?? $('#tw-s').value; }
      if (nota) nota.textContent = 'Morfometría actualizada desde la cuenca seleccionada — recalcula.';
    } else if (nota) nota.textContent = 'Selección cambió (sin cuenca delineada).';
  });
  hud.onClose = (prev => () => { off(); prev?.(); })(hud.onClose);

  $('#tw-run').addEventListener('click', () => {
    const out = $('#tw-out');
    const pp24 = +$('#tw-pp').value, TdMin = (+$('#tw-td').value || 24) * 60, dtMin = +$('#tw-dt').value || 60;
    const est = $('#tw-est').value;
    const coefArr = idf.estaciones[est] || idf.estaciones.Putre;
    if (!(pp24 > 0)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Ingresa la PP24 de diseño.</p>'; return; }
    const tor = $('#tw-met').value === 'uniforme'
      ? uniforme(pp24, coefArr, { TdMin, dtMin })
      : bloquesAlternos(pp24, coefArr, { TdMin, dtMin, r: Math.min(1, Math.max(0, +$('#tw-r').value)) });

    const morfo = { A: +$('#tw-a').value, L: +$('#tw-l').value, Lg: +$('#tw-lg').value, S: +$('#tw-s').value };
    const mAuto = morfoActiva(koi);   // si null → la morfometría es "por defecto"
    const morfoDef = !mAuto;
    let hg = null;
    if (morfo.A > 0 && morfo.L > 0 && morfo.S > 0) {
      hg = hidrogramaDesdeHietograma(morfo, hietoIncremental(tor), { CN: +$('#tw-cn').value, zona: +$('#tw-z').value, dtH: dtMin / 60, baseflow: 0 });
    }
    koi._tormenta = { tor, hg, est, T: +$('#tw-t').value };
    registrar('tormenta', {
      metodo: tor.metodo, estacion: est, T: +$('#tw-t').value, pp24, TdH: TdMin / 60, dtMin, r: tor.r,
      Ptotal: tor.Ptotal, imax: tor.imax, Qpico: hg?.Qpico ?? null, volMm3: hg ? hg.volumen / 1e6 : null,
    });

    const insumos = bloqueInsumos([
      { k: 'PP24 de diseño', v: `${f(pp24)} mm (T=${$('#tw-t').value})` },
      { k: 'Estación coef. IDF', v: est },
      { k: 'Duración · Δt', v: `${f(TdMin / 60, 0)} h · ${dtMin} min` },
      { k: 'Método · peak r', v: `${$('#tw-met').value} · ${f(+$('#tw-r').value, 2)}` },
      { k: 'Área A', v: `${f(morfo.A)} km²`, def: morfoDef },
      { k: 'Long. L · Lg', v: `${f(morfo.L)} · ${f(morfo.Lg)} km`, def: morfoDef },
      { k: 'Pendiente S', v: `${f(morfo.S, 3)} m/m`, def: morfoDef },
      { k: 'CN · Zona HU', v: `${$('#tw-cn').value} · ${$('#tw-z').value}` },
    ]);

    out.innerHTML = insumos + `
      <div class="hp-kv">
        <div><span>P total (Td)</span><b>${f(tor.Ptotal)} mm</b></div>
        <div><span>Intensidad máx</span><b>${f(tor.imax)} mm/h</b></div>
        <div><span>Bloques · Δt</span><b>${tor.bloques.length} · ${dtMin} min</b></div>
        ${hg ? `<div><span>Caudal pico</span><b>${f(hg.Qpico)} m³/s</b></div>
        <div><span>Lluvia efectiva</span><b>${f(hg.PeTotal)} mm</b></div>
        <div><span>Volumen escorrentía</span><b>${f(hg.volumen / 1e6, 2)} Mm³</b></div>` : ''}
      </div>
      <div class="hud-sec">Hietograma de diseño (${tor.metodo === 'uniforme' ? 'uniforme' : 'bloques alternos'})</div>
      ${svgHieto(tor)}
      ${hg ? `<div class="hud-sec">Hidrograma de crecida (HU Linsley + SCS-CN)</div>${svgHidro(hg.out)}
        <button class="hp-run" id="tw-use" style="margin-top:8px">➡ Usar como crecida 2D / tránsito</button>` : '<p class="hud-note">Completa A, L y S (o delinea una cuenca) para obtener el hidrograma.</p>'}
      <p class="hud-note">Bloques alternos derivados de la IDF (CD de ${est}). Masa conservada: ΣP = PP24·CD(Td).</p>`;

    if (hg) $('#tw-use').addEventListener('click', () => {
      fijarCrecida(koi, { hidrograma: hg.out, reologia: null, fuente: 'tormenta' });   // agua clara; se guarda en la cuenca activa
      const p = koi.hydro?._punto;
      toast(`Hidrograma fijado como crecida${p ? ' de ' + p.nombre : ''} (2D / tránsito / embalse).`, 'ok');
    });
  });
}

// Barras del hietograma (mm por bloque), con el pico resaltado.
function svgHieto(tor) {
  const W = 430, H = 150, pad = 26;
  const n = tor.bloques.length, mmx = Math.max(...tor.mm) || 1;
  const bw = (W - 2 * pad) / n;
  const iPk = tor.mm.indexOf(mmx);
  const bars = tor.bloques.map((b, i) => {
    const bh = (b.mm / mmx) * (H - 2 * pad), x = pad + i * bw, y = H - pad - bh;
    return `<rect x="${(x + 0.4).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 0.8).toFixed(1)}" height="${bh.toFixed(1)}" fill="${i === iPk ? 'var(--accent)' : 'var(--accent2, #6aa9c9)'}" opacity="0.9"/>`;
  }).join('');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    <text x="${pad}" y="${H - 6}" font-size="8" fill="var(--text2)">0</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">${(tor.TdMin / 60).toFixed(0)} h</text>
    <text x="${pad + 2}" y="${pad - 6}" font-size="8" fill="var(--text2)">mm/bloque · máx ${mmx.toFixed(1)}</text></svg>`;
}

function svgHidro(o) {
  const W = 430, H = 150, pad = 28;
  const tMax = o[o.length - 1].t || 1, qMax = Math.max(...o.map((p) => p.Q)) || 1;
  const X = (t) => pad + (t / tMax) * (W - 2 * pad), Y = (q) => H - pad - (q / qMax) * (H - 2 * pad);
  const pts = o.map((p) => `${X(p.t).toFixed(1)},${Y(p.Q).toFixed(1)}`).join(' ');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">${(tMax / 3600).toFixed(1)} h</text>
    <text x="${pad + 2}" y="${pad - 6}" font-size="8" fill="var(--text2)">Q [m³/s] · pico ${qMax.toFixed(0)}</text></svg>`;
}
