// ─────────────────────────────────────────────────────────────────────────────
// estacion_hud.js — contenido del HUD de una estación DGA (koi-flow, rediseño UI).
// Al pinchar una estación en el mapa se abre un HUD flotante con: metadatos, la
// serie de máximos anuales (gráfico de barras por año), estadísticos, el ajuste de
// las distribuciones del MC y sus cuantiles por período de retorno. Reutiliza
// cargarSerie (dga.js) y analizar (frecuencia.js).
// ─────────────────────────────────────────────────────────────────────────────
import { cargarSerie, descargarSerieDGA } from './dga.js?v=6';
import { analizar } from '../hidro/frecuencia.js?v=6';
import { KoiDataError } from './fetch_json.js?v=6';

const f = (v) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)));
const DIST = { normal: 'Normal', lognormal: 'Log-Normal', pearson3: 'Pearson III', logpearson3: 'Log-Pearson III', gumbel: 'Gumbel', gamma: 'Gamma' };

export async function abrirEstacionHUD(huds, est, { onLink } = {}) {
  const fluvio = est.tipo === 'fluviometrica';
  const uni = fluvio ? 'm³/s' : 'mm';
  const id = 'est_' + est.bna + '_' + est.tipo;
  const hud = huds.open(id, { title: `${fluvio ? '🌊' : '🌧'} ${est.nombre}`, w: 420, h: 400 });
  await pintarSerie(hud, est, uni, fluvio, onLink);
  return hud;
}

// Carga la serie y pinta el HUD; si no hay serie, ofrece descargarla y reintenta.
async function pintarSerie(hud, est, uni, fluvio, onLink) {
  hud.setBody('<p class="hud-note">Cargando serie…</p>');
  let raw;
  try {
    raw = await cargarSerie(est);
  } catch (e) {
    const msg = e instanceof KoiDataError ? e.message : 'No hay serie descargada para esta estación.';
    hud.setBody(metaHTML(est) +
      `<p class="hud-note" style="color:var(--red)">${msg}</p>` +
      `<button class="hud-link" id="hud-dl">⬇ Descargar serie DGA</button>` +
      `<span class="hud-note" id="hud-dl-st"></span>`);
    hud.body.querySelector('#hud-dl')?.addEventListener('click', async () => {
      const st = hud.body.querySelector('#hud-dl-st');
      const btn = hud.body.querySelector('#hud-dl');
      btn.disabled = true; st.textContent = ' descargando desde el CR2… (puede tardar)';
      try {
        await descargarSerieDGA({ lon: est.lon, lat: est.lat }, est.tipo);
        await pintarSerie(hud, est, uni, fluvio, onLink);   // reintenta con la serie ya bajada
      } catch (err) {
        btn.disabled = false;
        st.textContent = ' ✗ ' + (err?.message || 'falló la descarga');
      }
    });
    return;
  }

  const so = raw?.serie ?? raw;
  const pares = (Array.isArray(so) ? so.map((v, i) => [i + 1, +v]) : Object.entries(so || {}).map(([y, v]) => [+y, +v]))
    .filter((p) => isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  if (pares.length < 3) { hud.setBody(metaHTML(est) + '<p class="hud-note">Serie insuficiente para el análisis.</p>'); return; }

  const vals = pares.map((p) => p[1]);
  const an = analizar(vals);
  const m = an.stats;

  let html = metaHTML(est);
  html += `<div class="hud-kv">
    <div><span>Registro</span><b>${pares[0][0]}–${pares[pares.length - 1][0]} (${pares.length} años)</b></div>
    <div><span>Media · Desv.</span><b>${f(m.mean)} · ${f(m.std)} ${uni}</b></div>
    <div><span>Mín · Máx</span><b>${f(Math.min(...vals))} · ${f(Math.max(...vals))} ${uni}</b></div></div>`;
  html += `<div class="hud-sec">Máximos anuales (${uni})</div>${barras(pares, uni)}`;
  html += `<div class="hud-sec">Ajuste de distribuciones (mejor: <b>${DIST[an.mejor]}</b>)</div>${tablaDist(an, uni)}`;
  if (onLink) html += `<button class="hud-link" id="hud-hidro">Ver en pestaña Hidrología →</button>`;
  hud.setBody(html);
  if (onLink) hud.body.querySelector('#hud-hidro')?.addEventListener('click', () => onLink(est));
}

function metaHTML(est) {
  return `<div class="hud-kv">
    <div><span>BNA · tipo</span><b>${est.bna} · ${est.tipo === 'fluviometrica' ? 'fluviométrica' : 'pluviométrica'}</b></div>
    <div><span>Ubicación</span><b>${est.lat.toFixed(4)}, ${est.lon.toFixed(4)}</b></div>
    ${est.dist != null ? `<div><span>Distancia</span><b>${est.dist.toFixed(1)} km</b></div>` : ''}</div>`;
}

// Gráfico de barras de la serie por año.
function barras(pares, uni) {
  const W = 380, H = 120, pad = 22;
  const vals = pares.map((p) => p[1]), ymax = Math.max(...vals) || 1, n = pares.length;
  const bw = (W - 2 * pad) / n;
  const bars = pares.map(([, v], i) => {
    const bh = (v / ymax) * (H - 2 * pad), x = pad + i * bw, y = H - pad - bh;
    return `<rect x="${(x + 0.3).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 0.8).toFixed(1)}" height="${bh.toFixed(1)}" fill="var(--accent)" opacity="0.85"/>`;
  }).join('');
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${bars}
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)" stroke-width="1"/>
    <text x="${pad}" y="${H - 6}" font-size="9" fill="var(--text2)">${pares[0][0]}</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="9" fill="var(--text2)">${pares[pares.length - 1][0]}</text>
    <text x="${pad}" y="12" font-size="9" fill="var(--text2)">máx ${f(ymax)} ${uni}</text>
  </svg>`;
}

// Tabla de distribuciones: R², χ², cuantiles Q10 / Q100. Resalta la mejor.
function tablaDist(an, uni) {
  const rows = Object.entries(an.resultados).map(([k, r]) => {
    const best = k === an.mejor;
    return `<tr${best ? ' class="hl"' : ''}><td>${DIST[k]}${best ? ' ★' : ''}</td>
      <td>${r.r2.toFixed(3)}</td><td>${r.chi2.toFixed(1)}${r.aceptado ? '' : '✗'}</td>
      <td>${f(r.quantiles[10])}</td><td>${f(r.quantiles[100])}</td></tr>`;
  }).join('');
  return `<table class="hud-tbl"><thead><tr><th>Distribución</th><th>R²</th><th>χ²</th><th>T10</th><th>T100</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="hud-note">Cuantiles en ${uni}. ✗ = rechaza χ² (α=0.05). ★ = mejor ajuste (menor χ² entre las aceptadas).</p>`;
}
