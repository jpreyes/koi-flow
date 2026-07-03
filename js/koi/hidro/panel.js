// ─────────────────────────────────────────────────────────────────────────────
// panel.js — Panel UI de hidrología (drawer lateral). Corre el pipeline para el
// caso del tramo seleccionado y muestra: línea de nieve → área pluvial → frecuencia
// → PP diseño → IDF → Tc → caudales (pluviales REFERENCIALES + transposición que
// GOBIERNA) → adoptados. Look & feel koi (variables de css/koi.css).
// ─────────────────────────────────────────────────────────────────────────────
import { correrPipelinePunto } from './pipeline.js?v=4';
import { analizar } from './frecuencia.js?v=4';
import { transponer, transponerRegional } from './transposicion.js?v=4';
import { caudalesHU } from './hidrograma.js?v=4';
import { ppDiseno, grunsky } from './idf.js?v=4';
import { racional, verniKing, dgaAC } from './caudales.js?v=4';
import { estacionesCercanas, estacionRecomendada, cargarSerie, centroideTramo, resetCatalogo, descargarSerieDGA } from '../datos/dga.js?v=4';
import { fetchJSON } from '../datos/fetch_json.js?v=4';
import { calcular as tcCalcular } from './tc.js?v=4';
import { cuencaGeoJSON, cuencaKMZ, descargar } from '../cuenca/exportar.js?v=4';
import { cuencaShapefileZip } from '../cuenca/shapefile.js?v=4';
import { suavizar } from '../cuenca/delineacion.js?v=4';
import { perfilDesdeLinea } from '../hidraulica/secciones.js?v=4';
import { nivelNormal } from '../hidraulica/manning.js?v=4';
import { evaluarSocavacion } from '../hidraulica/socavacion.js?v=4';

const TS = [2, 5, 10, 25, 50, 100, 150, 200];
const f1 = (v) => (v == null || isNaN(v) ? '—' : Math.abs(v) < 10 ? Number(v).toFixed(2) : Number(v).toFixed(1));
const f2 = (v) => (v == null || isNaN(v) ? '—' : Number(v).toFixed(2));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export class HydroPanel {
  constructor() {
    this.tramo = null;
  }

  // El panel vive dentro del Dock (pestañas laterales). Cada concern usa su host.
  setDock(dock) {
    this.dock = dock;
    this.elPanel = dock.el;             // raíz para querySelector de inputs por id
    this.hosts = dock.hosts;
    this.elBody = dock.hosts.hidro;     // host activo por defecto
    // botón "Calcular hidrología" (modo tramo) en la cabecera del host hidro
    this._renderDEM(null);   // la red de drenaje (vista del mapa) está disponible sin proyecto/tramo
  }

  setMap(map) { this.map = map; }
  setTramo(t) {
    this.tramo = t;
    if (!this.hosts) return;
    if (this.dock && this.dock.active !== 'bati') this.dock.setSub(t ? `Sector: ${t.name}` : '—');
    this._renderDEM(t);   // t puede ser null: la red de drenaje se muestra igual (opera sobre la vista)
    if (!t) return;
    this.hosts.hidraulica.innerHTML = ''; this.elBody = this.hosts.hidraulica; this._seccionEje(t);
    this._renderSocav();
  }
  open() { this.dock?.show('hidro'); }
  close() { this.dock?.close(); }
  toggle() { if (this.dock?.isOpen() && this.dock.active === 'hidro') this.dock.close(); else this.dock?.show('hidro'); }

  _clearHosts(keys) { for (const k of keys) if (this.hosts[k]) this.hosts[k].innerHTML = ''; }

  async run() {
    if (!this.tramo) return;
    this.dock.show('hidro');
    this.dock.setSub(`Sector: ${this.tramo.name}`);
    this._clearHosts(['cuenca', 'hidro', 'hidraulica', 'socav']);
    this.hosts.hidro.innerHTML = '<div class="hp-loading">Calculando…</div>';
    try {
      // HIDRÁULICA: eje hidráulico (sección en el cruce, desde el DEM del tramo).
      this.elBody = this.hosts.hidraulica; this._seccionEje(this.tramo);
      // SOCAVACIÓN (a partir del eje).
      this.elBody = this.hosts.socav; this._renderSocav();
      // DEM.
      this._renderDEM(this.tramo);
      // HIDROLOGÍA: datos DGA + (si hay caso) pipeline completo.
      this.hosts.hidro.innerHTML = '';
      this.elBody = this.hosts.hidro;
      const datos = el('div'); this.hosts.hidro.appendChild(datos);
      this.elBody = datos;
      await this._renderDatos(this.tramo);
      // La hidrología se corre desde la cuenca delineada + estaciones elegidas
      // (correrPipelinePunto), NO por un caso hardcodeado atado al nombre del tramo.
    } catch (e) {
      this.hosts.hidro.innerHTML = `<div class="hp-err">Error: ${e.message}</div>`;
      console.error(e);
    }
  }

  async _renderDatos(tramo) {
    const f = tramo.feature;
    if (!f) return;
    const [lon, lat] = centroideTramo(f);
    const pluvio = await estacionesCercanas([lon, lat], { tipo: 'pluviometrica', n: 4 });
    const fluvio = await estacionesCercanas([lon, lat], { tipo: 'fluviometrica', n: 4 });

    const s = this._section('Datos DGA cercanos', { cls: 'gov', txt: 'fuente CR2/DGA' });
    if (!pluvio.length && !fluvio.length) {
      s.appendChild(el('p', 'hp-note', 'No hay catálogo DGA cargado. Genera datos con tools/fetch_dga.py.'));
      return;
    }
    this.map?.showStations([...pluvio, ...fluvio]);
    const mkTable = (arr) => {
      const t = this._table(['Dist', 'Estación', 'n años', 'Periodo'],
        arr.map((e) => [`${e.dist.toFixed(0)} km`, e.nombre, String(e.n_anios), e.periodo]));
      [...t.querySelectorAll('tbody tr')].forEach((tr, i) => {
        tr.classList.add('hp-row-click'); tr.dataset.bna = arr[i].bna; tr.dataset.tipo = arr[i].tipo;
        tr.addEventListener('click', () => {
          [...s.querySelectorAll('tbody tr.sel')].forEach((x) => x.classList.remove('sel'));
          tr.classList.add('sel');
          this.map?.highlightStation(arr[i]);
          this._renderFrecuencia(arr[i]);
        });
      });
      return t;
    };
    if (pluvio.length) {
      s.appendChild(el('div', 'hp-mini', 'Pluviométricas'));
      s.appendChild(mkTable(pluvio));
    }
    if (fluvio.length) {
      s.appendChild(el('div', 'hp-mini', 'Fluviométricas (control para transposición)'));
      s.appendChild(mkTable(fluvio));
    }
    s.appendChild(el('p', 'hp-note', 'Haz clic en una estación para ver su análisis de frecuencia.'));

    // contenedor para la frecuencia de la estación elegida
    this._freqHost = el('div'); this._freqHost.id = 'hp-freq';
    this.elBody.appendChild(this._freqHost);

    // estación de control sugerida por defecto (misma quebrada > registro largo)
    const rec = await estacionRecomendada(f, 'fluviometrica', { minAnios: 15 })
             || await estacionRecomendada(f, 'pluviometrica', { minAnios: 15 });
    if (rec) {
      const tr = s.querySelector(`tbody tr[data-bna="${rec.bna}"][data-tipo="${rec.tipo}"]`);
      if (tr) tr.classList.add('sel');
      this.map?.highlightStation(rec, { pan: false });
      await this._renderFrecuencia(rec);
    }
  }

  async _renderFrecuencia(est) {
    if (!this._freqHost) return;
    this._freqHost.innerHTML = '<div class="hp-loading">Analizando…</div>';
    const serie = await cargarSerie(est);
    const vals = Object.values(serie.serie);
    const an = analizar(vals, { T: TS });
    const q = an.resultados[an.mejor].quantiles;
    this._freqHost.innerHTML = '';
    const prev = this.elBody; this.elBody = this._freqHost;   // _section escribe en elBody
    const sa = this._section(`Frecuencia · ${serie.nombre}`);
    this.elBody = prev;
    sa.appendChild(el('div', 'hp-kv', `
      <div><span>Variable</span><b>${serie.variable}</b></div>
      <div><span>Registro</span><b>${serie.n_anios} años · ${serie.fuente.split('·').pop().trim()}</b></div>
      <div><span>Mejor ajuste</span><b>${an.mejor}</b></div>`));
    sa.appendChild(this._table(
      ['T [años]', ...TS.map(String)],
      [[`Q/PP [${serie.unidad}]`, ...TS.map((T) => f1(q[T]))]],
    ));
    sa.appendChild(el('p', 'hp-note', serie.tipo === 'fluviometrica'
      ? 'Caudal medio diario máximo anual. Para diseño aplicar el factor a instantáneo (zona homogénea) y transponer por área a la cuenca del tramo.'
      : 'Máximo anual de PP diaria. Insumo del análisis de frecuencia pluvial.'));
  }

  // Estado de carga mientras se delinea la cuenca del punto (en la pestaña CUENCA).
  cargandoCuenca(p, msg) {
    this.dock.show('cuenca');
    this.dock.setSub(`Análisis · ${p.nombre}`);
    this.hosts.cuenca.innerHTML = `<div class="hp-loading">⛰️ Delineando cuenca de ${p.nombre}…<br><span class="hp-note">${msg || ''}</span></div>`;
  }
  errorCuenca(p, msg) {
    this.hosts.cuenca.innerHTML = `<div class="hp-err">No se pudo delinear la cuenca: ${msg}</div>`;
  }

  setPuntos(puntos) { this._puntos = puntos || []; }

  // Recalcula la cuenca de un punto: borra la actual (mapa + datos) y vuelve a
  // delinear con el snap actual. Se abre la pestaña Cuenca para ver el progreso.
  async recalcularCuenca(p) {
    if (!p) return;
    this.map?.selectPoint?.(p.id);
    this.map?.clearCuenca?.(p.id);
    p.cuenca = null; p.cuencaHB = null;
    this._punto = p;
    this.dock.show('cuenca');
    this._renderCuenca(p);          // deja el input #cu-snap disponible
    await this._calcularCuenca(p);
  }

  async _calcularCuenca(p) {
    if (!this.calcularCuenca) return;
    const sm = parseFloat(this.elPanel.querySelector('#cu-snap')?.value);
    if (isFinite(sm)) { p.snapMeters = sm; this._snapM = sm; }
    this.cargandoCuenca(p, 'Iniciando…');
    try {
      await this.calcularCuenca(p, (msg) => this.cargandoCuenca(p, msg));
    } catch (e) {
      console.error(e); this.errorCuenca(p, e.message); return;
    }
    this._renderCuenca(p);
    this.dock.show('cuenca');
    // refresca hidrología (ahora el pipeline puede usar la morfometría)
    if (this._punto?.id === p.id) { this.elBody = this.hosts.hidro; }
  }

  // ── Pestaña CUENCA (independiente de hidrología) ─────────────────────────────
  _renderCuenca(p) {
    const host = this.hosts.cuenca; host.innerHTML = ''; this.elBody = host;
    // "Agregar punto" es el consumible que desbloquea el resto → siempre disponible aquí
    const addBtn = el('button', 'hp-run', '＋ Agregar punto de análisis (clic en el mapa)');
    addBtn.style.margin = '0 0 8px';
    addBtn.addEventListener('click', () => { this.map?.setPickMode(true); });
    host.appendChild(addBtn);
    if (!p) { host.appendChild(el('p', 'hp-note', 'Sin punto seleccionado. Pulsa el botón y haz clic en el cauce; luego delinea la cuenca. Cada punto habilita hidrología, hidráulica y socavación.')); return; }
    // control de SNAP (ajustable): distancia de enganche al cauce. 0 = punto exacto.
    const snapForm = el('div', 'hp-form');
    snapForm.innerHTML = `<label class="hp-f"><span>Snap al cauce [m] (0 = exacto)</span><input id="cu-snap" type="number" value="${this._snapM ?? 60}"></label>`;
    host.appendChild(snapForm);
    host.appendChild(el('p', 'hp-note', p.cuenca?.enRed ? '✓ Delineada sobre la red de drenaje que ves (respeta esos flujos). Recalcula la red 🌊 con la vista ampliada si la cuenca se corta.' : 'Tip: calcula la 🌊 red de drenaje (pestaña DEM) y la cuenca se delineará sobre ESOS mismos flujos. Baja el snap para pinchar un cauce chico.'));
    if (p.cuenca?.morfometria) {
      const m = p.cuenca.morfometria;
      const sCu = this._section('Cuenca aportante (delineada)', { cls: 'gov', txt: `DEM z${p.cuenca.grid?.zoom ?? '?'}` });
      sCu.appendChild(el('div', 'hp-kv', `
        <div><span>Punto</span><b>${p.nombre}</b></div>
        <div><span>Área</span><b>${m.A} km²</b></div>
        <div><span>Cauce principal L</span><b>${m.L} km</b></div>
        <div><span>Long. al centroide Lg</span><b>${m.Lg} km</b></div>
        <div><span>Pendiente media S</span><b>${(m.S * 100).toFixed(2)} %</b></div>
        <div><span>Desnivel H</span><b>${m.H} m</b> </div>
        <div><span>Cotas (salida–máx)</span><b>${m.cotaSalida}–${m.cotaMax} m</b></div>
        <div><span>Perímetro · Kc</span><b>${m.perimetro_km} km · ${m.Kc}</b></div>`));
      if (p.cuenca.tocaBorde) sCu.appendChild(el('p', 'hp-note', '⚠ La cuenca alcanzó el borde del DEM máximo; el área puede estar subestimada.'));
      const suave = !!p.cuenca.polygonSuave;
      const polyExp = p.cuenca.polygonSuave || p.cuenca.polygon;
      sCu.appendChild(el('p', 'hp-note', suave ? `〰️ Borde suavizado (tol ${this._suavTolM ?? 35} m, ${this._suavIter ?? 2} iter) — se exporta suavizado.` : 'Borde sin suavizar (escalonado por celdas del DEM).'));
      // Parámetros de suavizado ajustables (para que no sea ni mucho ni poco).
      const suavForm = el('div', 'hp-form');
      suavForm.innerHTML = `<label class="hp-f"><span>Tolerancia [m] (simplifica el escalón)</span><input id="cu-tolm" type="number" step="5" value="${this._suavTolM ?? 35}"></label>
        <label class="hp-f"><span>Redondeo (iter. Chaikin, 0=nada)</span><input id="cu-iter" type="number" min="0" max="6" value="${this._suavIter ?? 2}"></label>`;
      sCu.appendChild(suavForm);
      const exp = el('div', 'hp-dl');
      exp.innerHTML = `<button class="hp-mini-btn" data-x="suav">〰️ Suavizar / re-aplicar</button>
        ${suave ? '<button class="hp-mini-btn" data-x="nosuav">↩ Sin suavizar</button>' : ''}
        <button class="hp-mini-btn" data-x="shp">⬇ Shapefile</button><button class="hp-mini-btn" data-x="kmz">⬇ KMZ</button><button class="hp-mini-btn" data-x="geojson">⬇ GeoJSON</button><button class="hp-mini-btn" data-x="re">↻ Recalcular</button>`;
      sCu.appendChild(exp);
      const base = `cuenca_${String(p.nombre).replace(/\s+/g, '_')}`;
      const props = { nombre: p.nombre, area_km2: m.A, L_km: m.L, S: m.S, H_m: m.H, suavizado: suave ? 'si' : 'no' };
      exp.querySelector('[data-x="suav"]').addEventListener('click', () => {
        const tolM = parseFloat(this.elPanel.querySelector('#cu-tolm').value);
        const iter = parseInt(this.elPanel.querySelector('#cu-iter').value, 10);
        this._suavTolM = isFinite(tolM) ? tolM : 35;
        this._suavIter = isFinite(iter) ? Math.max(0, iter) : 2;
        p.cuenca.polygonSuave = suavizar(p.cuenca.polygon, { tolM: this._suavTolM, iter: this._suavIter, latRef: p.lat });
        this.map?.showCuenca(p.id, p.cuenca.polygonSuave);
        this._renderCuenca(p);
      });
      exp.querySelector('[data-x="nosuav"]')?.addEventListener('click', () => {
        p.cuenca.polygonSuave = null;
        this.map?.showCuenca(p.id, p.cuenca.polygon);
        this._renderCuenca(p);
      });
      exp.querySelector('[data-x="shp"]').addEventListener('click', () => descargar(`${base}_shp.zip`, cuencaShapefileZip(polyExp, props, base)));
      exp.querySelector('[data-x="kmz"]').addEventListener('click', () => descargar(`${base}.kmz`, cuencaKMZ(polyExp, props)));
      exp.querySelector('[data-x="geojson"]').addEventListener('click', () => descargar(`${base}.geojson`, JSON.stringify(cuencaGeoJSON(polyExp, props), null, 1), 'application/geo+json'));
      exp.querySelector('[data-x="re"]').addEventListener('click', () => this.recalcularCuenca(p));

      // ── Tiempo de concentración (todos los métodos) ──────────────────────────
      const sTc = this._section('Tiempo de concentración');
      const cnForm = el('div', 'hp-form');
      cnForm.innerHTML = `<label class="hp-f"><span>Curva número CN (SCS, rural)</span><input id="cu-cn" type="number" value="${this._cn ?? 75}"></label>
        <label class="hp-f"><span>Zona homogénea DGA (I–VI)</span><input id="cu-zona" value="${this._zona ?? 'I'}"></label>
        <label class="hp-f"><span>Adopción del tc</span><select id="cu-tcad">
          <option value="max">Máximo (conservador)</option><option value="promedio">Promedio</option><option value="min">Mínimo</option></select></label>`;
      sTc.appendChild(cnForm);
      const tcOut = el('div'); sTc.appendChild(tcOut);
      const renderTc = () => {
        const CN = parseFloat(this.elPanel.querySelector('#cu-cn').value) || 75; this._cn = CN;
        this._zona = this.elPanel.querySelector('#cu-zona').value || 'I';
        const adop = this.elPanel.querySelector('#cu-tcad').value;
        const r = tcCalcular({ L: m.L, S: m.S, A: m.A, H: m.H, Hm: m.H * 0.5, CN }, { adopcion: adop });
        const rows = r.metodos.map((x) => `<tr${x.tc === r.adoptado && x.aplica ? ' class="hl"' : ''}>
          <td>${x.metodo}</td><td>${x.aplica && isFinite(x.tc) ? x.tc.toFixed(2) + ' h' : '—'}</td>
          <td>${x.aplica ? '✓' : (x.motivo || 'n/a')}</td></tr>`).join('');
        tcOut.innerHTML = `<table class="hp-tbl"><thead><tr><th>Método</th><th>t<sub>c</sub></th><th>Aplica</th></tr></thead><tbody>${rows}</tbody></table>
          <div class="hp-kv"><div><span>Promedio de válidos</span><b>${isFinite(r.promedio) ? r.promedio.toFixed(2) + ' h' : '—'}</b></div>
          <div><span>Adoptado (${adop})</span><b>${isFinite(r.adoptado) ? r.adoptado.toFixed(2) + ' h' : '—'}</b></div></div>
          <p class="hp-note">Métodos MC-V3/DGA: Kirpich, California (C.C.P.), Giandotti, Normas Españolas, SCS. Hm (Giandotti) ≈ H/2. La <b>CN</b> y la <b>Zona</b> también se usan en los caudales (SCS/HU y método DGA).</p>`;
      };
      renderTc();
      cnForm.querySelector('#cu-cn').addEventListener('change', renderTc);
      cnForm.querySelector('#cu-zona').addEventListener('change', renderTc);
      cnForm.querySelector('#cu-tcad').addEventListener('change', renderTc);
    } else {
      const sCu = this._section('Cuenca aportante');
      sCu.appendChild(el('div', 'hp-kv', `<div><span>Punto</span><b>${p.nombre}</b></div>`));
      const b = el('button', 'hp-run', '⛰️ Calcular cuenca aportante');
      b.addEventListener('click', () => this._calcularCuenca(p));
      sCu.appendChild(b);
      sCu.appendChild(el('p', 'hp-note', 'Delinea la cuenca que aporta a este punto desde el DEM (no se recalcula sola). Autocompleta área y morfometría en los métodos de hidrología.'));
    }
    this._renderCuencaHB(p);
  }

  // Cuenca aportante COMPLETA (HydroBASINS) — el "big picture" hasta la divisoria.
  _renderCuencaHB(p) {
    const s = this._section('Cuenca aportante total (big picture)', { cls: 'gov', txt: 'HydroBASINS' });
    if (p.cuenca?.truncada && !p.cuencaHB) s.appendChild(el('p', 'hp-note', '⚠ La cuenca supera el DEM local: usa el botón para ver el área aportante completa hasta la divisoria.'));
    if (p.cuencaHB) {
      const m = p.cuencaHB.morfometria;
      s.appendChild(el('div', 'hp-kv', `
        <div><span>Área aportante total</span><b>${f1(m.A)} km²</b></div>
        <div><span>Sub-cuencas agregadas</span><b>${m.nSub}</b></div>
        <div><span>Fuente</span><b>${m.fuente}</b></div>`));
      s.appendChild(el('p', 'hp-note', `Cuánto "lejos" está la gota: toda el área que drena hacia el punto hasta la divisoria (${m.nSub} sub-cuencas de HydroBASINS). El área local del DEM sirve para la morfometría fina; ésta para el área aportante total.`));
    }
    const b = el('button', 'hp-run', p.cuencaHB ? '↻ Recalcular cuenca completa' : '🌎 Ver cuenca aportante completa');
    const st = el('span', 'hp-dl-status'); b.appendChild(st);
    b.addEventListener('click', async () => {
      if (!this.cuencaCompleta) return;
      st.textContent = ' …';
      try { const hb = await this.cuencaCompleta(p); st.textContent = hb ? '' : ' sin datos aquí'; this._renderCuenca(p); }
      catch (e) { st.textContent = ' ✗ ' + e.message; }
    });
    s.appendChild(b);
  }

  // ── Pestaña DEM (relieve del tramo activo) ───────────────────────────────────
  _renderDEM(t) {
    const host = this.hosts?.dem; if (!host) return;
    host.innerHTML = ''; const prev = this.elBody; this.elBody = host;
    // Relieve del tramo activo — solo si hay un tramo seleccionado.
    if (t) {
      const s = this._section('Relieve del sector (DEM)');
      const has = !!(t?.dem || t?.demGrid) && !t?.relieveOff;
      s.appendChild(el('div', 'hp-kv', `
        <div><span>Sector</span><b>${t?.name || '—'}</b></div>
        <div><span>Relieve</span><b>${has ? 'activo' : 'sin descargar'}</b></div>`));
      const b = el('button', 'hp-run', has ? '↻ Re-descargar relieve' : '⬇ Descargar relieve del sector');
      const st = el('span', 'hp-dl-status'); b.appendChild(st);
      b.addEventListener('click', async () => {
        if (!this.getDemGrid || !t) return;
        st.textContent = ' …';
        try { await this.getDemGrid(t, (m) => { st.textContent = ' ' + m; }); st.textContent = ' ✓'; this._renderDEM(t); }
        catch (e) { st.textContent = ' ✗ ' + e.message; }
      });
      s.appendChild(b);
      s.appendChild(el('p', 'hp-note', 'El relieve (DEM Terrarium) se usa para delinear cuencas y extraer la sección del cruce. También se activa con la 🏔️ del árbol o el botón Relieve 3D.'));
    } else {
      // Habilitación progresiva: la capacidad NO se oculta, se muestra DESACTIVADA (gris) hasta
      // que exista su prerequisito (un tramo). El color vivo dice "hazme"; el gris, "todavía no".
      const s = this._section('Relieve del sector (DEM)');
      s.appendChild(el('div', 'hp-kv', `
        <div><span>Sector</span><b>—</b></div>
        <div><span>Relieve</span><b>necesita un tramo</b></div>`));
      const b = el('button', 'hp-run', '⬇ Descargar relieve del sector');
      b.disabled = true; b.style.opacity = '.45'; b.style.cursor = 'not-allowed';
      b.title = 'Selecciona o dibuja un tramo/cauce primero (barra izquierda)';
      s.appendChild(b);
      s.appendChild(el('p', 'hp-note', 'Selecciona o dibuja un tramo/cauce (barra izquierda → «Tramo») para habilitar su relieve. La 🌊 red de drenaje de abajo funciona sin proyecto abierto.'));
    }
    // Red de drenaje / afluentes — SIEMPRE (opera sobre la vista del mapa, no necesita tramo ni proyecto).
    this._renderRedDrenaje();
    this.elBody = prev;
  }

  // Red de drenaje / afluentes (como QGIS) — sobre la VISTA ACTUAL del mapa. No requiere tramo
  // ni proyecto: es justo la herramienta para VER los cauces y pinchar el punto en el correcto.
  _renderRedDrenaje() {
    const sr = this._section('Red de drenaje (afluentes)', { cls: 'gov', txt: 'QGIS-like' });
    sr.appendChild(el('p', 'hp-note', 'Calcula los cauces del DEM en la vista actual del mapa (acumulación de flujo). Sirve para VER dónde están los afluentes y pinchar el punto justo sobre el cauce correcto.'));
    const fr = el('div', 'hp-form');
    fr.innerHTML = `<label class="hp-f"><span>Área mínima de cauce [km²]</span><input id="rd_umbral" type="number" step="0.01" value="0.05"></label>`;
    sr.appendChild(fr);
    const brd = el('button', 'hp-run', '🌊 Calcular red de drenaje (vista)');
    const rst = el('span', 'hp-dl-status'); brd.appendChild(rst);
    brd.addEventListener('click', async () => {
      if (!this.redDrenaje) return;
      rst.textContent = ' …';
      try { const m = await this.redDrenaje(parseFloat(this.elPanel.querySelector('#rd_umbral').value) || 0.05, (msg) => { rst.textContent = ' ' + msg; }); rst.textContent = ` ✓ ${m.nSeg} tramos (z${m.zoom}, celda ~${m.zoom >= 15 ? '4.5' : m.zoom >= 14 ? '9' : '18+'} m, cauce máx ${m.maxAreaKm2} km²)`; }
      catch (e) { rst.textContent = ' ✗ ' + e.message; }
    });
    sr.appendChild(brd);
    // Cauce SOLO del punto pinchado (su árbol de afluentes), no toda la red.
    const bpt = el('button', 'hp-run', '📍 Cauce en un punto (clic en el mapa)');
    const pst = el('span', 'hp-dl-status'); bpt.appendChild(pst);
    const trazar = async (lon, lat) => {
      if (!this.cauceEnPunto) return;
      pst.textContent = ' …';
      try {
        const um = parseFloat(this.elPanel.querySelector('#rd_umbral').value) || 0.05;
        const m = await this.cauceEnPunto(lon, lat, um, (msg) => { pst.textContent = ' ' + msg; });
        pst.textContent = ` ✓ cuenca ${m.areaKm2} km² · ${m.nSeg} tramos (afluentes del punto)`;
      } catch (e) { pst.textContent = ' ✗ ' + e.message; }
    };
    bpt.addEventListener('click', () => {
      this.map.pickOnce((lon, lat) => trazar(lon, lat), 'Clic sobre el cauce para trazar sus afluentes');
    });
    sr.appendChild(bpt);
    // Auto-actualizar al mover/zoom el mapa (ruteo en un worker → no congela).
    const auto = el('label', 'hp-f');
    auto.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0';
    auto.innerHTML = `<input id="rd_auto" type="checkbox"><span>Actualizar al mover / hacer zoom (auto)</span>`;
    auto.querySelector('#rd_auto').addEventListener('change', (e) => this.setAutoCauce?.(e.target.checked));
    sr.appendChild(auto);
    // Mover el umbral re-traza EN VIVO el mismo punto (barato: no re-rutea).
    fr.querySelector('#rd_umbral')?.addEventListener('change', () => {
      const c = this._ultimoCauce; if (c) trazar(c.lon, c.lat);
    });
    const bclr = el('button', 'hp-mini-btn', '✖ Limpiar red');
    bclr.addEventListener('click', () => this.limpiarRed?.());
    sr.appendChild(bclr);
  }

  // ── Pestaña SOCAVACIÓN (a partir del último eje hidráulico) ──────────────────
  _renderSocav() {
    const host = this.hosts?.socav; if (!host) return;
    host.innerHTML = ''; const prev = this.elBody; this.elBody = host;
    const s = this._section('Socavación', { cls: 'gov', txt: 'LL + HEC-18' });
    if (!this._ejeRes || !this._ejePerfil) {
      s.appendChild(el('p', 'hp-note', 'Primero calcula el eje hidráulico (pestaña 🌊 Hidráulica). La socavación usa esa sección y velocidad.'));
      this.elBody = prev; return;
    }
    const f = (l, id, v, u = '') => `<label class="hp-f"><span>${l}${u ? ` [${u}]` : ''}</span><input id="${id}" value="${v}"></label>`;
    const form = el('div', 'hp-form');
    form.innerHTML = f('D50 lecho', 'sv_d50', '20', 'mm') + f('Periodo retorno T', 'sv_t', '100', 'años')
      + f('Ancho pila a', 'sv_pila', '', 'm') + f('Contracción μ', 'sv_mu', '1');
    s.appendChild(form);
    const btn = el('button', 'hp-run', '🕳️ Calcular socavación');
    s.appendChild(btn);
    this._socHost = el('div'); s.appendChild(this._socHost);
    btn.addEventListener('click', () => this._runSocav());
    s.appendChild(el('p', 'hp-note', 'Socavación general Lischtvan-Lebediev + velocidad competente de Neill + local en pila (HEC-18/CSU) si ingresas el ancho de pila.'));
    this.elBody = prev;
  }

  _runSocav() {
    const num = (id) => parseFloat(this.elPanel.querySelector('#' + id)?.value);
    const D50mm = num('sv_d50') || 20, T = num('sv_t') || 100, aPila = num('sv_pila'), mu = num('sv_mu') || 1;
    const sec = this._ejeRes, pts = this._ejePerfil.puntos;
    const so = evaluarSocavacion(sec, pts, { Q: sec.Q, D50mm, T, mu, pila: aPila > 0 ? { a: aPila, forma: 'circular' } : undefined });
    this._socHost.innerHTML = '';
    this._socHost.appendChild(el('div', 'hp-kv', `
      <div><span>Socav. general · Lischtvan-Lebediev</span><b>${f2(so.general.socavMax)} m</b></div>
      <div><span>Socav. general · Neill (vel. competente)</span><b>${f2(so.generalNeill?.socav)} m</b></div>
      <div><span>General adoptada (máx)</span><b>${f2(so.generalAdoptada)} m</b></div>
      <div><span>Cota lecho socavado (mín, LL)</span><b>${f2(so.general.zLechoMin)} m</b></div>
      <div><span>Socavación total</span><b>${f2(so.socavTotal)} m</b></div>
      <div><span>Neill</span><b>${so.neill.lechoVivo ? 'lecho vivo' : 'agua clara'} (Vc ${f2(so.neill.Vc)} m/s)</b></div>`));
    if (so.metodosPila) {
      const m = so.metodosPila;
      const rows = [['HEC-18 / CSU', m.csu], ['Froehlich', m.froehlich], ['Laursen-Toch', m.laursenToch], ['Breusers', m.breusers], ['Larras', m.larras]]
        .map(([nm, v]) => `<tr${v === m.max ? ' style="color:var(--red);font-weight:700"' : ''}><td>${nm}</td><td>${f2(v)} m</td></tr>`).join('');
      this._socHost.insertAdjacentHTML('beforeend',
        `<div class="hp-mini">Socavación local en pila · métodos MC</div>
         <table class="hp-tbl"><tbody>${rows}<tr><td><b>Adoptada (envolvente)</b></td><td><b>${f2(m.max)} m</b></td></tr><tr><td>Promedio</td><td>${f2(m.prom)} m</td></tr></tbody></table>`);
    }
  }

  _renderPuntos(p) {
    if (!this._puntos || this._puntos.length < 1) return;
    const s = this._section(`Puntos de análisis (${this._puntos.length})`);
    const chips = el('div', 'hp-chips');
    for (const pt of this._puntos) {
      const c = el('span', 'hp-chip' + (pt.id === p.id ? ' sel' : ''),
        `${pt.nombre}${pt.cuenca ? ` · ${pt.cuenca.morfometria.A} km²` : ''} <b data-del="${pt.id}" title="Borrar">✕</b>`);
      c.addEventListener('click', (e) => {
        if (e.target.dataset.del) {
          const did = +e.target.dataset.del;
          this.borrarPunto?.(did);                         // boot: quita del mapa + setPuntos
          const rest = (this._puntos || []).filter((x) => x.id !== did);
          if (this._punto?.id === did) { if (rest.length) this.irAPunto?.(rest[rest.length - 1].id); else { this._clearHosts(['cuenca', 'hidro']); this.dock.setSub('—'); this._punto = null; } }
          else if (this._punto) this.analizarPunto(this._punto);
        } else this.irAPunto?.(pt.id);
      });
      chips.appendChild(c);
    }
    s.appendChild(chips);
    s.appendChild(el('p', 'hp-note', 'Activa 📍 Puntos y haz clic en el mapa para agregar más. Clic en un chip para ir; ✕ para borrar.'));
  }

  // ── Análisis en un PUNTO de la quebrada (picking en el visor) ───────────────
  async analizarPunto(p) {
    this._punto = p;
    this._sel = this._sel || {};
    if (!this.dock.isOpen()) this.dock.show('hidro');
    this.dock.setSub(`Análisis · ${p.nombre}`);
    this._clearHosts(['cuenca', 'hidro', 'hidraulica', 'socav']);

    // CUENCA (pestaña propia, persistente).
    this.elBody = this.hosts.cuenca; this._renderCuenca(p);
    // HIDRÁULICA + SOCAVACIÓN (del tramo activo).
    if (this.tramo) { this.elBody = this.hosts.hidraulica; this._seccionEje(this.tramo); this.elBody = this.hosts.socav; this._renderSocav(); }
    // DEM.
    if (this.tramo) this._renderDEM(this.tramo);

    // HIDROLOGÍA.
    this.elBody = this.hosts.hidro;
    this._renderPuntos(p);
    const sc = this._section('Punto de análisis', { cls: 'gov', txt: 'picking' });
    sc.appendChild(el('div', 'hp-kv', `
      <div><span>Coordenadas</span><b>${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</b></div>
      <div><span>Cuenca</span><b>${p.cuenca?.morfometria ? p.cuenca.morfometria.A + ' km² (pestaña Cuenca)' : 'sin delinear → pestaña ⬡ Cuenca'}</b></div>`));
    const dl = el('div', 'hp-dl');
    dl.innerHTML = `<button class="hp-mini-btn" data-var="pr">⬇ Lluvia DGA</button>
      <button class="hp-mini-btn" data-var="qflx">⬇ Caudal DGA</button>
      <span class="hp-dl-status"></span>`;
    sc.appendChild(dl);
    dl.querySelectorAll('.hp-mini-btn').forEach((b) =>
      b.addEventListener('click', () => this._descargarDatos(p, b.dataset.var, dl.querySelector('.hp-dl-status'))));

    // Estaciones cercanas (clic para fijar control/estación pluvial)
    await this._renderEstacionesPunto(p);

    // Pipeline completo (caudal de diseño adoptado, fluviometría gobierna)
    this._seccionPipeline(p);

    // Selector de método + cálculo
    const sm = this._section('Método de cálculo');
    sm.appendChild(el('p', 'hp-note', 'Para cauces, la fluviometría del cauce es preferible a la pluviometría. Las áreas/morfometría se autocompletarán al delinear la cuenca desde el DEM; por ahora se ingresan.'));
    const sel = el('select', 'hp-select');
    sel.innerHTML = `
      <optgroup label="Fluviométricos (preferentes para cauces)">
        <option value="fluvio">Fluviometría directa (estación en el cauce)</option>
        <option value="transp">Transposición (1 cuenca de control)</option>
        <option value="regional">Cuenca similar (regional, varias estaciones)</option>
      </optgroup>
      <optgroup label="Lluvia-escorrentía">
        <option value="hu">Hidrograma Unitario sintético (Linsley)</option>
        <option value="racional">Racional Modificado</option>
        <option value="vk">Verni-King Modificado</option>
        <option value="dga">DGA-AC (regional pluvial)</option>
      </optgroup>`;
    sm.appendChild(sel);
    const campos = el('div', 'hp-form'); sm.appendChild(campos);
    const btn = el('button', 'hp-run', 'Calcular en el punto'); sm.appendChild(btn);
    this._resPunto = el('div'); sm.appendChild(this._resPunto);

    const pintarCampos = async () => {
      campos.innerHTML = this._camposMetodo(sel.value);
      if (sel.value === 'regional') {
        const fl = await estacionesCercanas([p.lon, p.lat], { tipo: 'fluviometrica', n: 3, minAnios: 10 });
        const host = campos.querySelector('#pf_don');
        if (host) host.innerHTML = fl.map((e, i) =>
          `<label class="hp-f"><span>Área ${e.nombre.split(' ').slice(0, 3).join(' ')} [km²]</span><input id="pf_don_a${i}" value=""></label>`).join('');
      }
    };
    sel.addEventListener('change', pintarCampos);
    pintarCampos();
    btn.addEventListener('click', () => this._calcPunto(sel.value).catch((e) => {
      this._resPunto.innerHTML = `<div class="hp-err">${e.message}</div>`; console.error(e);
    }));
  }

  async _renderEstacionesPunto(p) {
    this._sel = this._sel || {};
    const pluvio = await estacionesCercanas([p.lon, p.lat], { tipo: 'pluviometrica', n: 4 });
    const fluvio = await estacionesCercanas([p.lon, p.lat], { tipo: 'fluviometrica', n: 4 });
    this.map?.showStations([...pluvio, ...fluvio]);
    const s = this._section('Estaciones DGA cercanas');
    const tag = el('div', 'hp-kv', `
      <div><span>Control fluviométrico</span><b id="hp-ctrl">${this._sel.ctrl?.nombre || '— (clic en una fluviométrica)'}</b></div>
      <div><span>Estación pluvial</span><b id="hp-plu">${this._sel.pluvio?.nombre || '— (clic en una pluviométrica)'}</b></div>`);
    const mk = (arr, tipo) => {
      if (!arr.length) return;
      s.appendChild(el('div', 'hp-mini', tipo === 'fluvio' ? 'Fluviométricas' : 'Pluviométricas'));
      const t = this._table(['Dist', 'Estación', 'n', 'Periodo'],
        arr.map((e) => [`${e.dist.toFixed(0)}km`, e.nombre, String(e.n_anios), e.periodo]));
      t.querySelector('thead tr')?.insertAdjacentHTML('beforeend', '<th></th>');
      [...t.querySelectorAll('tbody tr')].forEach((tr, i) => {
        tr.classList.add('hp-row-click');
        // clic = SELECCIONAR (no vuela); no resalta en el mapa panéandolo
        tr.addEventListener('click', () => {
          if (tipo === 'fluvio') this._sel.ctrl = arr[i]; else this._sel.pluvio = arr[i];
          s.querySelector('#hp-ctrl').textContent = this._sel.ctrl?.nombre || '—';
          s.querySelector('#hp-plu').textContent = this._sel.pluvio?.nombre || '—';
          [...s.querySelectorAll(`tbody tr.sel-${tipo}`)].forEach((x) => x.classList.remove('sel', `sel-${tipo}`));
          tr.classList.add('sel', `sel-${tipo}`);
          this.map?.highlightStation(arr[i], { pan: false });
        });
        // flechita = IR a la estación (vuela)
        const go = document.createElement('td');
        go.className = 'hp-go'; go.textContent = '➤'; go.title = 'Ir a la estación';
        go.addEventListener('click', (ev) => { ev.stopPropagation(); this.map?.highlightStation(arr[i], { pan: true }); });
        tr.appendChild(go);
      });
      s.appendChild(t);
    };
    mk(fluvio, 'fluvio'); mk(pluvio, 'pluvio');
    s.appendChild(tag);

    // Descarga masiva de series cercanas con rango de años configurable.
    const dl = el('div', 'hp-dl');
    dl.innerHTML = `<label class="hp-f" style="flex:0 0 auto"><span>Últimos</span><input id="hp-anios" value="30" style="width:48px"></label>
      <button class="hp-mini-btn" id="hp-dlser">⬇ Descargar series cercanas (CSV)</button><span class="hp-dl-status" id="hp-serst"></span>`;
    s.appendChild(dl);
    dl.querySelector('#hp-dlser').addEventListener('click', () =>
      this._descargarSeriesCercanas([p.lon, p.lat], parseInt(dl.querySelector('#hp-anios').value) || 30, dl.querySelector('#hp-serst')));
  }

  _seccionPipeline(p) {
    const s = this._section('Caudal de diseño · pipeline completo', { cls: 'gov', txt: 'gobierna fluviometría' });
    if (!p.cuenca?.morfometria) {
      s.appendChild(el('p', 'hp-note', 'Primero calcula la cuenca aportante (botón ⛰️ arriba): el pipeline usa su área y morfometría.'));
      return;
    }
    const f = (l, id, v = '', u = '') => `<label class="hp-f"><span>${l}${u ? ` [${u}]` : ''}</span><input id="${id}" value="${v}"></label>`;
    const form = el('div', 'hp-form');
    form.innerHTML =
      f('Área cuenca control Apc', 'pl_apc', '', 'km²') +
      f('Región (Racional/VK)', 'pl_reg', 'I') +
      f('Curva número CN', 'pl_cn', '75');
    s.appendChild(form);
    const dlc = el('div', 'hp-dl');
    dlc.innerHTML = `<button class="hp-mini-btn" id="pl_auto">⛰ Auto Apc (delinear control)</button><span class="hp-dl-status" id="pl_st"></span>`;
    s.appendChild(dlc);
    dlc.querySelector('#pl_auto').addEventListener('click', () => this._autoApc(p, dlc.querySelector('#pl_st')));
    const btn = el('button', 'hp-run', '▶ Calcular pipeline completo');
    btn.addEventListener('click', () => this._runPipeline(p));
    s.appendChild(btn);
    s.appendChild(el('p', 'hp-note', 'Usa la estación pluvial y la de control elegidas arriba (o las más cercanas). La transposición fluviométrica gobierna; los métodos pluviales quedan referenciales.'));
  }

  async _estControl(p) { return this._sel.ctrl || (await estacionesCercanas([p.lon, p.lat], { tipo: 'fluviometrica', n: 1, minAnios: 10 }))[0]; }
  async _estPluvio(p) { return this._sel.pluvio || (await estacionesCercanas([p.lon, p.lat], { tipo: 'pluviometrica', n: 1, minAnios: 10 }))[0]; }

  async _autoApc(p, statusEl) {
    const ctrl = await this._estControl(p);
    if (!ctrl) { statusEl.textContent = ' sin estación de control'; return; }
    statusEl.textContent = ` delineando cuenca de ${ctrl.nombre}…`;
    try {
      const A = await this.delinearArea(ctrl.lon, ctrl.lat, (m) => { statusEl.textContent = ' ' + m; });
      const inp = this.elPanel.querySelector('#pl_apc'); if (inp && A) inp.value = A;
      statusEl.textContent = A ? ` ✓ Apc ≈ ${A} km² (${ctrl.nombre})` : ' no se pudo';
    } catch (e) { statusEl.textContent = ' ✗ ' + e.message; }
  }

  async _runPipeline(p) {
    if (!p.cuenca?.morfometria) return;
    const st = this.elPanel.querySelector('#pl_st');
    const ctrl = await this._estControl(p), plu = await this._estPluvio(p);
    if (!plu) { if (st) st.textContent = ' sin estación pluvial cercana'; return; }
    let Apc = parseFloat(this.elPanel.querySelector('#pl_apc')?.value);
    try {
      if (ctrl && !(Apc > 0)) { if (st) st.textContent = ` delineando control ${ctrl.nombre}…`; Apc = await this.delinearArea(ctrl.lon, ctrl.lat, (m) => { if (st) st.textContent = ' ' + m; }); }
      if (st) st.textContent = ' calculando pipeline…';
      const ppSerie = await cargarSerie(plu);
      const fluvioSerie = ctrl ? await cargarSerie(ctrl) : null;
      const r = await correrPipelinePunto({
        nombre: p.nombre, lat: p.lat, morfometria: p.cuenca.morfometria,
        region: this.elPanel.querySelector('#pl_reg')?.value || 'I',
        CN: parseFloat(this.elPanel.querySelector('#pl_cn')?.value) || 75,
        pp: { estacion: plu.nombre, serie: ppSerie },
        fluvio: ctrl && Apc > 0 ? { estacion: ctrl.nombre, serie: fluvioSerie, Apc } : null,
      });
      this._render(r);   // vista completa (limpia el body)
      const back = el('button', 'hp-run', `← Volver al punto ${p.nombre}`);
      back.style.margin = '0 0 10px'; back.addEventListener('click', () => this.analizarPunto(p));
      this.elBody.prepend(back);
    } catch (e) { if (st) st.textContent = ' ✗ ' + e.message; console.error(e); }
  }

  // Descarga las series de las estaciones cercanas, recortadas a los últimos N años (CSV).
  async _descargarSeriesCercanas(centro, anios, statusEl) {
    if (statusEl) statusEl.textContent = ' juntando series…';
    const lista = [
      ...await estacionesCercanas(centro, { tipo: 'pluviometrica', n: 12 }),
      ...await estacionesCercanas(centro, { tipo: 'fluviometrica', n: 12 }),
    ];
    const yMin = new Date().getFullYear() - (anios || 30);
    const rows = [['estacion', 'bna', 'tipo', 'variable', 'unidad', 'lat', 'lon', 'anio', 'valor']];
    for (const e of lista) {
      try {
        const s = await cargarSerie(e);
        for (const [yr, v] of Object.entries(s.serie)) if (+yr >= yMin) rows.push([s.nombre, s.bna, s.tipo, s.variable, s.unidad, s.lat, s.lon, yr, v]);
      } catch {}
    }
    const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    descargar(`series_dga_${anios}a.csv`, csv, 'text/csv;charset=utf-8');
    if (statusEl) statusEl.textContent = ` ✓ ${rows.length - 1} registros`;
  }

  _seccionEje(t) {
    const s = this._section('Eje hidráulico · sección en el cruce', { cls: 'gov', txt: 'Manning 1D' });
    const f = (l, id, v, u = '') => `<label class="hp-f"><span>${l}${u ? ` [${u}]` : ''}</span><input id="${id}" value="${v}"></label>`;
    const form = el('div', 'hp-form');
    form.innerHTML = f('Caudal Q', 'eh_q', '', 'm³/s') + f('Rugosidad Manning n', 'eh_n', '0.035')
      + f('Pendiente cauce J', 'eh_j', '0.02', 'm/m');
    s.appendChild(form);
    const st = el('span', 'hp-dl-status');
    const btn = el('button', 'hp-run', '📐 Calcular eje hidráulico'); btn.appendChild(st);
    s.appendChild(btn);
    this._ejeHost = el('div'); s.appendChild(this._ejeHost);
    btn.addEventListener('click', () => this._runEje(t, st));
    s.appendChild(el('p', 'hp-note', 'Extrae la sección a lo largo del eje del tramo (el cruce del camino ≈ sección del puente) desde el DEM y resuelve la profundidad normal (flujo uniforme) para Q. El remanso completo (por pasos/HEC-RAS) vendrá luego.'));
  }

  async _runEje(t, statusEl) {
    const Q = parseFloat(this.elPanel.querySelector('#eh_q')?.value);
    const n = parseFloat(this.elPanel.querySelector('#eh_n')?.value) || 0.035;
    const J = parseFloat(this.elPanel.querySelector('#eh_j')?.value) || 0.02;
    if (!(Q > 0)) { if (statusEl) statusEl.textContent = ' ingresa Q'; return; }
    if (statusEl) statusEl.textContent = ' …';
    try {
      const grid = await this.getDemGrid(t, (m) => { if (statusEl) statusEl.textContent = ' ' + m; });
      const perfil = perfilDesdeLinea(t.feature.geometry.coordinates, grid, 120);
      const res = nivelNormal(perfil.puntos, { Q, n, J });
      this._ejeRes = res; this._ejePerfil = perfil;    // insumo de la pestaña Socavación
      this._renderSocav();
      if (statusEl) statusEl.textContent = '';
      this._ejeHost.innerHTML = '';
      this._ejeHost.appendChild(this._svgSeccion(perfil, res));
      this._ejeHost.appendChild(el('div', 'hp-kv', `
        <div><span>Nivel de agua (WSE)</span><b>${res.WSE.toFixed(2)} m</b></div>
        <div><span>Profundidad máx</span><b>${res.profMax.toFixed(2)} m</b></div>
        <div><span>Ancho superficial</span><b>${res.B.toFixed(1)} m</b></div>
        <div><span>Área · Velocidad</span><b>${res.A.toFixed(1)} m² · ${res.V.toFixed(2)} m/s</b></div>
        <div><span>Froude · régimen</span><b>${res.Fr.toFixed(2)} · ${res.regimen}</b></div>`));
    } catch (e) { if (statusEl) statusEl.textContent = ' ✗ ' + e.message; console.error(e); }
  }

  // Dibujo SVG de la sección (terreno + lámina de agua).
  _svgSeccion(perfil, res) {
    const W = 380, H = 150, pad = 6;
    const pts = perfil.puntos;
    const sMax = perfil.largo || 1;
    const zMin = perfil.zMin, zMax = Math.max(perfil.zMax, res.WSE);
    const rz = (zMax - zMin) || 1;
    const X = (s) => pad + (s / sMax) * (W - 2 * pad);
    const Y = (z) => pad + (zMax - z) / rz * (H - 2 * pad);
    const ground = pts.map((p) => `${X(p.s).toFixed(1)},${Y(p.z).toFixed(1)}`).join(' ');
    // agua: adelante por min(z,WSE) (superficie), atrás por el terreno
    const top = pts.map((p) => `${X(p.s).toFixed(1)},${Y(Math.min(p.z, res.WSE)).toFixed(1)}`);
    const bot = [...pts].reverse().map((p) => `${X(p.s).toFixed(1)},${Y(p.z).toFixed(1)}`);
    const water = [...top, ...bot].join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'hp-sec-svg');
    svg.innerHTML = `
      <polygon points="${water}" fill="var(--accent)" fill-opacity="0.28"/>
      <line x1="${X(0)}" y1="${Y(res.WSE)}" x2="${X(sMax)}" y2="${Y(res.WSE)}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="4 3"/>
      <polyline points="${ground}" fill="none" stroke="var(--text2)" stroke-width="1.5"/>`;
    return svg;
  }

  _camposMetodo(m) {
    const f = (l, id, v = '', u = '') => `<label class="hp-f"><span>${l}${u ? ` [${u}]` : ''}</span><input id="${id}" value="${v}"></label>`;
    const mo = this._punto?.cuenca?.morfometria;   // autocompletado desde la delineación
    const A = mo ? mo.A : '', L = mo ? mo.L : '', Lg = mo ? mo.Lg : '', S = mo ? mo.S : '';
    if (m === 'fluvio') return f('Factor a instantáneo (zona homogénea)', 'pf_fi', '1.0');
    if (m === 'transp') return f('Área control Apc', 'pf_apc', '', 'km²') + f('Área objetivo Apx', 'pf_apx', A, 'km²');
    if (m === 'regional') return f('Área objetivo Apx', 'pf_apx', A, 'km²') +
      `<p class="hp-note">Usa las 3 estaciones fluviométricas más cercanas; ingresa el área de cada cuenca de control.</p>` +
      `<div id="pf_don"></div>`;
    if (m === 'hu') return f('Área A', 'pf_a', A, 'km²') + f('Long. cauce L', 'pf_l', L, 'km') +
      f('Long. centroide Lg', 'pf_lg', Lg, 'km') + f('Pendiente S', 'pf_s', S, 'm/m') +
      f('Curva número CN', 'pf_cn', '75') + f('Zona (1=III-VI)', 'pf_z', '1');
    if (m === 'racional') return f('Área A', 'pf_a', A, 'km²') + f('Región', 'pf_reg', 'I') +
      f('Tiempo concentración tc', 'pf_tc', '', 'h') + f('Estación coef. IDF', 'pf_idf', 'Putre');
    if (m === 'vk') return f('Área A', 'pf_a', A, 'km²') + f('Región', 'pf_reg', 'I');
    if (m === 'dga') return f('Área A', 'pf_a', A, 'km²');
    return '';
  }

  async _calcPunto(m) {
    const TSL = TS;
    const $ = (id) => this.elPanel.querySelector('#' + id);
    const num = (id) => parseFloat($(id)?.value);
    let res = null, titulo = '', unidad = 'm³/s', nota = '';

    if (m === 'fluvio') {
      if (!this._sel.ctrl) throw new Error('Elige una estación fluviométrica (clic en la tabla).');
      const s = await cargarSerie(this._sel.ctrl);
      const an = analizar(Object.values(s.serie), { T: TSL });
      const fi = num('pf_fi') || 1;
      const q = an.resultados[an.mejor].quantiles;
      res = Object.fromEntries(TSL.map((T) => [T, q[T] * fi]));
      titulo = `Fluviometría directa · ${s.nombre} (${an.mejor})`;
      nota = `Q medio diario × factor instantáneo ${fi}. Estación en el cauce: estimación directa.`;
    } else if (m === 'transp') {
      if (!this._sel.ctrl) throw new Error('Elige la estación de control (clic en la tabla).');
      const Apc = num('pf_apc'), Apx = num('pf_apx');
      if (!(Apc > 0 && Apx > 0)) throw new Error('Ingresa áreas Apc y Apx.');
      const s = await cargarSerie(this._sel.ctrl);
      const tr = transponer({ nombre: s.nombre, area_km2: Apc, serie: s.serie }, { Apx }, { T: TSL });
      res = tr.Qx; titulo = `Transposición desde ${s.nombre} (${tr.distribucion})`;
      nota = `Factor de área (Apx/Apc)^0.88 = ${tr.factor[10].toFixed(3)}.`;
    } else if (m === 'regional') {
      const Apx = num('pf_apx');
      if (!(Apx > 0)) throw new Error('Ingresa el área objetivo Apx.');
      const fl = await estacionesCercanas([this._punto.lon, this._punto.lat], { tipo: 'fluviometrica', n: 3, minAnios: 10 });
      const don = [];
      for (let i = 0; i < fl.length; i++) {
        const a = num('pf_don_a' + i);
        if (!(a > 0)) throw new Error(`Ingresa el área de control de ${fl[i].nombre}.`);
        const s = await cargarSerie(fl[i]);
        don.push({ nombre: s.nombre, area_km2: a, serie: s.serie, lon: fl[i].lon, lat: fl[i].lat });
      }
      const rr = transponerRegional(don, { Apx, lon: this._punto.lon, lat: this._punto.lat }, { T: TSL, pesos: 'distancia' });
      res = rr.Qx; titulo = 'Cuenca similar (regional, ponderado por distancia)';
      nota = 'Pesos: ' + rr.donantes.map((d) => `${d.nombre.split(' ').slice(0, 2).join(' ')} ${(d.peso * 100).toFixed(0)}%`).join(' · ');
    } else if (m === 'hu') {
      const A = num('pf_a'), L = num('pf_l'), Lg = num('pf_lg'), S = num('pf_s'), CN = num('pf_cn') || 75, z = num('pf_z') || 1;
      if (!(A > 0 && L > 0 && Lg > 0 && S > 0)) throw new Error('Completa A, L, Lg, S.');
      if (!this._sel.pluvio) throw new Error('Elige una estación pluvial para la PP de diseño.');
      const sp = await cargarSerie(this._sel.pluvio);
      const an = analizar(Object.values(sp.serie), { T: TSL });
      const pp = ppDiseno(an.resultados[an.mejor].quantiles, 1.10);
      const hu = caudalesHU({ L, Lg, S, A }, pp, CN, z);
      res = Object.fromEntries(TSL.map((T) => [T, hu.valores[T].Q]));
      titulo = `Hidrograma Unitario sintético (Linsley) · PP de ${sp.nombre}`;
      nota = `tp=${hu.params.tp.toFixed(1)}h, qp=${hu.params.qpA.toFixed(2)} m³/s·mm, CN=${CN}. ${hu.aplica ? '' : '⚠ fuera de rango 10–4500 km².'}`;
    } else if (m === 'racional' || m === 'vk' || m === 'dga') {
      const A = num('pf_a');
      if (!(A > 0)) throw new Error('Ingresa el área A.');
      if (!this._sel.pluvio) throw new Error('Elige una estación pluvial.');
      const coef = await fetchJSON('data/coef_hidro.json?v=4', { contexto: 'Coeficientes hidrológicos' });
      const sp = await cargarSerie(this._sel.pluvio);
      const an = analizar(Object.values(sp.serie), { T: TSL });
      const pp = ppDiseno(an.resultados[an.mejor].quantiles, 1.10);
      let mm;
      if (m === 'racional') {
        const reg = $('pf_reg').value.trim() || 'I';
        const tc = num('pf_tc'); if (!(tc > 0)) throw new Error('Ingresa el tiempo de concentración tc [h].');
        const Itc = {}; for (const T of TSL) Itc[T] = grunsky(pp[T], tc);
        mm = racional({ A, region: reg, Itc }, coef, TSL);
        titulo = `Racional Modificado (referencial) · PP de ${sp.nombre}`;
      } else if (m === 'vk') {
        const reg = $('pf_reg').value.trim() || 'I';
        mm = verniKing({ A, region: reg, pp24: pp }, coef, TSL);
        titulo = `Verni-King Modificado (referencial) · PP de ${sp.nombre}`;
      } else {
        mm = dgaAC({ A, pp24: pp }, coef, TSL);
        titulo = `DGA-AC regional (referencial) · PP de ${sp.nombre}`;
      }
      res = Object.fromEntries(TSL.map((T) => [T, mm.valores[T].Q]));
      nota = `⚠ Método pluvial (lluvia-escorrentía): ${mm.aplica ? 'aplicable' : 'fuera de rango'} (${mm.rango}). En zona árida es referencial: preferir la fluviometría del cauce.`;
    }

    this._resPunto.innerHTML = '';
    const wrap = el('div', 'hp-sec');
    wrap.appendChild(el('div', 'hp-mini', titulo));
    wrap.appendChild(this._table(['T [años]', ...TSL.map(String)],
      [[`Q [${unidad}]`, ...TSL.map((T) => f1(res[T]))]]));
    wrap.appendChild(el('p', 'hp-note', nota));
    this._resPunto.appendChild(wrap);
  }

  async _descargarDatos(p, varname, statusEl) {
    statusEl.textContent = ' descargando…';
    try {
      await descargarSerieDGA({ lon: p.lon, lat: p.lat }, varname === 'qflx' ? 'fluviometrica' : 'pluviometrica');
      statusEl.textContent = ' ✓ listo';
      await this._renderEstacionesPunto(p);   // refresca con lo nuevo
    } catch (e) {
      statusEl.textContent = ' ✗ ' + e.message;
    }
  }

  _section(title, badge) {
    const s = el('section', 'hp-sec');
    const h = el('h3', 'hp-sec-h', `<span>${title}</span>${badge ? `<span class="hp-badge ${badge.cls}">${badge.txt}</span>` : ''}`);
    s.appendChild(h);
    this.elBody.appendChild(s);
    return s;
  }

  _table(headers, rows, highlightCol) {
    const t = el('table', 'hp-tbl');
    const thead = el('thead');
    thead.appendChild(el('tr', null, headers.map((h, i) => `<th${i === highlightCol ? ' class="hl"' : ''}>${h}</th>`).join('')));
    t.appendChild(thead);
    const tb = el('tbody');
    for (const row of rows) {
      tb.appendChild(el('tr', null, row.map((c, i) => `<td${i === highlightCol ? ' class="hl"' : ''}>${c}</td>`).join('')));
    }
    t.appendChild(tb);
    return t;
  }

  _render(r) {
    const host = this._pipeHost || this.hosts.hidro;
    host.innerHTML = ''; this.elBody = host;
    this.dock.setSub(r.caso);

    // 1) Línea de nieve y área aportante
    const sN = this._section('1 · Línea de nieve y área aportante');
    sN.appendChild(this._table(
      ['Método', 'Cota [msnm]'],
      r.nieve.candidatas.map((c) => [c.metodo, f1(c.H)]),
    ));
    sN.appendChild(el('div', 'hp-kv', `
      <div><span>Línea adoptada (la más alta)</span><b>${f1(r.nieve.Hnieve)} msnm</b></div>
      <div><span>Área total</span><b>${f2(r.nieve.areaTotal)} km²</b></div>
      <div><span>Área pluvial aportante</span><b>${f2(r.nieve.areaPluvial)} km²</b></div>
      <div><span>Área nival</span><b>${f2(r.nieve.areaNival)} km²</b></div>`));
    sN.appendChild(el('p', 'hp-note', r.nieve.nota));

    // 2) Precipitación: frecuencia + PP diseño
    const sP = this._section('2 · Precipitación de diseño');
    sP.appendChild(el('div', 'hp-kv', `
      <div><span>Estación</span><b>${r.precipitacion.estacion}</b></div>
      <div><span>Distribución</span><b>${r.precipitacion.distribucion}</b></div>
      ${r.precipitacion.frecuencia ? `<div><span>Mejor ajuste (serie cruda)</span><b>${r.precipitacion.frecuencia.mejor}</b></div>` : ''}`));
    sP.appendChild(this._table(
      ['T [años]', ...TS.map(String)],
      [['PP₂₄ diseño [mm]', ...TS.map((T) => f1(r.precipitacion.ppDiseno[T]))]],
    ));

    // 3) IDF (referencial)
    const sI = this._section('3 · Curvas IDF', { cls: 'ref', txt: 'referencial' });
    const idfDur = [10, 30, 60, 120, 360, 1440];
    const idfRows = idfDur.map((d) => {
      const fila = r.idf.tabla.find((x) => x.durMin === d) || {};
      return [`${d} min`, ...TS.map((T) => f1(fila['T' + T]))];
    });
    sI.appendChild(this._table(['Duración', ...TS.map((T) => 'T' + T)], idfRows));
    sI.appendChild(el('p', 'hp-note', `Coef. de duración estación ${r.idf.estacionCoef}. En zona árida las IDF son referenciales.`));

    // 4) Tc
    const sT = this._section('4 · Tiempo de concentración');
    sT.appendChild(this._table(
      ['Método', 'tc [h]', 'Aplica'],
      r.tc.metodos.map((mm) => [mm.metodo, isFinite(mm.tc) ? f2(mm.tc) : '—', mm.aplica ? '✓' : '—']),
    ));
    sT.appendChild(el('div', 'hp-kv', `<div><span>tc adoptado (máx)</span><b>${f2(r.tc.adoptado)} h</b></div>`));

    // 5) Caudales — comparativa y adoptados
    const ad = r.caudales.adopcion;
    const sQ = this._section('5 · Caudales de crecida', { cls: 'gov', txt: 'gobierna fluviometría' });
    const vk = r.caudales.pluvial.metodos.find((m) => m.metodo.startsWith('Verni'));
    const dga = r.caudales.pluvial.metodos.find((m) => m.metodo === 'DGA-AC');
    const tr = r.caudales.transposicion;
    const headers = ['T [años]', 'Verni-King*', 'DGA-AC*', 'Transposición', 'ADOPTADO'];
    const rows = TS.map((T) => [
      String(T),
      vk ? f2(vk.valores[T].Q) : '—',
      dga ? f2(dga.valores[T].Q) : '—',
      tr ? f2(tr.Qx[T]) : '—',
      `<b>${f2(ad.adoptados[T])}</b>`,
    ]);
    sQ.appendChild(this._table(headers, rows, 4));
    if (tr) sQ.appendChild(el('div', 'hp-kv', `
      <div><span>Estación de control</span><b>${tr.estacion}</b></div>
      <div><span>Áreas (sin control / control)</span><b>${f2(tr.Apx)} / ${f2(tr.Apc)} km²</b></div>
      <div><span>Factor transposición (T=10)</span><b>${f2(tr.factor[10])}</b></div>`));
    sQ.appendChild(el('p', 'hp-note', `* Métodos pluviales (basados en IDF): referenciales. ${ad.nota}`));
  }
}
