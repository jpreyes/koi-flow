// ─────────────────────────────────────────────────────────────────────────────
// informe.js — generador del INFORME hidrológico-hidráulico (koi-flow).
// Sigue la MISMA estructura de capítulos/subcapítulos del informe de referencia
// "03 Hidrología e Hidráulica S17" (Análisis Hidrológico · Estudio Hidráulico ·
// Análisis de Socavaciones), con las MISMAS ecuaciones (prerrenderizadas) y al
// menos las mismas tablas, rellenadas con los datos del proyecto cuando existen.
// Documento HTML imprimible (→ PDF). Propiedad: JPReyes / Conmuta.cl.
// ─────────────────────────────────────────────────────────────────────────────
import { estacionesCercanas, cargarSerie } from '../datos/dga.js?v=2';
import { analizar } from '../hidro/frecuencia.js?v=2';
import { correrPipelinePunto } from '../hidro/pipeline.js?v=2';

const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d)));
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const MARCA = { autor: 'JPReyes', empresa: 'Conmuta.cl', logo: 'icons/icon-512.png' };
const DIST = { normal: 'Normal', lognormal: 'Log-Normal', pearson3: 'Pearson III', logpearson3: 'Log-Pearson III', gumbel: 'Gumbel', gamma: 'Gamma' };
const TS = [2, 5, 10, 25, 50, 100, 200];

// Abre la ventana YA (evita bloqueo de popups), corre el análisis y rellena.
export async function generarInforme(koi) {
  const w = window.open('', '_blank');
  if (!w) { alert('Permite las ventanas emergentes para ver el informe.'); return; }
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
  // Pipeline completo (caudales pluviales + HU + transposición fluviométrica + adoptados)
  // si hay cuenca delineada y serie pluviométrica.
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
const EQ = (html) => `<div class="formula">${html}</div>`;
const ND = (t = 'Pendiente de ingreso de datos.') => `<p class="nd">${t}</p>`;

// Contenido del informe (portada + capítulos + pie), reutilizable para pantalla y Word.
function contenido(koi, datos = {}) {
  const proj = koi.project || {};
  const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
  const H = numerador();
  const cuerpo = [
    `<section class="cap">${capHidrologia(koi, H, datos)}</section>`,
    `<section class="cap">${capHidraulico(koi, H)}</section>`,
    `<section class="cap">${capSocavacion(koi, H)}</section>`,
  ].join('\n');
  return `${portada(proj, fecha)}${cuerpo}${pieLicencia()}`;
}

function construir(koi, datos = {}) {
  const proj = koi.project || {};
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>Informe hidrológico-hidráulico · ${esc(proj.name || 'koi-flow')}</title><style>${CSS}</style></head><body>
    <div class="toolbar no-print"><button onclick="window.print()">🖨 Imprimir / PDF</button>
      <span>koi-flow · ${MARCA.autor} / ${MARCA.empresa}</span></div>
    <main>${contenido(koi, datos)}</main></body></html>`;
}

// Exporta el informe a Word (.doc): HTML compatible con Word (tablas/fórmulas/texto).
export async function generarInformeWord(koi) {
  let datos = {};
  try { datos = await reunirDatos(koi); } catch (e) { console.warn('informe word:', e.message); }
  const proj = koi.project || {};
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>Informe · ${esc(proj.name || 'koi-flow')}</title>
    <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
    <style>${CSS}</style></head><body><main>${contenido(koi, datos)}</main></body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${(proj.name || 'informe').replace(/\s+/g, '_')}.doc`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function portada(proj, fecha) {
  return `<section class="portada">
    <img src="icons/koi-symbol.svg" class="logo" alt="Koi-Flow" onerror="this.src='${MARCA.logo}'">
    <h1>Informe Hidrológico-Hidráulico</h1>
    <h2>${esc(proj.name || 'Proyecto')}</h2>
    <p class="fecha">${fecha}</p>
    <div class="lic">Elaborado con <b>Koi-Flow</b> — software propiedad de <b>${MARCA.autor} / ${MARCA.empresa}</b>.
      Metodologías según Manual de Carreteras (MC-V3, Vol. 3) y DGA. Estructura basada en el informe tipo S17.</div>
    <div class="toc"><b>Contenido</b>
      <ol><li>Análisis Hidrológico</li><li>Estudio Hidráulico</li><li>Análisis de Socavaciones</li></ol></div></section>`;
}
function pieLicencia() {
  return `<section class="pie"><hr><p>© ${new Date().getFullYear()} <b>${MARCA.autor} / ${MARCA.empresa}</b> · Koi-Flow.
    Documento generado automáticamente; los resultados deben ser revisados por un profesional competente.</p></section>`;
}

// ═══ 1 · ANÁLISIS HIDROLÓGICO ═══════════════════════════════════════════════════
function capHidrologia(koi, H, datos = {}) {
  const est = koi.map?._stations || [];
  const pl = est.filter((e) => e.tipo === 'pluviometrica'), fl = est.filter((e) => e.tipo === 'fluviometrica');
  const cuencas = (koi.map?.getPoints?.() || []).filter((p) => p.cuenca);
  const m = cuencas[0]?.cuenca?.morfometria;
  const filaEst = (e) => [esc(e.nombre), e.bna, f(e.dist, 1) + ' km', e.n_anios ?? '—', esc(e.periodo || '—')];
  const cabEst = ['Estación', 'BNA', 'Distancia', 'Años', 'Periodo'];
  // Análisis de frecuencia corrido sobre las estaciones patrón (auto-relleno)
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
  if (m) b += `<div class="fig-row">${svgPoligono(cuencas[0].cuenca.polygonSuave || cuencas[0].cuenca.polygon, '#128aa5', 'rgba(18,138,165,.15)', [cuencas[0].lon, cuencas[0].lat])}
    ${tabla(['Parámetro', 'Valor'], [['Área A', m.A + ' km²'], ['Cauce principal L', m.L + ' km'], ['Long. al centroide Lg', m.Lg + ' km'], ['Pendiente media S', f(m.S * 100) + ' %'], ['Desnivel H', m.H + ' m'], ['Perímetro', m.perimetro_km + ' km']])}</div>`;
  else b += ND('Delinea una cuenca para poblar esta sección.');

  b += H(2, 'Estaciones Pluviométricas');
  b += tabla(cabEst, pl.length ? pl.map(filaEst) : null);
  b += H(3, 'Modelo digital de elevaciones');
  b += P('DEM base tipo Terrarium (y batimetría CAD fusionada cuando existe) para morfometría, secciones y modelación.');
  { const png = koi.scene?.terrain ? koi.scene.snapshot?.() : null; if (png) b += `<img class="snap" src="${png}" alt="Relieve 3D"><p class="cap">Modelo 3D del sector (relieve + cauce).</p>`; }

  b += H(2, 'Elección de la Estación Patrón');
  b += P('Se adopta como estación patrón la de mayor longitud de registro y representatividad, priorizando registro sobre cercanía.');

  b += H(2, 'Análisis de Datos Dudosos');
  b += P('Detección de datos dudosos altos/bajos por el criterio de <b>Grubbs-Beck</b> (WRC) sobre los logaritmos de la serie:');
  b += EQ('x<sub>H,L</sub> = 10<sup>( x̄ ± K<sub>N</sub>·s )</sup> ,&nbsp; con x en log<sub>10</sub> ; K<sub>N</sub> según el tamaño de muestra N');

  b += H(2, 'Relleno de Estadísticas');
  b += P('Relleno de faltantes por correlación con estaciones vecinas (razones/regresión) para homogeneizar el periodo.');

  b += H(2, 'Análisis de Frecuencia');
  b += P('Se ajustan las <b>6 distribuciones</b> del MC a la serie de máximos anuales y se calculan los cuantiles para los periodos de retorno de diseño (T = 2…300 años).');
  b += H(3, 'Modelo Normal'); b += EQ('x<sub>T</sub> = x̄ + z<sub>T</sub>·s');
  b += H(3, 'Modelo Log-Normal'); b += EQ('ln x<sub>T</sub> = μ<sub>ln</sub> + z<sub>T</sub>·σ<sub>ln</sub>');
  b += H(3, 'Distribución Pearson III'); b += EQ('x<sub>T</sub> = x̄ + K<sub>T</sub>(C<sub>s</sub>)·s');
  b += H(3, 'Modelo Log-Pearson tipo III'); b += EQ('log x<sub>T</sub> = x̄<sub>log</sub> + K<sub>T</sub>(C<sub>s,log</sub>)·s<sub>log</sub>');
  b += H(3, 'Modelo Valores Extremos tipo I (Gumbel)'); b += EQ('x<sub>T</sub> = x̄ + s·( −(√6/π)[0.5772 + ln(ln(T/(T−1)))] − Y<sub>n</sub> )/S<sub>n</sub>');
  b += H(3, 'Distribución Gamma'); b += EQ('f(x) = x<sup>α−1</sup>·e<sup>−x/β</sup> / (β<sup>α</sup>·Γ(α))');

  b += H(2, 'Calidad del Ajuste — Coeficiente de Determinación R²');
  b += EQ('R² = 1 − Σ(x<sub>i</sub> − x̂<sub>i</sub>)² / Σ(x<sub>i</sub> − x̄)²');

  b += H(2, 'Prueba de Bondad de Ajuste');
  b += P('Prueba χ² de Pearson (α = 0.05), gl = k − 1 − p:');
  b += EQ('χ² = Σ (O<sub>i</sub> − E<sub>i</sub>)² / E<sub>i</sub>');

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
  b += EQ('i(t,T) = P<sub>24,T</sub> · C<sub>D</sub>(t) / t');

  b += H(2, 'Estimación de Caudales en Cuencas Sin Control Fluviométrico');
  b += H(3, 'Coeficiente de escorrentía'); b += EQ('C = f(uso de suelo, pendiente, T) ;&nbsp; método racional: Q = C·i·A / 3.6');

  b += H(2, 'Línea de Nieve');
  b += P('Se determina la línea de nieves (Peña-Vidal) para separar el <b>área pluvial</b> aportante del área nival.');

  b += H(2, 'Áreas Aportantes');
  b += H(3, 'Forma de la Cuenca');
  b += H(4, 'Índice de Gravelius o coeficiente de compacidad (Kc)'); b += EQ('K<sub>c</sub> = 0.28 · P / √A' + (m ? ` = <b>${m.Kc}</b>` : ''));
  b += H(4, 'Factor de forma (Kf)'); b += EQ('K<sub>f</sub> = A / L²' + (m ? ` = <b>${f(m.A / (m.L * m.L))}</b>` : ''));
  // Tiempo de concentración — todos los métodos
  const tc = m ? tcTabla(m) : null;
  b += H(4, 'Método de California'); b += EQ('t<sub>c</sub> = 0.95·(L³/H)<sup>0.385</sup>' + tcVal(tc, 'California'));
  b += H(4, 'Método de Giandotti'); b += EQ('t<sub>c</sub> = (4√A + 1.5L) / (0.8√H<sub>m</sub>)' + tcVal(tc, 'Giandotti'));
  b += H(4, 'Normas Españolas'); b += EQ('t<sub>c</sub> = 0.3·(L / S<sup>0.25</sup>)<sup>0.76</sup>' + tcVal(tc, 'Normas'));
  b += H(4, 'Método SCS (1975)'); b += EQ('t<sub>c</sub> = (3.28·L)<sup>0.8</sup>·(1000/CN − 9)<sup>0.7</sup> / (1140·S<sub>%</sub><sup>0.5</sup>)' + tcVal(tc, 'SCS'));
  b += H(4, 'Método de Kirpich'); b += EQ('t<sub>c</sub> = 0.0195·L<sub>m</sub><sup>0.77</sup>·S<sup>−0.385</sup>' + tcVal(tc, 'Kirpich'));
  if (tc) b += tabla(['Método', 't_c [h]'], tc.metodos.map((x) => [x.metodo, x.aplica && isFinite(x.tc) ? x.tc.toFixed(2) : '—'])).replace('</table>', `</table><p class="nd">t_c adoptado (máx): <b>${isFinite(tc.adoptado) ? tc.adoptado.toFixed(2) + ' h' : '—'}</b></p>`);

  b += H(2, 'Determinación de Caudales Máximos');
  b += H(3, 'Método Racional'); b += EQ('Q = C·i·A / 3.6');
  b += H(3, 'Método Verni-King (modificado)'); b += EQ('Q<sub>T</sub> = C · A<sup>0.88</sup> · P<sub>24,T</sub><sup>1.24</sup> · (factor de forma)');
  b += H(3, 'Método DGA');
  b += H(4, 'Determinación de Zona Homogénea'); b += P('Se clasifica la cuenca en la zona homogénea correspondiente (coeficientes regionales DGA-AC).');
  b += H(4, 'Caudal Medio Diario Máximo T=10 años'); b += EQ('Q<sub>10</sub><sup>md</sup> = a · A<sup>b</sup> · PP<sup>c</sup> (coef. de la zona)');
  b += H(4, 'Factor de conversión y Caudal Instantáneo Máximo'); b += EQ('Q<sub>T</sub><sup>inst</sup> = Q<sub>10</sub><sup>md</sup> · (Q<sub>T</sub>/Q<sub>10</sub>) · f<sub>inst</sub>');
  b += H(3, 'Hidrograma Unitario Sintético tipo Linsley'); b += EQ('t<sub>p</sub> = C<sub>t</sub>·(L·L<sub>g</sub>/√S)<sup>n</sup> ;&nbsp; q<sub>p</sub> = C<sub>p</sub>·A / t<sub>p</sub>');

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
  b += H(4, 'Resultados de dispersiones probabilísticas'); b += P('Bandas de confianza de los cuantiles fluviométricos.');
  b += H(3, 'Transposición de Caudales'); b += EQ('Q<sub>x</sub> = Q<sub>c</sub> · (A<sub>px</sub> / A<sub>pc</sub>)<sup>0.88</sup> · (P<sub>x24</sub>/P<sub>c24</sub>)<sup>1.24</sup>');
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
  return b;
}

// ═══ 2 · ESTUDIO HIDRÁULICO ═════════════════════════════════════════════════════
function capHidraulico(koi, H) {
  const bt = koi.bati, secs = bt?.secciones || [];
  let b = H(1, 'Estudio Hidráulico');
  b += H(2, 'Introducción');
  b += P('El eje hidráulico se resuelve en régimen permanente (1D) por el método del <b>paso estándar</b> (standard step) y, alternativamente, en <b>2D</b> por onda difusiva. La dirección del flujo la define el eje/descenso del lecho.');

  b += H(2, 'Antecedentes');
  b += H(3, 'Geomorfología del cauce');
  b += P(bt?._flujo ? `Dirección del flujo: <b>${esc(bt._flujo.arriba?.nombre || '—')} → ${esc(bt._flujo.abajo?.nombre || '—')}</b>; pendiente media J = ${f(bt._flujo.Jmedia, 4)} (${f(bt._flujo.Jmedia * 100)} %).` : 'Traza el eje y las secciones para caracterizar el cauce.');
  b += H(3, 'Topografía del Cauce');
  b += P('Batimetría CAD (DXF) colocada a escala y/o DEM base del terreno; secciones extraídas del modelo.');

  b += H(2, 'Parámetros y Criterios Principales');
  b += H(3, 'Pérdidas de Energía por Fricción'); b += EQ('h<sub>f</sub> = L · ( (Q·n) / (A·R<sub>h</sub><sup>2/3</sup>) )² &nbsp;(Manning) ;&nbsp; V = (1/n)·R<sub>h</sub><sup>2/3</sup>·J<sup>1/2</sup>');
  b += H(3, 'Pérdidas por Contracción y Expansión'); b += EQ('h<sub>e</sub> = C · | (V<sub>2</sub>²−V<sub>1</sub>²) / 2g | ,&nbsp; C = 0.1 (contracción) / 0.3 (expansión), 0.3/0.5 en puentes');
  b += H(3, 'Datos de Flujo Permanente'); b += EQ('E = z + y + V²/2g ;&nbsp; Fr = V / √(g·A/B)');
  b += H(3, 'Período de Retorno y Caudal de Diseño'); b += P('Se adopta el caudal de diseño según el periodo de retorno normativo de la obra (MC): habitualmente T = 100 años (verificación T = 200).');

  b += H(2, 'Resultados Modelación Hidráulica');
  b += H(3, 'Situación Existente');
  if (bt?._remanso) b += `<h4 class="h3">Eje hidráulico longitudinal</h4>${svgPerfil(bt._remanso)}`;
  if (secs.length) {
    b += `<h4 class="h3">Secciones transversales (${secs.length})</h4>`;
    for (const s of secs) {
      if (!s.res) continue;
      b += `<div class="sec-card"><h5 class="h4">${esc(s.nombre)}${s.res.fuente2D ? ' · WSE del 2D' : ''}</h5>${svgSeccion(s)}
        ${tabla(['Magnitud', 'Valor'], [['WSE', f(s.res.WSE) + ' m'], ['Prof. máx', f(s.res.profMax) + ' m'], ['Ancho B', f(s.res.B) + ' m'], ['Área A', f(s.res.A) + ' m²'], ['V', f(s.res.V) + ' m/s'], ['Fr', f(s.res.Fr) + ' (' + esc(s.res.regimen || '') + ')'],
          ...(s.obstr ? [['Angostado por pilas', `B ${f(s.res.B)}→${f(s.obstr.Bef)} m · V→${f(s.obstr.Vobs)} m/s`]] : [])])}</div>`;
    }
  } else b += ND('Traza secciones y calcula el eje (pestaña Hidráulica).');
  // 2D
  const mesh = bt?.mesh2d, r2 = bt?.result2d;
  if (mesh) b += `<h4 class="h3">Modelación 2D (onda difusiva)</h4>${svgMalla(mesh)}${r2 ? svgInundacion(mesh, r2) + tabla(['Magnitud', 'Valor'], [['Calado máx', f(r2.hmax) + ' m'], ['Velocidad máx', f(r2.Vmax) + ' m/s'], ['Nodos mojados', r2.nMojados + ' / ' + mesh.nodes.length]]) : ''}`;
  b += H(3, 'Situación Proyectada');
  b += P('Incorpora las estructuras (puente/alcantarilla): en 1D angostan la sección (y fijan la cota inferior del tablero); en 2D se integran como modificación del terreno (el flujo las rodea).');
  const es = koi.estr?.estructuras || [];
  if (es.length) b += tabla(['Estructura', 'Tipo', 'Cota base', 'Parámetros'], es.map((e) => [esc(e.nombre), e.solido ? 'sólida' : 'pasa', e.zBase != null ? f(e.zBase) + ' m' : '—', Object.entries(e.params).map(([k, v]) => `${k}=${f(v)}`).join(', ')]));
  return b;
}

// ═══ 3 · ANÁLISIS DE SOCAVACIONES ═══════════════════════════════════════════════
function capSocavacion(koi, H) {
  const secs = (koi.bati?.secciones || []).filter((s) => s.soc);
  let b = H(1, 'Análisis de Socavaciones');
  b += H(2, 'Generalidades');
  b += P('La socavación total se estima como la suma de la socavación <b>general</b> (por contracción del cauce) y la socavación <b>local</b> en las pilas/estribos. Se evalúan varios métodos y se adopta la envolvente (criterio MC).');

  b += H(2, 'Antecedentes Granulométricos');
  b += P('Granulometría del lecho por estratos (D<sub>50</sub>, D<sub>84</sub>) y profundidad de la roca (tope de socavación). Se ingresa por sección en la pestaña Hidráulica.');
  if (secs.length) b += tabla(['Sección', 'D50 [mm]', 'T [años]'], secs.map((s) => [esc(s.nombre), f(s.D50mm), f(s.T)]));

  b += H(2, 'Socavación General');
  b += H(3, 'Método de Lischtvan – Levediev');
  b += EQ('d<sub>s</sub> = [ α·h<sup>5/3</sup> / (0.68·β·D<sub>50</sub><sup>0.28</sup>) ]<sup>1/(1+x)</sup> ,&nbsp; α = Q / (H<sub>m</sub><sup>5/3</sup>·B<sub>e</sub>·μ)');
  b += P('Se evalúa por vertical y <b>por franjas</b> (la velocidad varía en la sección), con la D<sub>50</sub> del estrato y tope en la roca.');
  b += H(3, 'Método de Neill');
  b += EQ('V<sub>c</sub> = k · h<sup>1/6</sup> · D<sup>1/3</sup> &nbsp;(velocidad competente) ;&nbsp; d<sub>s</sub> = [q / k]<sup>6/7</sup> − h');

  b += H(3, 'Socavación Local en Pilas');
  b += EQ('HEC-18/CSU: y<sub>s</sub> = 2.0·y<sub>1</sub>·K<sub>1</sub>K<sub>2</sub>K<sub>3</sub>·(a/y<sub>1</sub>)<sup>0.65</sup>·Fr<sub>1</sub><sup>0.43</sup>');
  b += P('Se comparan ≥ 4 métodos del MC (HEC-18, Froehlich, Laursen-Toch, Breusers, Larras) y se adopta el máximo.');

  b += H(2, 'Resumen de Socavación General');
  if (secs.length) {
    b += tabla(['Sección', 'LL vert.', 'Neill', 'Por franjas', 'Gral. adopt.', 'Local pila', 'Total'],
      secs.map((s) => [esc(s.nombre), f(s.soc.general?.socavMax), f(s.soc.generalNeill?.socav), f(s.soc.franjas?.socavMax), f(s.soc.generalAdoptada), s.soc.localAdoptada != null ? f(s.soc.localAdoptada) : '—', f(s.soc.socavTotal)]));
    const cp = secs.filter((s) => s.soc.metodosPila);
    if (cp.length) b += `<h4 class="h3">Socavación local en pila — comparación de métodos</h4>` +
      tabla(['Sección', 'HEC-18', 'Froehlich', 'Laursen-Toch', 'Breusers', 'Larras', 'Adoptada'],
        cp.map((s) => { const m = s.soc.metodosPila; return [esc(s.nombre), f(m.csu), f(m.froehlich), f(m.laursenToch), f(m.breusers), f(m.larras), f(m.max)]; }));
  } else b += ND('Calcula la socavación por sección (pestaña Hidráulica).');
  return b;
}

// ── Tc para el informe ────────────────────────────────────────────────────────
function tcTabla(m) {
  // método simple e inline (evita import ESM del navegador en el doc nuevo)
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
  return x && isFinite(x.tc) ? ` = <b>${x.tc.toFixed(2)} h</b>` : '';
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
  return `<svg class="fig wide" viewBox="0 0 ${W} ${Hh}">${edges}</svg><p class="cap">Malla triangular — celdas azules = cauce (refinamiento fino). ${m.meta.nTri} triángulos.</p>`;
}
function svgInundacion(m, r) {
  if (!m || !r?.h) return '';
  const W = 420, Hh = 300, pad = 8, xs = m.nodes.map((n) => n.x), ys = m.nodes.map((n) => n.y);
  const bw = Math.min(...xs), be = Math.max(...xs), bs = Math.min(...ys), bn = Math.max(...ys);
  const k = Math.min((W - 2 * pad) / ((be - bw) || 1), (Hh - 2 * pad) / ((bn - bs) || 1));
  const X = (x) => pad + (x - bw) * k, Y = (y) => Hh - pad - (y - bs) * k, hmax = r.hmax || 1;
  let tri = '';
  for (const t of m.tris) { const hm = (r.h[t[0]] + r.h[t[1]] + r.h[t[2]]) / 3; if (hm <= 0.02) continue; const a = m.nodes[t[0]], b = m.nodes[t[1]], c = m.nodes[t[2]], al = Math.min(0.85, 0.2 + hm / hmax); tri += `<polygon points="${X(a.x).toFixed(1)},${Y(a.y).toFixed(1)} ${X(b.x).toFixed(1)},${Y(b.y).toFixed(1)} ${X(c.x).toFixed(1)},${Y(c.y).toFixed(1)}" fill="rgba(18,138,165,${al.toFixed(2)})"/>`; }
  return `<svg class="fig wide" viewBox="0 0 ${W} ${Hh}">${tri}</svg><p class="cap">Mancha de inundación (azul = calado, hmax ${f(hmax)} m).</p>`;
}
function tabla(headers, rows) {
  const body = (rows && rows.length) ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" class="nd">Pendiente de ingreso de datos.</td></tr>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

const CSS = `
  * { box-sizing: border-box; }
  body { font: 13px/1.55 "Segoe UI", system-ui, sans-serif; color: #082a3d; margin: 0; background: #eef3f5; }
  .toolbar { position: sticky; top: 0; background: #062538; color: #cfe; padding: 8px 16px; display: flex; gap: 14px; align-items: center; }
  .toolbar button { background: #128aa5; color: #fff; border: 0; border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
  main { max-width: 820px; margin: 16px auto; background: #fff; padding: 40px 52px; box-shadow: 0 2px 16px rgba(8,39,56,.12); }
  .portada { text-align: center; padding: 30px 0; border-bottom: 3px solid #128aa5; margin-bottom: 8px; }
  .portada .logo { width: 96px; height: 96px; }
  .portada h1 { font-size: 25px; margin: 12px 0 2px; }
  .portada h2 { font-size: 18px; color: #128aa5; margin: 0; }
  .portada .fecha { color: #567; }
  .lic { max-width: 580px; margin: 14px auto; font-size: 12px; color: #445; background: #f1f6f8; border: 1px solid #d3e1e8; border-radius: 8px; padding: 10px 14px; }
  .toc { display: inline-block; text-align: left; margin-top: 8px; }
  .cap { margin: 22px 0; }
  h2, h3, h4, h5 { page-break-after: avoid; }
  .h1 { font-size: 20px; border-bottom: 2px solid #128aa5; padding-bottom: 5px; margin: 28px 0 10px; }
  .h2 { font-size: 16px; margin: 20px 0 6px; color: #0a3547; }
  .h3 { font-size: 14px; margin: 14px 0 4px; color: #0a526c; }
  .h4 { font-size: 13px; margin: 10px 0 3px; color: #33596a; font-weight: 700; }
  .hn { color: #128aa5; font-weight: 700; margin-right: 6px; }
  p { margin: 5px 0; }
  .formula { background: #f4f9fb; border-left: 3px solid #31c3ce; padding: 7px 12px; margin: 7px 0; font-family: "Cambria Math", Georgia, serif; font-size: 13.5px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; page-break-inside: avoid; }
  th, td { border: 1px solid #d5dce6; padding: 5px 8px; text-align: right; }
  th { background: #eef4f6; } th:first-child, td:first-child { text-align: left; }
  .fig { width: 300px; height: auto; background: #fbfdfe; border: 1px solid #dbe6ec; border-radius: 8px; }
  .fig.wide { width: 100%; max-width: 480px; }
  .snap { width: 100%; max-width: 520px; border: 1px solid #dbe6ec; border-radius: 8px; }
  .fig-row { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .fig-row table { flex: 1; min-width: 240px; }
  .sec-card { border: 1px solid #dbe6ec; border-radius: 8px; padding: 8px 12px; margin: 10px 0; page-break-inside: avoid; }
  .cap-fig, .cap { font-size: 11px; color: #667; margin: 2px 0 0; }
  .nd { color: #99a; font-style: italic; }
  .pie { margin-top: 28px; font-size: 11px; color: #778; }
  @media print { body { background: #fff; } .no-print { display: none; } main { box-shadow: none; margin: 0; max-width: none; padding: 0 8mm; } .cap { page-break-before: always; } }
`;
