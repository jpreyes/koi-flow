// ─────────────────────────────────────────────────────────────────────────────
// estacion_hud.js — HUD de una estación DGA (koi-flow). Al pinchar una estación se
// abre un HUD flotante con: metadatos, la serie de máximos anuales EDITABLE, la
// importación/exportación CSV, los estadísticos, el gráfico y el ajuste de las
// distribuciones del MC con SELECCIÓN de la que gobierna (y aviso si extrapola muy
// por encima del máximo observado). Reutiliza cargarSerie (dga.js) y analizar.
// ─────────────────────────────────────────────────────────────────────────────
import { cargarSerie, setSerieOverride, setDistOverride } from './dga.js?v=13';
import { analizar } from '../hidro/frecuencia.js?v=13';
import { KoiDataError } from './fetch_json.js?v=13';

const f = (v) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)));
const DIST = { normal: 'Normal', lognormal: 'Log-Normal', pearson3: 'Pearson III', logpearson3: 'Log-Pearson III', gumbel: 'Gumbel', gamma: 'Gamma' };

export async function abrirEstacionHUD(huds, est, { onLink } = {}) {
  const fluvio = est.tipo === 'fluviometrica';
  const uni = fluvio ? 'm³/s' : 'mm';
  const id = 'est_' + est.bna + '_' + est.tipo;
  const hud = huds.open(id, { title: `${fluvio ? '🌊' : '🌧'} ${est.nombre}`, w: 440, h: 560 });
  if (hud._estWired) { hud.focus?.(); return hud; }
  hud._estWired = true;

  hud.setBody(metaHTML(est) + '<p class="hud-note">Cargando serie…</p>');
  // Estado del HUD: pares [año, valor], distribución elegida ('auto' = mejor).
  const estado = { pares: [], dist: 'auto', uni, est, fluvio, onLink };
  try {
    const raw = await cargarSerie(est);   // devuelve la serie editada/importada si existe
    const so = raw?.serie ?? raw;
    estado.pares = paresDe(so);
  } catch (e) {
    const msg = e instanceof KoiDataError ? e.message : 'No hay serie descargada para esta estación.';
    hud.setBody(metaHTML(est) +
      `<p class="hud-note" style="color:var(--red)">${msg}</p>` +
      `<p class="hud-note">Puedes <b>importar</b> o <b>pegar</b> tu propia serie:</p>` + editorHTML([], uni));
    wire(hud, estado);
    return hud;
  }
  render(hud, estado);
  return hud;
}

// Convierte {año:valor} | [valores] → [[año, valor]] ordenado y válido.
function paresDe(so) {
  return (Array.isArray(so) ? so.map((v, i) => [i + 1, +v]) : Object.entries(so || {}).map(([y, v]) => [+y, +v]))
    .filter((p) => isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0]);
}

// Parsea el texto del editor: líneas "año<sep>valor" (coma/tab/espacio/;) o solo valores.
function parsearTexto(txt) {
  const out = [];
  for (const linea of (txt || '').split(/\r?\n/)) {
    const s = linea.trim(); if (!s || /^(a[ñn]o|year)/i.test(s)) continue;
    const parts = s.split(/[\s,;\t]+/).map(Number).filter((x) => isFinite(x));
    if (parts.length >= 2) out.push([parts[0], parts[1]]);
    else if (parts.length === 1) out.push([out.length + 1, parts[0]]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function render(hud, estado) {
  const { pares, uni, est } = estado;
  if (pares.length < 3) {
    hud.setBody(metaHTML(est) + '<p class="hud-note">Serie insuficiente (mín. 3 años). Edita o importa datos:</p>' + editorHTML(pares, uni));
    wire(hud, estado); return;
  }
  const vals = pares.map((p) => p[1]);
  const an = analizar(vals);
  const distKey = estado.dist === 'auto' ? an.mejor : estado.dist;
  const dr = an.resultados[distKey];
  const maxObs = Math.max(...vals);
  const q100 = dr?.quantiles?.[100];
  const alerta = q100 && q100 > 2.2 * maxObs;

  const pocosAnios = pares.length < 20;   // MC V3 / DGA: mínimo ~20 años para frecuencia
  let html = metaHTML(est);
  html += `<div class="hud-kv">
    <div><span>Registro</span><b style="${pocosAnios ? 'color:var(--coral,#ef6c5a)' : ''}">${pares[0][0]}–${pares[pares.length - 1][0]} (${pares.length} años)</b></div>
    <div><span>Media · Desv.</span><b>${f(an.stats.mean)} · ${f(an.stats.std)} ${uni}</b></div>
    <div><span>Mín · Máx observado</span><b>${f(Math.min(...vals))} · ${f(maxObs)} ${uni}</b></div></div>`;
  if (pocosAnios) html += `<p class="hud-note" style="color:var(--coral,#ef6c5a)">⚠ Solo ${pares.length} años: el Manual de Carreteras (V3) pide <b>≥ 20 años</b> para un análisis de frecuencia confiable. Los cuantiles son poco robustos.</p>`;
  html += `<div class="hud-sec">Máximos anuales (${uni})</div>${barras(pares, uni)}`;
  html += editorHTML(pares, uni);
  html += `<div class="hud-sec">Distribución que gobierna</div>
    <select id="est-dist" class="hud-select">
      <option value="auto"${estado.dist === 'auto' ? ' selected' : ''}>Automática (mejor ajuste: ${DIST[an.mejor]})</option>
      ${Object.keys(an.resultados).map((k) => `<option value="${k}"${estado.dist === k ? ' selected' : ''}>${DIST[k]}</option>`).join('')}
    </select>`;
  html += `<div class="hud-kv" style="margin-top:6px">
    <div><span>Q100 · ${DIST[distKey]}</span><b>${f(q100)} ${uni}</b></div>
    <div><span>Q10 · Q200</span><b>${f(dr?.quantiles?.[10])} · ${f(dr?.quantiles?.[200])} ${uni}</b></div></div>`;
  html += `<div class="hud-sec">Gráfico de ajuste (observado vs ${DIST[distKey]})</div>${graficoAjuste(vals, uni, distKey)}`;
  if (alerta) html += `<p class="hud-note" style="color:var(--coral,#ef6c5a)">⚠ El Q100 (${f(q100)}) supera <b>2×</b> el máximo observado (${f(maxObs)}). Esta distribución extrapola agresivamente; en series con crecidas atípicas suele ser más realista <b>Gumbel</b> o <b>Log-Pearson III</b>. Compara abajo.</p>`;
  html += `<div class="hud-sec">Ajuste de las distribuciones</div>${tablaDist(an, distKey, uni)}`;
  if (estado.onLink) html += `<button class="hud-link" id="hud-hidro">Ver en pestaña Hidrología →</button>`;
  hud.setBody(html);
  wire(hud, estado);
}

// Editor de la serie: textarea + importar/exportar/recalcular.
function editorHTML(pares, uni) {
  const txt = pares.map(([y, v]) => `${y}\t${v}`).join('\n');
  return `<details class="bp-det" style="margin-top:8px"><summary>✎ Ver / editar / importar datos (${uni})</summary>
    <div class="bp-det-body">
      <p class="hud-note">Un año por línea: <code>año valor</code> (separador: espacio, coma o tab). Pega desde Excel/CSV o edita a mano.</p>
      <textarea id="est-datos" class="est-ta" spellcheck="false" rows="7">${txt}</textarea>
      <div class="bp-btns" style="margin-top:6px">
        <button class="bp-b" id="est-recalc">↻ Recalcular</button>
        <button class="bp-b" id="est-import">📥 Importar CSV</button>
        <button class="bp-b" id="est-export">⬇ Exportar CSV</button>
      </div>
      <input type="file" id="est-csv" accept=".csv,.txt" hidden>
    </div></details>`;
}

function wire(hud, estado) {
  const $ = (s) => hud.body.querySelector(s);
  $('#est-dist')?.addEventListener('change', (e) => {
    estado.dist = e.target.value;
    setDistOverride(estado.est, estado.dist);   // el pipeline usará esta distribución
    render(hud, estado);
  });
  $('#hud-hidro')?.addEventListener('click', () => estado.onLink?.(estado.est));

  const recalc = () => {
    const nuevos = parsearTexto($('#est-datos')?.value || '');
    if (nuevos.length < 3) { alert('Se necesitan al menos 3 años válidos.'); return; }
    estado.pares = nuevos;
    // Registra el override en dga.js → lo usan este HUD Y el pipeline (cargarSerie).
    setSerieOverride(estado.est, Object.fromEntries(nuevos));
    render(hud, estado);
  };
  $('#est-recalc')?.addEventListener('click', recalc);
  $('#est-import')?.addEventListener('click', () => $('#est-csv')?.click());
  $('#est-csv')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const ta = $('#est-datos'); if (ta) { ta.value = await file.text(); recalc(); }
  });
  $('#est-export')?.addEventListener('click', () => {
    const csv = 'anio,valor\n' + estado.pares.map(([y, v]) => `${y},${v}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${estado.est.bna}_${estado.est.tipo}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

function metaHTML(est) {
  return `<div class="hud-kv">
    <div><span>BNA · tipo</span><b>${est.bna} · ${est.tipo === 'fluviometrica' ? 'fluviométrica' : 'pluviométrica'}</b></div>
    <div><span>Ubicación</span><b>${est.lat.toFixed(4)}, ${est.lon.toFixed(4)}</b></div>
    ${est.dist != null ? `<div><span>Distancia</span><b>${est.dist.toFixed(1)} km</b></div>` : ''}</div>`;
}

// Gráfico de barras de la serie por año.
function barras(pares, uni) {
  const W = 400, H = 120, pad = 22;
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

// Gráfico de ajuste: puntos observados (posición de Weibull) vs la CURVA de la
// distribución elegida, en eje de período de retorno (log). Deja VER la cola: una
// distribución que se dispara arriba (Log-Normal) extrapola de más; una que sigue
// a los puntos (Gamma / Log-Pearson) es más creíble.
function graficoAjuste(valsAsc, uni, distKey) {
  const vals = valsAsc.slice().sort((a, b) => a - b);
  const n = vals.length;
  // Weibull: el i-ésimo ascendente (0..n-1) es el (n-i)-ésimo mayor → T=(n+1)/(n-i).
  const obs = vals.map((v, i) => ({ T: (n + 1) / (n - i), Q: v }));
  const Tden = [1.25, 1.5, 2, 3, 5, 7, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500];
  const an = analizar(vals, { T: Tden });
  const fit = Tden.map((T) => ({ T, Q: an.resultados[distKey].quantiles[T] })).filter((p) => isFinite(p.Q) && p.Q >= 0);
  const W = 400, H = 170, pL = 40, pR = 12, pT = 12, pB = 26;
  const Tmin = 1.05, Tmax = 500;
  const maxObs = Math.max(...vals);
  // Escala al DATO observado (×1.6), no a la curva: así una distribución que
  // extrapola muy por encima de los puntos se DISPARA fuera del cuadro (se ve).
  const ymax = maxObs * 1.6 || 1;
  const lx = (T) => pL + (Math.log10(T) - Math.log10(Tmin)) / (Math.log10(Tmax) - Math.log10(Tmin)) * (W - pL - pR);
  const ly = (Q) => Math.max(pT - 2, H - pB - (Q / ymax) * (H - pT - pB));   // clamp al techo
  const ticks = [2, 5, 10, 25, 50, 100, 200, 500];
  const grid = ticks.map((T) => `<line x1="${lx(T).toFixed(1)}" y1="${pT}" x2="${lx(T).toFixed(1)}" y2="${H - pB}" stroke="var(--border2)" stroke-width="0.5" opacity="0.5"/>
    <text x="${lx(T).toFixed(1)}" y="${H - 8}" font-size="8" fill="var(--text2)" text-anchor="middle">${T}</text>`).join('');
  const linea = fit.map((p, i) => `${i ? 'L' : 'M'}${lx(p.T).toFixed(1)},${ly(p.Q).toFixed(1)}`).join(' ');
  const puntos = obs.map((p) => `<circle cx="${lx(p.T).toFixed(1)}" cy="${ly(p.Q).toFixed(1)}" r="2.1" fill="var(--teal,#31c3ce)" opacity="0.9"/>`).join('');
  const yl = [0, ymax / 2, ymax].map((v) => `<text x="${pL - 4}" y="${(ly(v) + 3).toFixed(1)}" font-size="8" fill="var(--text2)" text-anchor="end">${f(v)}</text>`).join('');
  const yMaxObs = ly(maxObs);
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    ${grid}${yl}
    <line x1="${pL}" y1="${yMaxObs.toFixed(1)}" x2="${W - pR}" y2="${yMaxObs.toFixed(1)}" stroke="var(--coral,#ef6c5a)" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.8"/>
    <text x="${W - pR}" y="${(yMaxObs - 3).toFixed(1)}" font-size="7.5" fill="var(--coral,#ef6c5a)" text-anchor="end">máx registrado</text>
    <line x1="${pL}" y1="${H - pB}" x2="${W - pR}" y2="${H - pB}" stroke="var(--border2)"/>
    <line x1="${pL}" y1="${pT}" x2="${pL}" y2="${H - pB}" stroke="var(--border2)"/>
    <path d="${linea}" fill="none" stroke="var(--accent)" stroke-width="1.8"/>
    ${puntos}
    <text x="${(W / 2).toFixed(0)}" y="${H - 1}" font-size="8" fill="var(--text2)" text-anchor="middle">Período de retorno T [años]</text>
    <text x="${pL + 4}" y="${pT + 8}" font-size="8" fill="var(--text2)">${uni}</text></svg>
    <p class="hud-note">● observado (Weibull) · línea = ${DIST[distKey]}. Si la línea se dispara sobre los puntos en la cola (T grande), la distribución <b>extrapola de más</b>.</p>`;
}

// Tabla de distribuciones: R², χ², cuantiles Q10 / Q100. Resalta la elegida.
function tablaDist(an, distKey, uni) {
  const rows = Object.entries(an.resultados).map(([k, r]) => {
    const sel = k === distKey;
    return `<tr${sel ? ' class="hl"' : ''}><td>${DIST[k]}${sel ? ' ◄' : ''}</td>
      <td>${r.r2.toFixed(3)}</td><td>${r.chi2.toFixed(1)}${r.aceptado ? '' : '✗'}</td>
      <td>${f(r.quantiles[10])}</td><td>${f(r.quantiles[100])}</td></tr>`;
  }).join('');
  return `<table class="hud-tbl"><thead><tr><th>Distribución</th><th>R²</th><th>χ²</th><th>T10</th><th>T100</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="hud-note">Cuantiles en ${uni}. ✗ = rechaza χ² (α=0.05). ◄ = la que gobierna (elígela arriba).</p>`;
}
