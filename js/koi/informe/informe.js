// ─────────────────────────────────────────────────────────────────────────────
// informe.js — generador del INFORME hidrológico-hidráulico (koi-flow).
// Sigue la estructura de capítulos del informe de referencia "03 Hidrología e
// Hidráulica S17" (Hidrología · Hidráulico · Socavaciones) y agrega el capítulo
// 4 "Diseño y Verificación de Obras" (alcantarillas HDS-5, puente en presión,
// enrocado, verificaciones normativas, sísmica de estribos, rotura de presa).
// Las fórmulas están PRERRENDERIZADAS en MathML (informe/formulas.js) — las
// formulaciones no cambian, solo se insertan bien tipografiadas.
// Los HUD publican sus resultados en `koi.reg.<modulo>` y el informe los lee;
// si un módulo no se corrió, la sección muestra la metodología + "pendiente".
// Documento HTML imprimible (→ PDF). Propiedad: JPReyes / Conmuta.cl.
// ─────────────────────────────────────────────────────────────────────────────
import { estacionesCercanas, cargarSerie } from '../datos/dga.js?v=6';
import { analizar } from '../hidro/frecuencia.js?v=6';
import { correrPipelinePunto } from '../hidro/pipeline.js?v=6';
import { F } from './formulas.js?v=6';
import { figuraCuencaMapa } from './mapa_fig.js?v=6';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d)));
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const MARCA = { autor: 'JPReyes', empresa: 'Conmuta.cl', logo: 'icons/icon-512.png' };
const DIST = { normal: 'Normal', lognormal: 'Log-Normal', pearson3: 'Pearson III', logpearson3: 'Log-Pearson III', gumbel: 'Gumbel', gamma: 'Gamma' };
const TS = [2, 5, 10, 25, 50, 100, 200];

// Abre la ventana YA (evita bloqueo de popups), corre el análisis y rellena.
export async function generarInforme(koi) {
  const w = window.open('', '_blank');
  if (!w) { (window.__koiToast || alert)('Permite las ventanas emergentes para ver el informe.'); return; }
  w.document.write('<p style="font:15px system-ui;padding:28px;color:#128aa5">Generando informe… corriendo el análisis de frecuencia.</p>');
  let datos = {};
  try { datos = await reunirDatos(koi); } catch (e) { console.warn('informe:', e.message); }
  w.document.open(); w.document.write(construir(koi, datos)); w.document.close();
}

function serieVals(raw) {
  const so = raw?.serie ?? raw;
  const arr = Array.isArray(so) ? so.map(Number) : Object.values(so || {}).map(Number);
  return arr.filter((v) => isFinite(v));
}
// Busca la estación patrón (pluvio y fluvio) con serie y corre el análisis de frecuencia.
async function reunirDatos(koi) {
  const pts = koi.map?.getPoints?.() || [];
  const c = pts[0] ? [pts[0].lon, pts[0].lat] : (koi.map?.map ? [koi.map.map.getCenter().lng, koi.map.map.getCenter().lat] : null);
  const out = {};
  if (!c) return out;
  for (const tipo of ['pluviometrica', 'fluviometrica']) {
    try {
      const cand = await estacionesCercanas(c, { tipo, n: 8, minAnios: 8 });
      for (const e of cand) {
        try { const raw = await cargarSerie(e); const s = serieVals(raw); if (s.length >= 5) { out[tipo === 'pluviometrica' ? 'pp' : 'fl'] = { est: e, an: analizar(s), n: s.length, raw }; break; } } catch { /* sin serie */ }
      }
    } catch { /* sin catálogo */ }
  }
  // figura de la cuenca sobre el satélite (tiles + polígono + punto) para la sección 1.6
  const pc = pts.find((p) => p.cuenca);
  if (pc?.cuenca) {
    try { out.mapaCuenca = await figuraCuencaMapa(pc.cuenca.polygonSuave || pc.cuenca.polygon, [pc.lon, pc.lat]); }
    catch (e) { console.warn('mapa cuenca:', e.message); }
  }

  const m = (pts.find((p) => p.cuenca)?.cuenca?.morfometria);
  if (m && out.pp?.raw) {
    let Apc = 0;
    if (out.fl?.est && koi.hydro?.delinearArea) { try { Apc = await koi.hydro.delinearArea(out.fl.est.lon, out.fl.est.lat) || 0; } catch { /* red no disponible */ } }
    const p0 = pts.find((p) => p.cuenca);
    const cfg = {
      nombre: p0?.nombre || 'punto', lat: p0?.lat ?? -20, morfometria: m, CN: 75, region: m.region || 'III', zonaHU: 1,
      pp: { estacion: out.pp.est.nombre, serie: out.pp.raw },
      fluvio: (out.fl?.raw && Apc > 0) ? { estacion: out.fl.est.nombre, serie: out.fl.raw, Apc } : null,
    };
    try { out.pipe = await correrPipelinePunto(cfg); out.Apc = Apc; } catch (e) { console.warn('pipeline informe:', e.message); }
  }
  return out;
}

// numeración jerárquica compartida (1, 1.1, 1.1.1 …)
function numerador() {
  const c = [0, 0, 0, 0];
  return (lvl, title) => { c[lvl - 1]++; for (let i = lvl; i < c.length; i++) c[i] = 0;
    const n = c.slice(0, lvl).join('.'); return `<h${lvl + 1} class="h${lvl}"><span class="hn">${n}</span> ${esc(title)}</h${lvl + 1}>`; };
}
const P = (html) => `<p>${html}</p>`;
const EQ = (mathml, nota) => `<div class="formula">${mathml}${nota ? `<div class="eq-nota">${nota}</div>` : ''}</div>`;
const ND = (t = 'Pendiente de ingreso de datos.') => `<p class="nd">${t}</p>`;
const FIGCAP = (t) => `<p class="figcap">${t}</p>`;
const KV = (pares) => tabla(['Magnitud', 'Valor'], pares);

// Contenido del informe (portada + capítulos + pie), reutilizable para pantalla y Word.
function contenido(koi, datos = {}) {
  const proj = koi.project || {};
  const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
  const H = numerador();
  const cuerpo = [
    `<section class="cap">${capHidrologia(koi, H, datos)}</section>`,
    `<section class="cap">${capHidraulico(koi, H)}</section>`,
    `<section class="cap">${capSocavacion(koi, H)}</section>`,
    `<section class="cap">${capObras(koi, H)}</section>`,
  ].join('\n');
  return `${portada(proj, fecha)}${cuerpo}${pieLicencia()}`;
}

export function construir(koi, datos = {}) {   // exportado para poder testear el documento sin abrir popup
  const proj = koi.project || {};
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>Informe hidrológico-hidráulico · ${esc(proj.name || 'koi-flow')}</title><style>${CSS}</style></head><body>
    <div class="toolbar no-print"><button onclick="window.print()">🖨 Imprimir / PDF</button>
      <span>koi-flow · ${MARCA.autor} / ${MARCA.empresa}</span></div>
    <main>${contenido(koi, datos)}</main></body></html>`;
}

// Exporta el informe a Word .docx REAL (ZIP + OOXML, ver informe/docx.js): las
// fórmulas van como OMML (matemática NATIVA de Word, editables) y las figuras
// SVG/snapshot rasterizadas a PNG incrustado. Todo in-house.
export async function generarInformeWord(koi) {
  const busy = window.__koiBusy?.start?.('Generando .docx…');
  try {
    let datos = {};
    try { datos = await reunirDatos(koi); } catch (e) { console.warn('informe word:', e.message); }
    const proj = koi.project || {};
    const { informeADocx } = await import('./docx.js?v=6');
    const blob = await informeADocx(contenido(koi, datos));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${(proj.name || 'informe').replace(/\s+/g, '_')}.docx`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    (window.__koiToast || (() => {}))('Informe .docx generado (fórmulas editables en Word).', 'ok');
  } catch (e) {
    (window.__koiToast || alert)('No se pudo generar el .docx: ' + e.message, 'error');
    console.error(e);
  } finally { window.__koiBusy?.end?.(busy); }
}

function portada(proj, fecha) {
  return `<section class="portada">
    <div class="p-banda"></div>
    <img src="icons/koi-symbol.svg" class="logo" alt="Koi-Flow" onerror="this.src='${MARCA.logo}'">
    <p class="p-tipo">Informe técnico</p>
    <h1>Estudio Hidrológico · Hidráulico<br>y de Socavaciones</h1>
    <h2>${esc(proj.name || 'Proyecto')}</h2>
    <p class="fecha">${fecha}</p>
    <div class="toc"><b>Contenido</b>
      <ol><li>Análisis Hidrológico</li><li>Estudio Hidráulico</li><li>Análisis de Socavaciones</li><li>Diseño y Verificación de Obras</li></ol></div>
    <div class="lic">Elaborado con <b>Koi-Flow</b> — software propiedad de <b>${MARCA.autor} / ${MARCA.empresa}</b>.
      Metodologías según Manual de Carreteras (MC-V3), DGA, FHWA (HDS-5 / HEC-18 / HEC-23) y AASHTO.
      Estructura basada en el informe tipo S17.</div></section>`;
}
function pieLicencia() {
  return `<section class="pie"><hr><p>© ${new Date().getFullYear()} <b>${MARCA.autor} / ${MARCA.empresa}</b> · Koi-Flow.
    Documento generado automáticamente; los resultados deben ser revisados por un profesional competente.</p></section>`;
}

// ═══ 1 · ANÁLISIS HIDROLÓGICO ═══════════════════════════════════════════════════
function capHidrologia(koi, H, datos = {}) {
  const est = koi.map?._stations || [];
  const reg = koi.reg || {};
  const pl = est.filter((e) => e.tipo === 'pluviometrica'), fl = est.filter((e) => e.tipo === 'fluviometrica');
  const cuencas = (koi.map?.getPoints?.() || []).filter((p) => p.cuenca);
  const m = cuencas[0]?.cuenca?.morfometria;
  const filaEst = (e) => [esc(e.nombre), e.bna, f(e.dist, 1) + ' km', e.n_anios ?? '—', esc(e.periodo || '—')];
  const cabEst = ['Estación', 'BNA', 'Distancia', 'Años', 'Periodo'];
  const ppAn = datos.pp?.an, flAn = datos.fl?.an;
  const resumenDist = (an) => tabla(['Distribución', 'R²', 'χ²', 'Aceptada'],
    an ? Object.entries(an.resultados).map(([k, r]) => [DIST[k], r.r2.toFixed(3), r.chi2.toFixed(1), r.aceptado ? '✓' : '✗']) : null);
  const cuantiles = (an, uni) => tabla(['T [años]', uni], an ? TS.map((T) => [T, f(an.resultados[an.mejor].quantiles[T])]) : null);
  const pipe = datos.pipe;
  let b = H(1, 'Análisis Hidrológico');

  b += H(2, 'Introducción');
  b += P('El presente estudio determina los caudales de crecida de diseño y su comportamiento hidráulico en el cruce. En las cuencas áridas del norte de Chile el análisis se apoya preferentemente en la <b>fluviometría</b> (transposición de crecidas y método directo) más que en las relaciones lluvia-escorrentía.');

  b += H(2, 'Antecedentes Hidrológicos');
  b += P('Se recopilan cartografía IGM 1:50.000, catastro de estaciones DGA (pluviométricas y fluviométricas) vía CR2, y el modelo de elevaciones para la delineación de cuencas.');

  b += H(2, 'Clima Zona en Estudio');
  b += P('Clima árido/semiárido; precipitaciones concentradas en eventos breves (invierno altiplánico). Se caracteriza la línea de nieves para separar el área pluvial aportante.');

  b += H(2, 'Hidrología e Hidrogeología');
  b += P('El régimen es predominantemente pluvial-crecidas en cabecera; los cauces pueden ser secos gran parte del año (régimen efímero).');

  b += H(2, 'Precipitación Máxima en 1, 2 y 3 días (DGA)');
  b += P('Precipitaciones máximas diarias y multidiarias de las estaciones representativas, base del análisis de frecuencia pluviométrico.');
  b += tabla(['Estación', 'PP 1 día', 'PP 2 días', 'PP 3 días'], pl.length ? pl.map((e) => [esc(e.nombre), '—', '—', '—']) : null);

  b += H(2, 'Cuencas Hidrográficas');
  b += P('La cuenca aportante se delinea por análisis de dirección de flujo <b>D8</b> sobre el DEM (llenado de depresiones → direcciones → acumulación → ajuste del exutorio → parteaguas).');
  if (m) {
    if (datos.mapaCuenca) b += `<img class="snap" src="${datos.mapaCuenca}" alt="Cuenca sobre satélite">` + FIGCAP('Cuenca aportante y punto de análisis sobre imagen satelital (mapa 2D).');
    b += `<div class="fig-row">${svgPoligono(cuencas[0].cuenca.polygonSuave || cuencas[0].cuenca.polygon, '#128aa5', 'rgba(18,138,165,.15)', [cuencas[0].lon, cuencas[0].lat])}
    ${tabla(['Parámetro', 'Valor'], [['Área A', m.A + ' km²'], ['Cauce principal L', m.L + ' km'], ['Long. al centroide Lg', m.Lg + ' km'], ['Pendiente media S', f(m.S * 100) + ' %'], ['Desnivel H', m.H + ' m'], ['Perímetro', m.perimetro_km + ' km']])}</div>` + FIGCAP('Croquis de la cuenca delineada (parteaguas D8) y morfometría.');
  } else b += ND('Delinea una cuenca para poblar esta sección.');

  b += H(2, 'Estaciones Pluviométricas');
  b += tabla(cabEst, pl.length ? pl.map(filaEst) : null);
  b += H(3, 'Modelo digital de elevaciones');
  b += P('DEM base tipo Terrarium (y batimetría CAD fusionada cuando existe) para morfometría, secciones y modelación.');
  { const png = koi.scene?.terrain ? koi.scene.snapshot?.() : null; if (png) b += `<img class="snap" src="${png}" alt="Relieve 3D">` + FIGCAP('Modelo 3D del sector (relieve + cauce).'); }

  b += H(2, 'Elección de la Estación Patrón');
  b += P('Se adopta como estación patrón la de mayor longitud de registro y representatividad, priorizando registro sobre cercanía.');

  b += H(2, 'Análisis de Datos Dudosos');
  b += P('Detección de datos dudosos altos/bajos por el criterio de <b>Grubbs-Beck</b> (WRC) sobre los logaritmos de la serie:');
  b += EQ(F.grubbs, 'con x en log₁₀; K<sub>N</sub> según el tamaño de muestra N');

  b += H(2, 'Relleno de Estadísticas');
  b += P('Relleno de faltantes por correlación con estaciones vecinas (razones/regresión) para homogeneizar el periodo.');

  b += H(2, 'Análisis de Frecuencia');
  b += P('Se ajustan las <b>6 distribuciones</b> del MC a la serie de máximos anuales y se calculan los cuantiles para los periodos de retorno de diseño (T = 2…300 años).');
  b += H(3, 'Modelo Normal'); b += EQ(F.normal);
  b += H(3, 'Modelo Log-Normal'); b += EQ(F.lognormal);
  b += H(3, 'Distribución Pearson III'); b += EQ(F.pearson3);
  b += H(3, 'Modelo Log-Pearson tipo III'); b += EQ(F.logpearson3);
  b += H(3, 'Modelo Valores Extremos tipo I (Gumbel)'); b += EQ(F.gumbel);
  b += H(3, 'Distribución Gamma'); b += EQ(F.gamma);

  b += H(2, 'Calidad del Ajuste — Coeficiente de Determinación R²');
  b += EQ(F.r2);

  b += H(2, 'Prueba de Bondad de Ajuste');
  b += P('Prueba χ² de Pearson (α = 0.05), gl = k − 1 − p:');
  b += EQ(F.chi2);

  b += H(2, 'Resultados del Análisis de Frecuencia');
  b += H(3, 'Parámetros de Distribuciones'); b += tabla(['Distribución', 'Parámetros'], [['Normal', 'μ, σ'], ['Log-Normal', 'μ_ln, σ_ln'], ['Pearson III', 'x̄, s, Cs'], ['Log-Pearson III', 'x̄_log, s_log, Cs_log'], ['Gumbel', 'x̄, s (Yn, Sn)'], ['Gamma', 'α, β']]);
  b += H(3, 'Resumen de Métodos');
  if (datos.pp) b += P(`Estación patrón pluviométrica: <b>${esc(datos.pp.est.nombre)}</b> (BNA ${datos.pp.est.bna}, ${datos.pp.n} años).`);
  b += resumenDist(ppAn);
  b += H(3, 'Análisis de Frecuencia Adoptada');
  b += P(ppAn ? `Se adopta la distribución de mejor ajuste (menor χ² entre las aceptadas): <b>${DIST[ppAn.mejor]}</b>.`
    : 'Se adopta la distribución de mejor ajuste (menor χ² entre las aceptadas). Coloca un punto de análisis para correr el ajuste automáticamente.');

  b += H(2, 'Precipitaciones de Diseño (según Análisis de Frecuencia)');
  b += cuantiles(ppAn, 'PP diseño [mm]');

  b += H(2, 'Curva de Intensidad – Duración – Frecuencia');
  b += P('IDF por coeficientes de duración/frecuencia (Grunsky) a partir de la PP diaria:');
  b += EQ(F.idf);

  b += H(2, 'Estimación de Caudales en Cuencas Sin Control Fluviométrico');
  b += H(3, 'Coeficiente de escorrentía'); b += P('C = f(uso de suelo, pendiente, T); método racional:'); b += EQ(F.racional);

  b += H(2, 'Línea de Nieve');
  b += P('Se determina la línea de nieves (Peña-Vidal) para separar el <b>área pluvial</b> aportante del área nival.');

  b += H(2, 'Áreas Aportantes');
  b += H(3, 'Forma de la Cuenca');
  b += H(4, 'Índice de Gravelius o coeficiente de compacidad (Kc)'); b += EQ(F.kc, m ? `K<sub>c</sub> = <b>${m.Kc}</b>` : '');
  b += H(4, 'Factor de forma (Kf)'); b += EQ(F.kf, m ? `K<sub>f</sub> = <b>${f(m.A / (m.L * m.L))}</b>` : '');
  const tc = m ? tcTabla(m) : null;
  b += H(4, 'Método de California'); b += EQ(F.tcCalifornia, tcVal(tc, 'California'));
  b += H(4, 'Método de Giandotti'); b += EQ(F.tcGiandotti, tcVal(tc, 'Giandotti'));
  b += H(4, 'Normas Españolas'); b += EQ(F.tcNormas, tcVal(tc, 'Normas'));
  b += H(4, 'Método SCS (1975)'); b += EQ(F.tcSCS, tcVal(tc, 'SCS'));
  b += H(4, 'Método de Kirpich'); b += EQ(F.tcKirpich, tcVal(tc, 'Kirpich'));
  if (tc) b += tabla(['Método', 't_c [h]'], tc.metodos.map((x) => [x.metodo, x.aplica && isFinite(x.tc) ? x.tc.toFixed(2) : '—'])).replace('</table>', `</table><p class="nd">t_c adoptado (máx): <b>${isFinite(tc.adoptado) ? tc.adoptado.toFixed(2) + ' h' : '—'}</b></p>`);

  b += H(2, 'Determinación de Caudales Máximos');
  b += H(3, 'Método Racional'); b += EQ(F.racional);
  b += H(3, 'Método Verni-King (modificado)'); b += EQ(F.verniking);
  b += H(3, 'Método DGA');
  b += H(4, 'Determinación de Zona Homogénea'); b += P('Se clasifica la cuenca en la zona homogénea correspondiente (coeficientes regionales DGA-AC).');
  b += H(4, 'Caudal Medio Diario Máximo T=10 años'); b += EQ(F.dgaQmd);
  b += H(4, 'Factor de conversión y Caudal Instantáneo Máximo'); b += EQ(F.dgaInst);
  b += H(3, 'Hidrograma Unitario Sintético tipo Linsley'); b += EQ(F.linsley);

  b += H(2, 'Resumen de Caudales — Estudio Pluviométrico');
  if (pipe?.caudales?.pluvial?.metodos?.length) {
    const met = pipe.caudales.pluvial.metodos;
    b += P(`Métodos aplicables: ${esc(pipe.caudales.pluvial.aplicables?.join(', ') || '—')}. En zona árida son <b>referenciales</b> (gobierna la fluviometría).`);
    b += tabla(['T [años]', ...met.map((x) => x.metodo)], TS.map((T) => [T, ...met.map((x) => f(x.valores?.[T]?.Q))]));
  } else b += tabla(['Método', 'Q(T=100) [m³/s]'], [['Racional', '—'], ['Verni-King', '—'], ['DGA-AC', '—'], ['HU Linsley', '—']]);

  b += H(2, 'Obtención de Caudales por Método Directo — Fluviometría');
  b += H(3, 'Introducción'); b += P('En zona árida <b>gobierna la fluviometría</b>: se analiza la serie de la estación de control y se transpone a la cuenca del tramo.');
  b += H(3, 'Análisis de Datos Dudosos'); b += H(4, 'Relleno de Estadísticas'); b += P('Igual criterio Grubbs-Beck y relleno por correlación aplicado a la serie de caudales.');
  b += H(3, 'Análisis Probabilístico para Estudio Fluviométrico');
  b += H(4, 'Resultados de análisis de frecuencias');
  if (datos.fl) b += P(`Estación de control fluviométrica: <b>${esc(datos.fl.est.nombre)}</b> (BNA ${datos.fl.est.bna}, ${datos.fl.n} años) · mejor ajuste: <b>${DIST[flAn.mejor]}</b>.`);
  b += cuantiles(flAn, 'Q [m³/s]');
  b += H(4, 'Test de Bondad de Ajuste'); b += P('χ² y R² por distribución (ver HUD de la estación fluviométrica).');
  b += H(3, 'Transposición de Caudales'); b += EQ(F.transposicion);
  const tr = pipe?.caudales?.transposicion;
  if (tr) {
    b += P(`Estación patrón <b>${esc(tr.estacion)}</b> (A<sub>pc</sub> = ${f(tr.Apc)} km²) → cuenca del tramo (A<sub>px</sub> = ${f(tr.Apx)} km²), distribución <b>${esc(tr.distribucion)}</b>.`);
    b += tabla(['T [años]', 'Q patrón [m³/s]', 'Factor', 'Q transpuesto [m³/s]'], TS.map((T) => [T, f(tr.Qc?.[T]), f(tr.factor?.[T], 3), f(tr.Qx?.[T])]));
  } else b += P('Para transponer se requiere la cuenca del tramo y una estación fluviométrica con serie (y el área de su cuenca de control, delineable automáticamente).');
  b += `<h4 class="h3">Estaciones fluviométricas de control</h4>` + tabla(cabEst, fl.length ? fl.map(filaEst) : null);

  b += H(2, 'Caudales Adoptados');
  const adop = pipe?.caudales?.adopcion;
  if (adop?.tabla) {
    b += P(`Gobierna: <b>${esc(adop.gobiernaMetodo)}</b>. ${esc(adop.nota || '')}`);
    b += tabla(['T [años]', 'Q adoptado [m³/s]', 'Método que gobierna'], adop.tabla.map((r) => [r.T, f(r.adoptado), esc(r.gobierna || '—')]));
  } else if (flAn) {
    b += tabla(['T [años]', 'Q adoptado [m³/s]', 'Origen'], [10, 100, 200].map((T) => [T, f(flAn.resultados[flAn.mejor].quantiles[T]), 'fluviometría · ' + esc(datos.fl.est.nombre)]));
  } else b += tabla(['T [años]', 'Q adoptado [m³/s]', 'Origen'], null);

  // ── Módulos HMS-lite (nuevos) ────────────────────────────────────────────────
  b += H(2, 'Tormenta de Diseño (Hietograma)');
  b += P('El hietograma de diseño se construye por el <b>método de bloques alternos</b> a partir de la curva IDF (coeficientes de duración de la estación): la profundidad acumulada a cada duración es P<sub>24</sub>·C<sub>D</sub>(t) y la diferencia entre duraciones consecutivas da el incremento de cada bloque, que se ordena con el mayor al centro alternando a los lados. En zona árida el resultado es <b>referencial</b> (la crecida la gobierna la fluviometría); sirve para la forma del hidrograma y el tránsito.');
  b += EQ(F.bloquesAlternos, 'ΔPₖ = incremento de lluvia del bloque k; Σ ΔPₖ = P₂₄·C_D(T_d)');
  const tm = reg.tormenta;
  if (tm) b += KV([['Método', tm.metodo === 'uniforme' ? 'uniforme' : 'bloques alternos'], ['Estación coef. IDF', esc(tm.estacion)], ['Período T', tm.T + ' años'], ['PP24 de diseño', f(tm.pp24) + ' mm'], ['Duración', f(tm.TdH, 0) + ' h · Δt ' + tm.dtMin + ' min'], ['Posición del peak r', f(tm.r, 2)], ['P total', f(tm.Ptotal) + ' mm'], ['Intensidad máx', f(tm.imax) + ' mm/h'], ...(tm.Qpico != null ? [['Q pico hidrograma', f(tm.Qpico) + ' m³/s'], ['Volumen escorrentía', f(tm.volMm3, 2) + ' hm³']] : [])]);
  else b += ND('Corre "Tormenta de diseño (hietograma)" en Análisis para poblar esta sección.');

  b += H(2, 'Hidrograma de Crecida — Convolución del HU');
  b += P('La tormenta de diseño se discretiza (bloques alternos), se descuenta la abstracción por <b>SCS-CN</b> y la lluvia efectiva se convoluciona con el hidrograma unitario sintético (Linsley) conservando la masa (V = P<sub>e</sub>·A):');
  b += EQ(F.scsCN); b += EQ(F.convolucion);
  const cv = reg.convolucion;
  if (cv) b += KV([['P total', f(cv.Ptotal) + ' mm'], ['Duración', f(cv.durH, 1) + ' h'], ['CN', cv.CN], ['Lluvia efectiva', f(cv.PeTotal) + ' mm'], ['Q pico', f(cv.Qpico) + ' m³/s'], ['t pico', f(cv.tPicoH, 1) + ' h'], ['Volumen', f(cv.volMm3, 3) + ' hm³']]);
  else b += ND('Corre "Hidrograma de crecida (HU)" en Análisis para poblar esta sección.');

  b += H(2, 'Tránsito de Crecidas en Cauce — Muskingum / Muskingum-Cunge');
  b += EQ(F.muskingum); b += EQ(F.cunge);
  const rt = reg.routing;
  if (rt) b += KV([['Método', esc(rt.metodo)], ['K', f(rt.K / 3600, 2) + ' h'], ['x', f(rt.x, 3)], ['Q pico entrada', f(rt.QpicoIn) + ' m³/s'], ['Q pico salida', f(rt.QpicoOut) + ' m³/s'], ['Atenuación', f(rt.atenPct, 1) + ' %'], ['Desfase', f(rt.desfaseH, 2) + ' h']]);
  else b += ND('Corre "Tránsito en cauce (Muskingum)" para poblar esta sección.');

  b += H(2, 'Red de Subcuencas (HMS-lite)');
  b += P('Los elementos (subcuenca → tramo → unión) se resuelven en orden topológico; cada subcuenca genera su hidrograma (SCS-CN + HU) y los tramos lo transitan (Muskingum-Cunge).');
  const rd = reg.red;
  if (rd) b += KV([['Elementos', rd.nElementos], ['Q pico en el cierre', f(rd.Qpico) + ' m³/s'], ['t pico', f(rd.tPicoH, 1) + ' h']]);
  else b += ND('Corre "Red de cuencas (HMS-lite)" para poblar esta sección.');

  b += H(2, 'Simulación Continua con Deshielo (índice grado-día)');
  b += P('Balance diario de humedad del suelo (cubeta con percolación y flujo base de reservorio lineal) más fusión nival por índice de temperatura:');
  b += EQ(F.gradoDia);
  const cn = reg.continuo;
  if (cn) b += KV([['Días simulados', cn.nDias], ['Q medio', f(cn.Qmedio) + ' m³/s'], ['Q máx', f(cn.Qmax) + ' m³/s'], ['SWE máx', f(cn.sweMax) + ' mm'], ['Fracción nival', f(cn.fracNival * 100, 1) + ' %']]);
  else b += ND('Corre "Continua + deshielo" para poblar esta sección.');

  b += H(2, 'Calibración de Parámetros (Nelder-Mead · NSE)');
  b += EQ(F.nse);
  const cb = reg.calibracion;
  if (cb) b += KV([['NSE inicial', f(cb.nse0, 3)], ['NSE calibrado', f(cb.nse, 3)], ['Iteraciones', cb.iter], ...(cb.params ? Object.entries(cb.params).map(([k, v]) => ['Parámetro ' + esc(k), f(v, 3)]) : [])]);
  else b += ND('Corre "Calibración (Nelder-Mead)" para poblar esta sección.');

  b += H(2, 'Transformada de Clark / ModClark (lluvia distribuida)');
  b += P('Traslación por histograma tiempo-área (isócronas) y ruteo por reservorio lineal; el sesgo espacial de la lluvia desplaza el pico:');
  b += EQ(F.clark);
  const mc = reg.modclark;
  if (mc) b += KV([['Tc', f(mc.Tc, 1) + ' h'], ['R', f(mc.R, 1) + ' h'], ['Bandas', mc.Nb], ['Q pico', f(mc.Qpico) + ' m³/s'], ['t pico', f(mc.tPicoH, 1) + ' h']]);
  else b += ND('Corre "ModClark grillado" para poblar esta sección.');
  return b;
}

// ═══ 2 · ESTUDIO HIDRÁULICO ═════════════════════════════════════════════════════
function capHidraulico(koi, H) {
  const bt = koi.bati, secs = bt?.secciones || [];
  let b = H(1, 'Estudio Hidráulico');
  b += H(2, 'Introducción');
  b += P('El eje hidráulico se resuelve en régimen permanente (1D) por el método del <b>paso estándar</b> y, en 2D, por <b>onda difusiva</b> (flujo lento/subcrítico) o por las <b>ecuaciones de aguas someras completas</b> (momentum — resaltos, flujo supercrítico, rotura de presa).');

  b += H(2, 'Antecedentes');
  b += H(3, 'Geomorfología del cauce');
  b += P(bt?._flujo ? `Dirección del flujo: <b>${esc(bt._flujo.arriba?.nombre || '—')} → ${esc(bt._flujo.abajo?.nombre || '—')}</b>; pendiente media J = ${f(bt._flujo.Jmedia, 4)} (${f(bt._flujo.Jmedia * 100)} %).` : 'Traza el eje y las secciones para caracterizar el cauce.');
  b += H(3, 'Topografía del Cauce');
  b += P('Batimetría CAD (DXF) colocada a escala y/o DEM base del terreno; secciones extraídas del modelo.');

  b += H(2, 'Parámetros y Criterios Principales');
  b += H(3, 'Pérdidas de Energía por Fricción'); b += EQ(F.manning);
  b += H(3, 'Pérdidas por Contracción y Expansión'); b += EQ(F.contraccion, 'C = 0.1 (contracción) / 0.3 (expansión); 0.3/0.5 en puentes');
  b += H(3, 'Datos de Flujo Permanente'); b += EQ(F.energia);
  b += H(3, 'Período de Retorno y Caudal de Diseño'); b += P('Se adopta el caudal de diseño según el periodo de retorno normativo de la obra (MC): habitualmente T = 100 años (verificación T = 200).');

  b += H(2, 'Resultados Modelación Hidráulica');
  b += H(3, 'Situación Existente');
  if (bt?._remanso) b += `<h4 class="h3">Eje hidráulico longitudinal</h4>${svgPerfil(bt._remanso)}` + FIGCAP('Perfil longitudinal: lecho y eje hidráulico (WSE).');
  if (secs.length) {
    b += `<h4 class="h3">Secciones transversales (${secs.length})</h4>`;
    for (const s of secs) {
      if (!s.res) continue;
      b += `<div class="sec-card"><h5 class="h4">${esc(s.nombre)}${s.res.fuente2D ? ' · WSE del 2D' : ''}</h5>${svgSeccion(s)}
        ${KV([['WSE', f(s.res.WSE) + ' m'], ['Prof. máx', f(s.res.profMax) + ' m'], ['Ancho B', f(s.res.B) + ' m'], ['Área A', f(s.res.A) + ' m²'], ['V', f(s.res.V) + ' m/s'], ['Fr', f(s.res.Fr) + ' (' + esc(s.res.regimen || '') + ')'],
          ...(s.obstr ? [['Angostado por pilas', `B ${f(s.res.B)}→${f(s.obstr.Bef)} m · V→${f(s.obstr.Vobs)} m/s`]] : [])])}</div>`;
    }
  } else b += ND('Traza secciones y calcula el eje (pestaña Hidráulica).');

  // 2D difusiva
  const mesh = bt?.mesh2d, r2 = bt?.result2d;
  b += H(3, 'Modelación Bidimensional — Onda Difusiva');
  b += EQ(F.difusiva);
  if (mesh) {
    b += svgMalla(mesh) + FIGCAP(`Malla de cálculo — ${mesh.meta.nTri} triángulos, refinada en el cauce.`);
    if (r2) b += svgInundacion(mesh, r2) + FIGCAP(`Mancha de inundación (h máx ${f(r2.hmax)} m).`) +
      KV([['Calado máx', f(r2.hmax) + ' m'], ['Velocidad máx', f(r2.Vmax) + ' m/s'], ['Nodos mojados', r2.nMojados + ' / ' + mesh.nodes.length],
        ...(r2.solver ? [['Solver lineal', esc(r2.solver)]] : [])]);
  } else b += ND('Genera la malla y simula (pestaña Hidráulica → 2D).');

  // 2D momentum
  b += H(3, 'Modelación Bidimensional — Aguas Someras Completas (Momentum)');
  b += P('Volúmenes finitos tipo Godunov con solver de Riemann <b>HLL</b> y reconstrucción hidrostática bien-balanceada (Audusse 2004); captura resaltos hidráulicos, flujo supercrítico y frentes de onda:');
  b += EQ(F.saintvenant);
  const rm = bt?.resultMom2d;
  if (rm) {
    if (mesh) b += svgInundacion(mesh, rm) + FIGCAP(`Momentum 2D — mancha de inundación (h máx ${f(rm.hmax)} m).`);
    b += KV([['Calado máx', f(rm.hmax) + ' m'], ['Velocidad máx', f(rm.Vmax) + ' m/s'], ['Pasos (CFL adaptativo)', rm.pasos], ['Tiempo simulado', f(rm.t, 0) + ' s'],
      ...(rm.tArrMin != null ? [['Primer arribo de onda', f(rm.tArrMin, 0) + ' s']] : [])]);
  } else b += ND('Corre "Simular Momentum 2D" (pestaña Hidráulica → 2D).');

  // Peligrosidad
  b += H(3, 'Peligrosidad Hidráulica (h·V)');
  b += P('Clasificación combinada de peligrosidad <b>ARR/Australian</b> (Smith et al. 2014): producto calado·velocidad con topes de h y V → clases H1 (seguro) … H6 (colapso de construcciones):');
  b += EQ(F.hazard);
  const pel = (bt?.resultMom2d?._pel) || (bt?.result2d?._pel);
  if (pel) {
    const cc = pel.conteo;
    b += tabla(['Clase', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'], [['Nodos', cc.H1, cc.H2, cc.H3, cc.H4, cc.H5, cc.H6]]);
    b += P(`h·V máximo: <b>${f(pel.hvMax)} m²/s</b> → clase <b>${pel.clasePico.clase}</b> (${esc(pel.clasePico.desc)}).`);
  } else b += ND('Simula el 2D para clasificar la peligrosidad.');

  b += H(3, 'Situación Proyectada');
  b += P('Incorpora las estructuras (puente/alcantarilla): en 1D angostan la sección (y fijan la cota inferior del tablero); en 2D se integran como modificación del terreno (el flujo las rodea).');
  const es = koi.estr?.estructuras || [];
  if (es.length) b += tabla(['Estructura', 'Tipo', 'Cota base', 'Parámetros'], es.map((e) => [esc(e.nombre), e.solido ? 'sólida' : 'pasa', e.zBase != null ? f(e.zBase) + ' m' : '—', Object.entries(e.params).map(([k, v]) => `${k}=${f(v)}`).join(', ')]));
  return b;
}

// ═══ 3 · ANÁLISIS DE SOCAVACIONES ═══════════════════════════════════════════════
function capSocavacion(koi, H) {
  const reg = koi.reg || {};
  const secs = (koi.bati?.secciones || []).filter((s) => s.soc);
  let b = H(1, 'Análisis de Socavaciones');
  b += H(2, 'Generalidades');
  b += P('La socavación total se estima como la suma de la socavación <b>general</b> (por contracción del cauce) y la socavación <b>local</b> en las pilas/estribos. Se evalúan varios métodos y se adopta la envolvente (criterio MC).');

  b += H(2, 'Antecedentes Granulométricos');
  b += P('Granulometría del lecho por estratos (D<sub>50</sub>, D<sub>84</sub>) y profundidad de la roca (tope de socavación). Se ingresa por sección en la pestaña Hidráulica.');
  if (secs.length) b += tabla(['Sección', 'D50 [mm]', 'T [años]'], secs.map((s) => [esc(s.nombre), f(s.D50mm), f(s.T)]));

  b += H(2, 'Socavación General');
  b += H(3, 'Método de Lischtvan – Levediev'); b += EQ(F.lischtvan, 'α = Q / (H<sub>m</sub><sup>5/3</sup>·B<sub>e</sub>·μ) — se evalúa por vertical y por franjas, con la D₅₀ del estrato y tope en la roca.');
  b += H(3, 'Método de Neill'); b += EQ(F.neill);

  b += H(3, 'Socavación Local en Pilas');
  b += EQ(F.hec18pila, 'Se comparan ≥ 4 métodos del MC (HEC-18/CSU, Froehlich, Laursen-Toch, Breusers, Larras) y se adopta el máximo.');

  b += H(3, 'Socavación Local en Estribos');
  b += P('Según la relación longitud/calado (L′/y<sub>a</sub>) se aplica <b>Froehlich</b> (L′/y<sub>a</sub> &lt; 25) o <b>HIRE</b> (≥ 25):');
  b += EQ(F.froehlichEstribo); b += EQ(F.hireEstribo);
  const eb = reg.estribo;
  if (eb) b += KV([['Método aplicado', esc(eb.metodo)], ['L′/ya', f(eb.ratio, 1)], ['Socavación ys', f(eb.ys) + ' m']]);

  b += H(2, 'Resumen de Socavación General');
  if (secs.length) {
    b += tabla(['Sección', 'LL vert.', 'Neill', 'Por franjas', 'Gral. adopt.', 'Local pila', 'Total'],
      secs.map((s) => [esc(s.nombre), f(s.soc.general?.socavMax), f(s.soc.generalNeill?.socav), f(s.soc.franjas?.socavMax), f(s.soc.generalAdoptada), s.soc.localAdoptada != null ? f(s.soc.localAdoptada) : '—', f(s.soc.socavTotal)]));
    const cp = secs.filter((s) => s.soc.metodosPila);
    if (cp.length) b += `<h4 class="h3">Socavación local en pila — comparación de métodos</h4>` +
      tabla(['Sección', 'HEC-18', 'Froehlich', 'Laursen-Toch', 'Breusers', 'Larras', 'Adoptada'],
        cp.map((s) => { const m = s.soc.metodosPila; return [esc(s.nombre), f(m.csu), f(m.froehlich), f(m.laursenToch), f(m.breusers), f(m.larras), f(m.max)]; }));
  } else b += ND('Calcula la socavación por sección (pestaña Hidráulica).');

  // ── Sedimentos y evolución del lecho (nuevos) ───────────────────────────────
  b += H(2, 'Transporte de Sedimentos');
  b += P('Transporte incipiente por <b>Shields</b>, gasto de fondo por <b>Meyer-Peter &amp; Müller</b> y gasto total por <b>Engelund-Hansen</b> (MC 3.707.304):');
  b += EQ(F.shields); b += EQ(F.mpm); b += EQ(F.engelund);

  b += H(2, 'Degradación del Lecho a Largo Plazo');
  b += P('Pendiente de equilibrio por reducción del aporte sólido y acorazamiento por tamaño competente; se adopta el mecanismo más restrictivo:');
  b += EQ(F.pendEquilibrio); b += EQ(F.coraza);
  const dg = reg.degradacion;
  if (dg) b += KV([['Δz por pendiente de equilibrio', f(dg.dzPend) + ' m'], ['Δz por acorazamiento', f(dg.dzCoraza) + ' m'], ['Degradación adoptada', f(dg.dzAdoptado) + ' m'], ['Mecanismo', esc(dg.mecanismo)]]);
  else b += ND('Corre "Degradación a largo plazo" para poblar esta sección.');

  b += H(2, 'Lecho Móvil — Evolución Morfodinámica');
  b += P('Continuidad del sedimento (ecuación de <b>Exner</b>) acoplada a la hidráulica: en 1D sobre el perfil (quasi-unsteady, recorriendo el hidrograma) y en 2D celda a celda con la velocidad real del campo de flujo:');
  b += EQ(F.exner);
  const m1 = reg.morfo1d;
  if (m1) { b += `<h4 class="h3">Lecho móvil 1D (quasi-unsteady)</h4>`; b += KV([['Duración simulada', f(m1.horas, 1) + ' h'], ['Erosión máxima', f(m1.eroMax) + ' m'], ['Depósito máximo', f(m1.depMax) + ' m']]); }
  const rmf = koi.bati?.resultMorfo2d;
  if (rmf) {
    b += `<h4 class="h3">Morfodinámico 2D (Saint-Venant + Exner)</h4>`;
    b += KV([['Acople', rmf.acople === 'acoplado' ? 'Acoplado (cada paso)' : 'Desacoplado'], ['Volumen erosionado', f(rmf.volErosion) + ' m³'], ['Volumen depositado', f(rmf.volDeposito) + ' m³'], ['|Δz| máx por actualización', f(rmf.dzMax, 3) + ' m'], ['Tiempo simulado', f(rmf.t, 0) + ' s']]);
  }
  if (!m1 && !rmf) b += ND('Corre "Lecho móvil 1D" o "Morfodinámico 2D" para poblar esta sección.');
  return b;
}

// ═══ 4 · DISEÑO Y VERIFICACIÓN DE OBRAS ═════════════════════════════════════════
function capObras(koi, H) {
  const reg = koi.reg || {};
  let b = H(1, 'Diseño y Verificación de Obras');
  b += H(2, 'Períodos de Retorno Normativos y Revancha');
  b += P('Los períodos de retorno de diseño/verificación se adoptan según el tipo de obra (MC 3.702); la revancha mínima según la velocidad y el tipo de flujo.');
  const vf = reg.verificaciones;
  if (vf) {
    b += KV([['Obra', esc(vf.obra)], ['T diseño', vf.Tdis + ' años'], ['T verificación', vf.Tver + ' años'], ['Revancha requerida', f(vf.revanchaReq) + ' m'], ['Revancha disponible', vf.revanchaDisp != null ? f(vf.revanchaDisp) + ' m' : '—'], ['Cumple', vf.cumple == null ? '—' : (vf.cumple ? '✓ sí' : '✗ NO')]]);
  } else b += ND('Corre "Verificaciones (período T · revancha)" para poblar esta sección.');

  b += H(2, 'Alcantarillas — FHWA HDS-5');
  b += P('El diseño se controla por la condición más desfavorable entre <b>control de entrada</b> (nomogramas FHWA, forma/embocadura) y <b>control de salida</b> (balance de energía con pérdidas por fricción):');
  b += EQ(F.hds5entrada, 'control de entrada (forma sumergida; K<sub>u</sub> = 1.811 SI)');
  b += EQ(F.hds5salida, 'control de salida (balance de energía)');
  const al = reg.alcantarilla;
  if (al) {
    b += KV([['Tipo / embocadura', esc(al.tipo)], ['Dimensiones', esc(al.dim)], ['Barriles', al.nBarriles || 1], ['Q diseño', f(al.Q) + ' m³/s'], ['Q por barril', f(al.Qbarril) + ' m³/s'],
      ['HW control entrada', f(al.HWe) + ' m'], ['HW control salida', f(al.HWs) + ' m'], ['Control que gobierna', esc(al.gobierna)], ['HW/D', f(al.HWD, 2)], ['V salida', f(al.Vsal) + ' m/s']]);
  } else b += ND('Corre "Alcantarilla (FHWA HDS-5)" para poblar esta sección.');

  b += H(2, 'Puente en Presión / Vertedero sobre la Rasante');
  b += P('Cuando el nivel alcanza el tablero, el vano trabaja como <b>compuerta/orificio</b> y, si sobrepasa la rasante, se agrega <b>vertedero</b> con corrección por sumergencia (Villemonte) — rutina tipo HEC-RAS:');
  b += EQ(F.orificio); b += EQ(F.vertedero);
  const pp = reg.puentePresion;
  if (pp) {
    b += KV([['Régimen', esc(pp.regimen)], ['Energía aguas arriba Eu', f(pp.Eu) + ' m'], ['Q por presión', f(pp.Qpresion) + ' m³/s'], ['Q por vertedero', f(pp.Qvertedero) + ' m³/s'], ['Afección (ΔWSE)', f(pp.afeccion) + ' m'], ['Revancha', f(pp.revancha) + ' m'], ['V en el vano', f(pp.Vvano) + ' m/s']]);
  } else b += ND('Corre "Puente (presión / vertedero)" para poblar esta sección.');

  b += H(2, 'Enrocado de Protección (MC 3.708 · HEC-23)');
  b += P('Dimensionamiento del D₅₀ por <b>Isbash</b> (flujo impacto), <b>Maynord/HEC-11</b> (revestimiento con factor de talud) y <b>HEC-23</b> (pila/estribo); se adopta el mayor con su granulometría, espesor y empotramiento del pie:');
  b += EQ(F.isbash); b += EQ(F.maynord); b += EQ(F.hec23);
  const en = reg.enrocado;
  if (en) {
    b += KV([['Aplicación', esc(en.aplicacion)], ['V diseño', f(en.V) + ' m/s'], ['D50 Isbash', f(en.d50Isbash) + ' m'], ['D50 Maynord', f(en.d50Maynord) + ' m'], ['D50 HEC-23', f(en.d50Hec23) + ' m'], ['D50 adoptado', f(en.d50) + ' m'], ['Peso W50', f(en.W50, 0) + ' kg'], ['Espesor', f(en.espesor) + ' m']]);
  } else b += ND('Corre "Enrocado / defensas" para poblar esta sección.');

  b += H(2, 'Verificación Sísmica de Estribos y Muros (Mononobe-Okabe)');
  b += P('Empuje activo sísmico por el método pseudo-estático de <b>Mononobe-Okabe</b>; el coeficiente sísmico horizontal se adopta según la zona sísmica (MC 3.1004 / NCh433):');
  b += EQ(F.moKh, 'A₀ = 0.20g / 0.30g / 0.40g para zonas sísmicas 1 / 2 / 3');
  b += EQ(F.moKae); b += EQ(F.moPae, 'el incremento dinámico ΔP<sub>AE</sub> = P<sub>AE</sub> − P<sub>A</sub> se aplica a 0.6·H');
  const sm = reg.sismo;
  if (sm) {
    b += KV([['Zona sísmica', sm.zona], ['kh', f(sm.kh, 3)], ['K_A (estático)', f(sm.KA, 3)], ['K_AE (sísmico)', f(sm.KAE, 3)], ['P_A', f(sm.PA, 1) + ' kN/m'], ['P_AE', f(sm.PAE, 1) + ' kN/m'], ['ΔP_AE', f(sm.dPAE, 1) + ' kN/m'],
      ['FS deslizamiento', f(sm.FSdesl, 2) + (sm.FSdesl >= 1.1 ? ' ✓' : ' ✗')], ['FS volcamiento', f(sm.FSvolc, 2) + (sm.FSvolc >= 1.15 ? ' ✓' : ' ✗')]]);
  } else b += ND('Corre "Sísmica de estribos (Mononobe-Okabe)" para poblar esta sección.');

  b += H(2, 'Rotura de Presa / Depósito de Relaves (Froehlich)');
  b += P('Parámetros de brecha e hidrograma de rotura por las relaciones empíricas de <b>Froehlich</b> (2008/1995); el hidrograma resultante puede rutearse con el modelo 2D de momentum (y con reología de mezcla para relaves):');
  b += EQ(F.froehlichBrecha, 'K<sub>o</sub> = 1.3 (sobrevertimiento) / 1.0 (tubificación)');
  b += EQ(F.froehlichQp);
  b += EQ(F.obrien, 'fricción de mezcla (O’Brien): fluencia + viscoso + turbulento-dispersivo');
  const br = reg.breach;
  if (br) {
    b += KV([['Modo de falla', esc(br.modo)], ['Volumen embalsado Vw', f(br.Vw, 0) + ' m³'], ['Altura de brecha hb', f(br.hb) + ' m'], ['Ancho medio de brecha', f(br.Bavg) + ' m'], ['Tiempo de falla', f(br.tfMin, 1) + ' min'], ['Q pico de rotura', f(br.Qp, 0) + ' m³/s']]);
  } else b += ND('Corre "Rotura de presa (Froehlich)" para poblar esta sección.');
  return b;
}

// ── Tc para el informe ────────────────────────────────────────────────────────
function tcTabla(m) {
  const L = m.L, S = m.S, A = m.A, Hh = m.H, Hm = m.H * 0.5, CN = 75;
  const kirpich = 0.0195 * Math.pow(L * 1000, 0.77) * Math.pow(S, -0.385) / 60;
  const california = 0.95 * Math.pow((L * L * L) / Hh, 0.385);
  const giandotti = (4 * Math.sqrt(A) + 1.5 * L) / (0.8 * Math.sqrt(Hm));
  const normas = 0.3 * Math.pow(L / Math.pow(S, 0.25), 0.76);
  const scs = Math.pow(3.28 * L * 1000, 0.8) * Math.pow(1000 / CN - 9, 0.7) / (1140 * Math.pow(S * 100, 0.5));
  const metodos = [['Kirpich', kirpich], ['California (C.C.P.)', california], ['Giandotti', giandotti], ['Normas Españolas', normas], ['SCS (1975)', scs]]
    .map(([metodo, tc]) => ({ metodo, tc, aplica: isFinite(tc) && tc > 0 }));
  const tcs = metodos.filter((x) => x.aplica).map((x) => x.tc);
  return { metodos, adoptado: tcs.length ? Math.max(...tcs) : NaN };
}
function tcVal(tc, key) {
  if (!tc) return '';
  const x = tc.metodos.find((m) => m.metodo.startsWith(key));
  return x && isFinite(x.tc) ? `t<sub>c</sub> = <b>${x.tc.toFixed(2)} h</b>` : '';
}

// ── Figuras (SVG) y tabla ──────────────────────────────────────────────────────
function bboxOf(pts) { let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity; for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); } return { w, e, s, n }; }
function svgPoligono(coords, stroke, fill, pt) {
  if (!coords || coords.length < 3) return '';
  const W = 300, Hh = 220, pad = 12, all = pt ? [...coords, pt] : coords, bb = bboxOf(all);
  const k = Math.min((W - 2 * pad) / ((bb.e - bb.w) || 1), (Hh - 2 * pad) / ((bb.n - bb.s) || 1));
  const X = (x) => pad + (x - bb.w) * k, Y = (y) => Hh - pad - (y - bb.s) * k;
  const marca = pt ? `<circle cx="${X(pt[0]).toFixed(1)}" cy="${Y(pt[1]).toFixed(1)}" r="4.5" fill="#ef6c5a" stroke="#fff" stroke-width="1.5"/>
    <text x="${(X(pt[0]) + 7).toFixed(1)}" y="${(Y(pt[1]) + 3).toFixed(1)}" font-size="9" fill="#082a3d">punto</text>` : '';
  return `<svg class="fig" viewBox="0 0 ${W} ${Hh}"><polygon points="${coords.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${marca}</svg>`;
}
function svgSeccion(s) {
  const W = 340, Hh = 150, pad = 22, xs = s.pts.map((p) => p.s), zs = s.pts.map((p) => p.z);
  const sMax = Math.max(...xs) || 1, sMin = Math.min(...xs), fr = s.soc?.franjas?.franjas || [];
  const socZ = fr.length ? fr.map((p) => p.zFondo) : (s.soc?.general?.perfil || []).map((p) => p.zFondo);
  const allZ = [...zs, s.res.WSE, ...socZ].filter((v) => isFinite(v));
  const zLo = Math.min(...allZ) - 0.3, zHi = Math.max(...allZ) + 0.3, zR = (zHi - zLo) || 1, sR = (sMax - sMin) || 1;
  const X = (v) => pad + ((v - sMin) / sR) * (W - 2 * pad), Y = (v) => Hh - pad - ((v - zLo) / zR) * (Hh - 2 * pad);
  const terreno = s.pts.map((p) => `${X(p.s).toFixed(1)},${Y(p.z).toFixed(1)}`).join(' ');
  const wp = s.pts.filter((p) => p.z <= s.res.WSE);
  const agua = wp.length > 1 ? `<polygon points="${X(wp[0].s).toFixed(1)},${Y(s.res.WSE).toFixed(1)} ${X(wp[wp.length - 1].s).toFixed(1)},${Y(s.res.WSE).toFixed(1)} ${wp.map((p) => `${X(p.s).toFixed(1)},${Y(p.z).toFixed(1)}`).reverse().join(' ')}" fill="#38bdf8" fill-opacity="0.5"/>` : '';
  const soc = fr.length ? `<polyline points="${fr.map((p) => `${X(p.s).toFixed(1)},${Y(p.zFondo).toFixed(1)}`).join(' ')}" fill="none" stroke="#ef6c5a" stroke-width="1.5" stroke-dasharray="4 3"/>` : '';
  return `<svg class="fig wide" viewBox="0 0 ${W} ${Hh}">${agua}<polyline points="${terreno}" fill="none" stroke="#a3805a" stroke-width="2"/>${soc}
    <line x1="${X(0)}" y1="${Y(s.res.WSE)}" x2="${X(sMax)}" y2="${Y(s.res.WSE)}" stroke="#128aa5" stroke-width="1" stroke-dasharray="2 2"/>
    <text x="${W - pad}" y="${(Y(s.res.WSE) - 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#128aa5">WSE ${f(s.res.WSE)}</text></svg>`;
}
function svgPerfil(r) {
  const secs = (r.perfil || []).map((p) => ({ st: p.station, wse: p.WSE, bed: p.WSE - p.profMax })).sort((a, b) => a.st - b.st);
  if (secs.length < 2) return ND('Traza ≥ 2 secciones para el perfil longitudinal.');
  const W = 480, Hh = 170, pad = 26, st0 = secs[0].st, st1 = secs[secs.length - 1].st, dS = (st1 - st0) || 1;
  let zLo = Infinity, zHi = -Infinity; for (const s of secs) { zLo = Math.min(zLo, s.bed); zHi = Math.max(zHi, s.wse); }
  const zR = (zHi - zLo) || 1, X = (st) => pad + ((st - st0) / dS) * (W - 2 * pad), Y = (z) => Hh - pad - ((z - zLo) / zR) * (Hh - 2 * pad);
  const bed = secs.map((s) => `${X(s.st).toFixed(1)},${Y(s.bed).toFixed(1)}`).join(' ');
  const wse = secs.map((s) => `${X(s.st).toFixed(1)},${Y(s.wse).toFixed(1)}`).join(' ');
  return `<svg class="fig wide" viewBox="0 0 ${W} ${Hh}"><polygon points="${wse} ${secs.slice().reverse().map((s) => `${X(s.st).toFixed(1)},${Y(s.bed).toFixed(1)}`).join(' ')}" fill="#38bdf8" fill-opacity="0.4"/>
    <polyline points="${wse}" fill="none" stroke="#128aa5" stroke-width="1.6"/><polyline points="${bed}" fill="none" stroke="#a3805a" stroke-width="2"/>
    <text x="${pad}" y="${Hh - 6}" font-size="8" fill="#667">aguas arriba</text><text x="${W - pad}" y="${Hh - 6}" text-anchor="end" font-size="8" fill="#667">aguas abajo →</text></svg>`;
}
function svgMalla(m) {
  const W = 420, Hh = 300, pad = 8, xs = m.nodes.map((n) => n.x), ys = m.nodes.map((n) => n.y);
  const bw = Math.min(...xs), be = Math.max(...xs), bs = Math.min(...ys), bn = Math.max(...ys);
  const k = Math.min((W - 2 * pad) / ((be - bw) || 1), (Hh - 2 * pad) / ((bn - bs) || 1));
  const X = (x) => pad + (x - bw) * k, Y = (y) => Hh - pad - (y - bs) * k;
  let edges = '';
  for (const t of m.tris) { const a = m.nodes[t[0]], b = m.nodes[t[1]], c = m.nodes[t[2]], enC = a.enCauce || b.enCauce || c.enCauce; edges += `<polygon points="${X(a.x).toFixed(1)},${Y(a.y).toFixed(1)} ${X(b.x).toFixed(1)},${Y(b.y).toFixed(1)} ${X(c.x).toFixed(1)},${Y(c.y).toFixed(1)}" fill="${enC ? 'rgba(56,189,248,.18)' : 'none'}" stroke="#94a3b8" stroke-width="0.4"/>`; }
  return `<svg class="fig wide" viewBox="0 0 ${W} ${Hh}">${edges}</svg>`;
}
function svgInundacion(m, r) {
  if (!m || !r?.h) return '';
  const W = 420, Hh = 300, pad = 8, xs = m.nodes.map((n) => n.x), ys = m.nodes.map((n) => n.y);
  const bw = Math.min(...xs), be = Math.max(...xs), bs = Math.min(...ys), bn = Math.max(...ys);
  const k = Math.min((W - 2 * pad) / ((be - bw) || 1), (Hh - 2 * pad) / ((bn - bs) || 1));
  const X = (x) => pad + (x - bw) * k, Y = (y) => Hh - pad - (y - bs) * k, hmax = r.hmax || 1;
  let tri = '';
  for (const t of m.tris) { const hm = (r.h[t[0]] + r.h[t[1]] + r.h[t[2]]) / 3; if (hm <= 0.02) continue; const a = m.nodes[t[0]], b = m.nodes[t[1]], c = m.nodes[t[2]], al = Math.min(0.85, 0.2 + hm / hmax); tri += `<polygon points="${X(a.x).toFixed(1)},${Y(a.y).toFixed(1)} ${X(b.x).toFixed(1)},${Y(b.y).toFixed(1)} ${X(c.x).toFixed(1)},${Y(c.y).toFixed(1)}" fill="rgba(18,138,165,${al.toFixed(2)})"/>`; }
  return `<svg class="fig wide" viewBox="0 0 ${W} ${Hh}">${tri}</svg>`;
}
function tabla(headers, rows) {
  const body = (rows && rows.length) ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" class="nd">Pendiente de ingreso de datos.</td></tr>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

const CSS = `
  * { box-sizing: border-box; }
  :root { --tinta:#12242e; --marca:#0d7a94; --marca2:#31c3ce; --linea:#d9e4ea; --suave:#5a707c; }
  body { font: 13px/1.6 "Segoe UI", system-ui, sans-serif; color: var(--tinta); margin: 0; background: #e9eef1; }
  .toolbar { position: sticky; top: 0; z-index: 5; background: #062538; color: #cfe; padding: 8px 16px; display: flex; gap: 14px; align-items: center; }
  .toolbar button { background: var(--marca); color: #fff; border: 0; border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
  main { max-width: 860px; margin: 18px auto; background: #fff; padding: 0 0 32px; box-shadow: 0 2px 20px rgba(8,39,56,.14); counter-reset: fig; }
  main > section { padding: 0 58px; }

  /* Portada */
  .portada { text-align: center; padding: 0 58px 44px !important; position: relative; }
  .p-banda { height: 14px; background: linear-gradient(90deg, var(--marca), var(--marca2)); margin: 0 -58px 42px; }
  .portada .logo { width: 104px; height: 104px; }
  .p-tipo { text-transform: uppercase; letter-spacing: .35em; font-size: 11px; color: var(--suave); margin: 18px 0 4px; }
  .portada h1 { font-size: 27px; line-height: 1.25; margin: 4px 0 10px; font-weight: 650; }
  .portada h2 { font-size: 17px; color: var(--marca); margin: 0 0 4px; font-weight: 600; }
  .portada .fecha { color: var(--suave); margin: 2px 0 22px; }
  .toc { display: inline-block; text-align: left; background: #f4f8fa; border: 1px solid var(--linea); border-radius: 10px; padding: 12px 26px 12px 16px; }
  .toc ol { margin: 6px 0 0; padding-left: 22px; }
  .toc li { padding: 2px 0; }
  .lic { max-width: 600px; margin: 20px auto 0; font-size: 11.5px; color: #47606d; background: #f4f8fa; border: 1px solid var(--linea); border-radius: 10px; padding: 10px 16px; }

  /* Jerarquía */
  .cap { margin: 26px 0; }
  h2, h3, h4, h5 { page-break-after: avoid; }
  .h1 { font-size: 21px; margin: 34px -58px 14px; padding: 12px 58px; background: linear-gradient(90deg, #eef6f8, transparent); border-left: 6px solid var(--marca); font-weight: 650; }
  .h2 { font-size: 15.5px; margin: 22px 0 6px; color: #0b3a4c; border-bottom: 1px solid var(--linea); padding-bottom: 3px; }
  .h3 { font-size: 13.5px; margin: 15px 0 4px; color: #0d5a72; }
  .h4 { font-size: 12.5px; margin: 11px 0 3px; color: #38596a; font-weight: 700; }
  .hn { color: var(--marca); font-weight: 700; margin-right: 7px; font-variant-numeric: tabular-nums; }
  p { margin: 5px 0; text-align: justify; }

  /* Fórmulas (MathML) */
  .formula { background: #f6fafc; border: 1px solid #e2edf2; border-radius: 8px; padding: 10px 14px 8px; margin: 9px 0; text-align: center; page-break-inside: avoid; }
  .formula math { font-size: 15px; }
  .eq-nota { font-size: 11px; color: var(--suave); margin-top: 5px; text-align: center; }

  /* Tablas */
  table { border-collapse: collapse; width: 100%; margin: 9px 0; font-size: 12px; page-break-inside: avoid; }
  th, td { border: 1px solid var(--linea); padding: 5px 9px; text-align: right; }
  th { background: #eaf3f6; color: #0b3a4c; font-weight: 650; }
  th:first-child, td:first-child { text-align: left; }
  tbody tr:nth-child(even) td { background: #f8fbfc; }

  /* Figuras */
  .fig { width: 300px; height: auto; background: #fcfeff; border: 1px solid var(--linea); border-radius: 8px; display: block; margin: 6px auto; }
  .fig.wide { width: 100%; max-width: 500px; }
  .snap { width: 100%; max-width: 540px; border: 1px solid var(--linea); border-radius: 8px; display: block; margin: 6px auto; }
  .figcap { font-size: 11px; color: var(--suave); text-align: center; margin: 2px 0 10px; }
  .figcap::before { counter-increment: fig; content: "Figura " counter(fig) " — "; font-weight: 600; color: #38596a; }
  .fig-row { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .fig-row table { flex: 1; min-width: 240px; }
  .sec-card { border: 1px solid var(--linea); border-radius: 10px; padding: 9px 14px; margin: 10px 0; page-break-inside: avoid; background: #fdfefe; }
  .nd { color: #93a3ad; font-style: italic; }
  .pie { margin-top: 30px; font-size: 11px; color: #7b8b95; }

  @page { margin: 16mm 14mm; }
  @media print {
    body { background: #fff; } .no-print { display: none; }
    main { box-shadow: none; margin: 0; max-width: none; }
    main > section { padding: 0 2mm; }
    .h1 { margin-left: -2mm; margin-right: -2mm; padding-left: 8mm; }
    .p-banda { margin-left: -2mm; margin-right: -2mm; }
    .cap { page-break-before: always; }
  }
`;
