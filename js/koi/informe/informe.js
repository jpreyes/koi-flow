// ─────────────────────────────────────────────────────────────────────────────
// informe.js — generador del INFORME hidrológico-hidráulico (koi-flow).
// Arma un documento HTML imprimible (→ PDF) con portada + licencia, metodologías,
// formulaciones, tablas, esquemas, figuras y resultados de TODOS los análisis:
// cuenca, hidrología (estaciones), hidráulica (secciones + eje), socavación,
// estructuras (eje con puente), 2D (inundación/malla/velocidades) y DEM 3D.
// Las figuras se dibujan como SVG desde la geometría (imprimibles) y el 3D como PNG.
// Propiedad: JPReyes / Conmuta.cl.
// ─────────────────────────────────────────────────────────────────────────────
const f = (v, d = 2) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d)));
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const MARCA = { autor: 'JPReyes', empresa: 'Conmuta.cl', logo: 'icons/icon-512.png' };

export function generarInforme(koi) {
  const html = construir(koi);
  const w = window.open('', '_blank');
  if (!w) { alert('Permite las ventanas emergentes para ver el informe.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function construir(koi) {
  const proj = koi.project || {};
  const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
  const sec = [];
  sec.push(portada(proj, fecha));
  sec.push(seccCuenca(koi));
  sec.push(seccHidrologia(koi));
  sec.push(seccHidraulica(koi));
  sec.push(seccSocavacion(koi));
  sec.push(seccEstructuras(koi));
  sec.push(secc2D(koi));
  sec.push(secc3D(koi));
  sec.push(pieLicencia());
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>Informe hidrológico-hidráulico · ${esc(proj.name || 'koi-flow')}</title>
    <style>${CSS}</style></head><body>
    <div class="toolbar no-print"><button onclick="window.print()">🖨 Imprimir / PDF</button>
      <span>Informe generado por koi-flow · ${MARCA.autor} / ${MARCA.empresa}</span></div>
    <main>${sec.join('\n')}</main></body></html>`;
}

// ── Portada / licencia ────────────────────────────────────────────────────────
function portada(proj, fecha) {
  return `<section class="portada">
    <img src="${MARCA.logo}" class="logo" alt="logo" onerror="this.style.display='none'">
    <h1>Estudio hidrológico e hidráulico</h1>
    <h2>${esc(proj.name || 'Proyecto')}</h2>
    <p class="fecha">${fecha}</p>
    <div class="lic">Elaborado con <b>koi-flow</b> — software propiedad de <b>${MARCA.autor} / ${MARCA.empresa}</b>.
      Metodologías según Manual de Carreteras (MC-V3, Vol. 3) y DGA.</div>
    <p class="idx-h">Contenido</p>
    <ol class="idx"><li>Cuenca y morfometría</li><li>Hidrología (estaciones y frecuencia)</li>
      <li>Hidráulica (secciones y eje)</li><li>Socavación</li><li>Estructuras</li>
      <li>Modelación 2D (inundación)</li><li>Relieve 3D</li></ol></section>`;
}
function pieLicencia() {
  return `<section class="pie"><hr><p>© ${new Date().getFullYear()} <b>${MARCA.autor} / ${MARCA.empresa}</b> · koi-flow.
    Documento generado automáticamente; los resultados deben ser revisados por un profesional competente.</p></section>`;
}

// ── 1 · Cuenca ────────────────────────────────────────────────────────────────
function seccCuenca(koi) {
  const cuencas = (koi.map?.getPoints?.() || []).filter((p) => p.cuenca);
  let body = `<p>La cuenca aportante se delinea automáticamente por análisis de dirección de flujo <b>D8</b>
    sobre un DEM (Terrarium): llenado de depresiones (priority-flood) → direcciones de flujo → acumulación →
    ajuste del exutorio al cauce → trazado del parteaguas. La morfometría (área, perímetro, pendiente, tiempo de
    concentración) alimenta el análisis hidrológico.</p>
    <div class="formula">Tiempo de concentración (California/Kirpich): <i>t<sub>c</sub></i> = 0.0195 · (L<sup>3</sup>/H)<sup>0.385</sup></div>`;
  if (!cuencas.length) { body += `<p class="nd">No hay cuencas delineadas en el proyecto.</p>`; return sección('1', 'Cuenca y morfometría', body); }
  for (const p of cuencas) {
    const m = p.cuenca.morfometria || {};
    const rows = Object.entries(m).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, f(v)]);
    body += `<h4>${esc(p.nombre)}</h4>
      <div class="fig-row">${svgPoligono(p.cuenca.polygonSuave || p.cuenca.polygon, '#128aa5', 'rgba(30,167,197,.15)')}
      ${tabla(['Parámetro', 'Valor'], rows)}</div>`;
  }
  return sección('1', 'Cuenca y morfometría', body);
}

// ── 2 · Hidrología ────────────────────────────────────────────────────────────
function seccHidrologia(koi) {
  const est = koi.map?._stations || [];
  const pl = est.filter((e) => e.tipo === 'pluviometrica'), fl = est.filter((e) => e.tipo === 'fluviometrica');
  let body = `<p>En zonas áridas del norte el análisis se apoya en la <b>fluviometría</b> (transposición de crecidas,
    hidrograma unitario) más que en las curvas IDF. Se ajustan las 6 distribuciones del MC a la serie de máximos
    anuales y se elige la de mejor ajuste (menor χ² entre las aceptadas).</p>
    <div class="formula">Gumbel: <i>x<sub>T</sub></i> = x̄ + K<sub>T</sub>·s ,&nbsp; K<sub>T</sub> = −(√6/π)·[0.5772 + ln(ln(T/(T−1)))]</div>`;
  const filaEst = (e) => [esc(e.nombre), e.bna, f(e.dist, 1) + ' km', e.n_anios ?? '—'];
  body += `<h4>Estaciones pluviométricas cercanas (${pl.length})</h4>` +
    (pl.length ? tabla(['Estación', 'BNA', 'Distancia', 'Años'], pl.map(filaEst)) : '<p class="nd">Sin estaciones cargadas.</p>');
  body += `<h4>Estaciones fluviométricas cercanas (${fl.length})</h4>` +
    (fl.length ? tabla(['Estación', 'BNA', 'Distancia', 'Años'], fl.map(filaEst)) : '<p class="nd">Sin estaciones cargadas.</p>');
  return sección('2', 'Hidrología', body);
}

// ── 3 · Hidráulica ────────────────────────────────────────────────────────────
function seccHidraulica(koi) {
  const b = koi.bati, secs = b?.secciones || [];
  let body = `<p>El eje hidráulico se resuelve por <b>Manning</b> (régimen normal) en cada sección y por el método
    del <b>paso estándar</b> (standard step) a lo largo del cauce, con pérdidas por fricción y por
    contracción/expansión. La dirección del flujo se determina por el descenso del lecho / eje dibujado.</p>
    <div class="formula">Manning: <i>V</i> = (1/n)·R<sub>h</sub><sup>2/3</sup>·J<sup>1/2</sup> ,&nbsp; <i>Q</i> = V·A ,&nbsp; Fr = V/√(g·A/B)</div>`;
  if (b?._flujo) body += `<p><b>Dirección del flujo:</b> ${esc(b._flujo.arriba?.nombre || '—')} → ${esc(b._flujo.abajo?.nombre || '—')}
    · Pendiente media J = ${f(b._flujo.Jmedia, 4)} (${f(b._flujo.Jmedia * 100)} %).</p>`;
  if (b?._remanso) body += `<h4>Eje hidráulico longitudinal</h4>${svgPerfil(b._remanso)}`;
  if (!secs.length) { body += `<p class="nd">No hay secciones trazadas.</p>`; return sección('3', 'Hidráulica', body); }
  body += `<h4>Secciones transversales (${secs.length})</h4>`;
  for (const s of secs) {
    if (!s.res) continue;
    body += `<div class="sec-card"><h5>${esc(s.nombre)}${s.res.fuente2D ? ' · WSE del 2D' : ''}</h5>
      ${svgSeccion(s)}
      ${tabla(['Magnitud', 'Valor'], [
        ['WSE (cota agua)', f(s.res.WSE) + ' m'], ['Profundidad máx', f(s.res.profMax) + ' m'],
        ['Ancho B', f(s.res.B) + ' m'], ['Área A', f(s.res.A) + ' m²'],
        ['Velocidad V', f(s.res.V) + ' m/s'], ['Froude', f(s.res.Fr) + ' (' + esc(s.res.regimen || '') + ')'],
        ...(s.obstr ? [['Angostado por pilas', `B ${f(s.res.B)}→${f(s.obstr.Bef)} m · V→${f(s.obstr.Vobs)} m/s`]] : []),
      ])}</div>`;
  }
  return sección('3', 'Hidráulica', body);
}

// ── 4 · Socavación ────────────────────────────────────────────────────────────
function seccSocavacion(koi) {
  const b = koi.bati, secs = (b?.secciones || []).filter((s) => s.soc);
  let body = `<p>La <b>socavación general</b> por contracción se evalúa por <b>Lischtvan-Lebediev</b> (por vertical y
    <b>por franjas</b>, ya que la velocidad varía en la sección) y por <b>Neill</b> (velocidad competente), con la
    granulometría por estratos y tope en la roca; se adopta la envolvente. La <b>socavación local en pila</b> se
    evalúa con ≥4 métodos del MC y se adopta el máximo.</p>
    <div class="formula">Lischtvan-Lebediev: <i>d<sub>s</sub></i> = [ α·h<sup>5/3</sup> / (0.68·β·D<sub>50</sub><sup>0.28</sup>) ]<sup>1/(1+x)</sup></div>
    <div class="formula">Neill (vel. competente): <i>V<sub>c</sub></i> = k·h<sup>1/6</sup>·D<sup>1/3</sup></div>
    <div class="formula">HEC-18/CSU: <i>y<sub>s</sub></i> = 2.0·y<sub>1</sub>·K<sub>1</sub>K<sub>2</sub>K<sub>3</sub>·(a/y<sub>1</sub>)<sup>0.65</sup>·Fr<sub>1</sub><sup>0.43</sup></div>`;
  if (!secs.length) { body += `<p class="nd">No hay socavación calculada.</p>`; return sección('4', 'Socavación', body); }
  const rows = secs.map((s) => [esc(s.nombre),
    f(s.soc.general?.socavMax), f(s.soc.generalNeill?.socav), f(s.soc.franjas?.socavMax),
    f(s.soc.generalAdoptada), s.soc.localAdoptada != null ? f(s.soc.localAdoptada) : '—', f(s.soc.socavTotal)]);
  body += tabla(['Sección', 'LL vert.', 'Neill', 'Por franjas', 'General adopt.', 'Local pila', 'Total'], rows);
  const conPila = secs.filter((s) => s.soc.metodosPila);
  if (conPila.length) {
    body += `<h4>Socavación local en pila · comparación de métodos</h4>`;
    const pr = conPila.map((s) => { const m = s.soc.metodosPila; return [esc(s.nombre), f(m.csu), f(m.froehlich), f(m.laursenToch), f(m.breusers), f(m.larras), f(m.max)]; });
    body += tabla(['Sección', 'HEC-18', 'Froehlich', 'Laursen-Toch', 'Breusers', 'Larras', 'Adoptada'], pr);
  }
  return sección('4', 'Socavación', body);
}

// ── 5 · Estructuras ───────────────────────────────────────────────────────────
function seccEstructuras(koi) {
  const es = koi.estr?.estructuras || [];
  let body = `<p>Las estructuras (puentes, alcantarillas, defensas) se integran como en HEC-RAS: en <b>2D</b> se
    "queman" en el terreno (celdas altas que el flujo rodea) y en <b>1D</b> angostan la sección y aportan el ancho de
    pila a la socavación local; el tablero fija la cota inferior (tope de la lámina de agua).</p>`;
  if (!es.length) { body += `<p class="nd">No hay estructuras colocadas.</p>`; return sección('5', 'Estructuras', body); }
  const rows = es.map((e) => [esc(e.nombre), e.solido ? 'sólida (bloquea)' : 'pasa por encima',
    e.zBase != null ? f(e.zBase) + ' m' : '—', Object.entries(e.params).map(([k, v]) => `${k}=${f(v)}`).join(', ')]);
  body += tabla(['Estructura', 'Tipo', 'Cota base', 'Parámetros'], rows);
  // esquema: eje + posición de estructuras (planta)
  if (koi.bati?.eje) body += `<h4>Eje con estructuras (planta)</h4>${svgEjeEstr(koi.bati.eje, es)}`;
  return sección('5', 'Estructuras', body);
}

// ── 6 · 2D ────────────────────────────────────────────────────────────────────
function secc2D(koi) {
  const b = koi.bati, m = b?.mesh2d, r = b?.result2d;
  let body = `<p>La modelación bidimensional resuelve la <b>onda difusiva</b> (aproximación de las ecuaciones de aguas
    someras) sobre una malla triangular <b>refinada en el cauce</b> (más fina cerca del eje) con rugosidad por zona
    (cauce/planicie). Entrega la mancha de inundación, el campo de velocidades y las fases de inundación.</p>`;
  if (m) {
    body += `<h4>Malla de cálculo 2D</h4>${svgMalla(m)}
      ${tabla(['Magnitud', 'Valor'], [['Nodos', m.meta.nNodos], ['Triángulos', m.meta.nTri],
        ['Área dominio', f(m.meta.area_m2 / 1e4) + ' ha'], ['Resolución cauce/planicie', m.meta.hCauce + ' / ' + m.meta.hPlanicie + ' m']])}`;
  } else body += `<p class="nd">No hay malla 2D generada.</p>`;
  if (r) body += `<h4>Resultados 2D</h4>${tabla(['Magnitud', 'Valor'], [['Calado máximo', f(r.hmax) + ' m'],
    ['Velocidad máxima', f(r.Vmax) + ' m/s'], ['Nodos mojados', r.nMojados + ' / ' + (m?.nodes.length || '—')]])}
    ${svgInundacion(m, r)}`;
  return sección('6', 'Modelación 2D (inundación)', body);
}

// ── 7 · 3D ────────────────────────────────────────────────────────────────────
function secc3D(koi) {
  let body = `<p>Modelo digital de elevación del sector (DEM Terrarium fusionado con la batimetría CAD cuando existe),
    con el cauce, el eje y las estructuras embebidas.</p>`;
  const png = koi.scene?.snapshot?.();
  body += png ? `<img class="snap" src="${png}" alt="DEM 3D">`
    : `<p class="nd">Abre el relieve 3D (con el sector cargado) antes de generar el informe para incluir la vista.</p>`;
  return sección('7', 'Relieve 3D', body);
}

// ── Helpers de figuras (SVG) ──────────────────────────────────────────────────
function bboxOf(pts) { let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity; for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); } return { w, e, s, n }; }
function svgPoligono(coords, stroke, fill) {
  if (!coords || coords.length < 3) return '<p class="nd">Sin polígono.</p>';
  const W = 300, H = 220, pad = 10, bb = bboxOf(coords);
  const sx = (W - 2 * pad) / ((bb.e - bb.w) || 1), sy = (H - 2 * pad) / ((bb.n - bb.s) || 1), k = Math.min(sx, sy);
  const X = (x) => pad + (x - bb.w) * k, Y = (y) => H - pad - (y - bb.s) * k;
  const pts = coords.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
  return `<svg class="fig" viewBox="0 0 ${W} ${H}"><polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/></svg>`;
}
function svgEjeEstr(eje, estrs) {
  const all = [...eje]; for (const e of estrs) if (e.center) all.push(e.center); else if (e.planta) all.push(...e.planta);
  const W = 320, H = 200, pad = 12, bb = bboxOf(all);
  const k = Math.min((W - 2 * pad) / ((bb.e - bb.w) || 1e-6), (H - 2 * pad) / ((bb.n - bb.s) || 1e-6));
  const X = (x) => pad + (x - bb.w) * k, Y = (y) => H - pad - (y - bb.s) * k;
  const ejeP = eje.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
  const marks = estrs.map((e) => { const c = e.center || (e.planta && e.planta[0]); if (!c) return ''; return `<circle cx="${X(c[0]).toFixed(1)}" cy="${Y(c[1]).toFixed(1)}" r="4" fill="${e.solido ? '#a855f7' : '#f59e0b'}"/>`; }).join('');
  return `<svg class="fig" viewBox="0 0 ${W} ${H}"><polyline points="${ejeP}" fill="none" stroke="#a855f7" stroke-width="2" stroke-dasharray="5 4"/>${marks}</svg>`;
}
function svgSeccion(s) {
  const W = 340, H = 150, pad = 22;
  const xs = s.pts.map((p) => p.s), zs = s.pts.map((p) => p.z);
  const sMax = Math.max(...xs), zMin = Math.min(...zs);
  const fr = s.soc?.franjas?.franjas || [];
  const zBed = fr.length ? Math.min(...fr.map((p) => p.zFondo)) : zMin;
  const zTop = Math.max(s.res.WSE, Math.max(...zs)), zLo = Math.min(zMin, zBed) - 0.3, zHi = zTop + 0.3, zR = (zHi - zLo) || 1;
  const X = (v) => pad + (v / sMax) * (W - 2 * pad), Y = (v) => H - pad - ((v - zLo) / zR) * (H - 2 * pad);
  const terreno = s.pts.map((p) => `${X(p.s).toFixed(1)},${Y(p.z).toFixed(1)}`).join(' ');
  const wp = s.pts.filter((p) => p.z <= s.res.WSE);
  const agua = wp.length > 1 ? `<polygon points="${X(wp[0].s).toFixed(1)},${Y(s.res.WSE).toFixed(1)} ${X(wp[wp.length - 1].s).toFixed(1)},${Y(s.res.WSE).toFixed(1)} ${wp.map((p) => `${X(p.s).toFixed(1)},${Y(p.z).toFixed(1)}`).reverse().join(' ')}" fill="#38bdf8" fill-opacity="0.5"/>` : '';
  const soc = fr.length ? `<polyline points="${fr.map((p) => `${X(p.s).toFixed(1)},${Y(p.zFondo).toFixed(1)}`).join(' ')}" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4 3"/>` : '';
  return `<svg class="fig wide" viewBox="0 0 ${W} ${H}">${agua}<polyline points="${terreno}" fill="none" stroke="#a3805a" stroke-width="2"/>${soc}
    <line x1="${X(0)}" y1="${Y(s.res.WSE)}" x2="${X(sMax)}" y2="${Y(s.res.WSE)}" stroke="#0284c7" stroke-width="1" stroke-dasharray="2 2"/>
    <text x="${W - pad}" y="${(Y(s.res.WSE) - 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#0284c7">WSE ${f(s.res.WSE)}</text></svg>`;
}
function svgPerfil(r) {
  const secs = (r.perfil || []).map((p) => ({ st: p.station, wse: p.WSE, bed: p.WSE - p.profMax })).sort((a, b) => a.st - b.st);
  if (secs.length < 2) return '<p class="nd">Traza ≥2 secciones para el perfil.</p>';
  const W = 480, H = 170, pad = 26, st0 = secs[0].st, st1 = secs[secs.length - 1].st, dS = (st1 - st0) || 1;
  let zLo = Infinity, zHi = -Infinity; for (const s of secs) { zLo = Math.min(zLo, s.bed); zHi = Math.max(zHi, s.wse); }
  const zR = (zHi - zLo) || 1, X = (st) => pad + ((st - st0) / dS) * (W - 2 * pad), Y = (z) => H - pad - ((z - zLo) / zR) * (H - 2 * pad);
  const bed = secs.map((s) => `${X(s.st).toFixed(1)},${Y(s.bed).toFixed(1)}`).join(' ');
  const wse = secs.map((s) => `${X(s.st).toFixed(1)},${Y(s.wse).toFixed(1)}`).join(' ');
  const agua = wse + ' ' + secs.slice().reverse().map((s) => `${X(s.st).toFixed(1)},${Y(s.bed).toFixed(1)}`).join(' ');
  return `<svg class="fig wide" viewBox="0 0 ${W} ${H}"><polygon points="${agua}" fill="#38bdf8" fill-opacity="0.4"/>
    <polyline points="${wse}" fill="none" stroke="#0284c7" stroke-width="1.6"/><polyline points="${bed}" fill="none" stroke="#a3805a" stroke-width="2"/>
    <text x="${pad}" y="${H - 6}" font-size="8" fill="#666">aguas arriba</text><text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="#666">aguas abajo →</text></svg>`;
}
function svgMalla(m) {
  const W = 420, H = 300, pad = 8;
  const xs = m.nodes.map((n) => n.x), ys = m.nodes.map((n) => n.y);
  const bw = Math.min(...xs), be = Math.max(...xs), bs = Math.min(...ys), bn = Math.max(...ys);
  const k = Math.min((W - 2 * pad) / ((be - bw) || 1), (H - 2 * pad) / ((bn - bs) || 1));
  const X = (x) => pad + (x - bw) * k, Y = (y) => H - pad - (y - bs) * k;
  let edges = '';
  for (const t of m.tris) { const a = m.nodes[t[0]], b = m.nodes[t[1]], c = m.nodes[t[2]]; const enC = a.enCauce || b.enCauce || c.enCauce; edges += `<polygon points="${X(a.x).toFixed(1)},${Y(a.y).toFixed(1)} ${X(b.x).toFixed(1)},${Y(b.y).toFixed(1)} ${X(c.x).toFixed(1)},${Y(c.y).toFixed(1)}" fill="${enC ? 'rgba(56,189,248,.18)' : 'none'}" stroke="#94a3b8" stroke-width="0.4"/>`; }
  return `<svg class="fig wide" viewBox="0 0 ${W} ${H}">${edges}</svg>
    <p class="cap">Malla triangular — celdas azules = cauce (refinamiento más fino). ${m.meta.nTri} triángulos.</p>`;
}
function svgInundacion(m, r) {
  if (!m || !r?.h) return '';
  const W = 420, H = 300, pad = 8;
  const xs = m.nodes.map((n) => n.x), ys = m.nodes.map((n) => n.y);
  const bw = Math.min(...xs), be = Math.max(...xs), bs = Math.min(...ys), bn = Math.max(...ys);
  const k = Math.min((W - 2 * pad) / ((be - bw) || 1), (H - 2 * pad) / ((bn - bs) || 1));
  const X = (x) => pad + (x - bw) * k, Y = (y) => H - pad - (y - bs) * k;
  const hmax = r.hmax || 1;
  let tri = '';
  for (const t of m.tris) {
    const hm = (r.h[t[0]] + r.h[t[1]] + r.h[t[2]]) / 3; if (hm <= 0.02) continue;
    const a = m.nodes[t[0]], b = m.nodes[t[1]], c = m.nodes[t[2]], al = Math.min(0.85, 0.2 + hm / hmax);
    tri += `<polygon points="${X(a.x).toFixed(1)},${Y(a.y).toFixed(1)} ${X(b.x).toFixed(1)},${Y(b.y).toFixed(1)} ${X(c.x).toFixed(1)},${Y(c.y).toFixed(1)}" fill="rgba(37,99,235,${al.toFixed(2)})"/>`;
  }
  return `<svg class="fig wide" viewBox="0 0 ${W} ${H}">${tri}</svg><p class="cap">Mancha de inundación (azul = calado, hmax ${f(hmax)} m).</p>`;
}

// ── Helpers HTML ──────────────────────────────────────────────────────────────
function sección(n, titulo, body) { return `<section class="cap-sec"><h3><span class="num">${n}</span> ${esc(titulo)}</h3>${body}</section>`; }
function tabla(headers, rows) {
  if (!rows || !rows.length) return '<p class="nd">Sin datos.</p>';
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const CSS = `
  * { box-sizing: border-box; }
  body { font: 13px/1.5 "Segoe UI", system-ui, sans-serif; color: #1a2230; margin: 0; background: #eef1f6; }
  .toolbar { position: sticky; top: 0; background: #0b1018; color: #cfe; padding: 8px 16px; display: flex; gap: 14px; align-items: center; }
  .toolbar button { background: #128aa5; color: #fff; border: 0; border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
  main { max-width: 820px; margin: 16px auto; background: #fff; padding: 40px 48px; box-shadow: 0 2px 16px rgba(0,0,0,.12); }
  .portada { text-align: center; padding: 40px 0 30px; border-bottom: 3px solid #128aa5; }
  .portada .logo { width: 90px; height: 90px; }
  .portada h1 { font-size: 26px; margin: 10px 0 2px; }
  .portada h2 { font-size: 18px; color: #128aa5; margin: 0; font-weight: 600; }
  .portada .fecha { color: #667; }
  .lic { max-width: 560px; margin: 14px auto; font-size: 12px; color: #445; background: #f4f6f9; border: 1px solid #dde3ec; border-radius: 8px; padding: 10px 14px; }
  .idx-h { font-weight: 700; margin: 20px 0 4px; }
  .idx { display: inline-block; text-align: left; color: #334; }
  .cap-sec { margin: 26px 0; page-break-inside: avoid; }
  h3 { font-size: 17px; border-bottom: 2px solid #e2e8f1; padding-bottom: 5px; }
  h3 .num { background: #128aa5; color: #fff; border-radius: 6px; padding: 1px 9px; margin-right: 8px; font-size: 15px; }
  h4 { font-size: 14px; margin: 16px 0 6px; color: #234; }
  h5 { margin: 4px 0; font-size: 13px; }
  .formula { background: #f7f9fc; border-left: 3px solid #128aa5; padding: 7px 12px; margin: 8px 0; font-family: "Cambria Math", Georgia, serif; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px; }
  th, td { border: 1px solid #d5dce6; padding: 5px 8px; text-align: right; }
  th { background: #f0f4f9; } th:first-child, td:first-child { text-align: left; }
  .fig { width: 300px; height: auto; background: #fbfcfe; border: 1px solid #e2e8f1; border-radius: 8px; }
  .fig.wide { width: 100%; max-width: 480px; }
  .fig-row { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .fig-row table { flex: 1; min-width: 240px; }
  .sec-card { border: 1px solid #e2e8f1; border-radius: 8px; padding: 8px 12px; margin: 10px 0; page-break-inside: avoid; }
  .snap { width: 100%; border-radius: 8px; border: 1px solid #e2e8f1; }
  .cap { font-size: 11px; color: #667; margin: 2px 0 0; }
  .nd { color: #99a; font-style: italic; }
  .pie { margin-top: 30px; font-size: 11px; color: #778; }
  @media print { body { background: #fff; } .no-print { display: none; } main { box-shadow: none; margin: 0; max-width: none; } }
`;
