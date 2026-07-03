// ─────────────────────────────────────────────────────────────────────────────
// boot.js — arranque de koi-flow (Fase 0, scaffold). Self-boot: app.html importa
// este módulo y en `load` se construye la UI. Hereda el patrón self-boot de
// wind-shm/js/shm/shm_mode.js (jpreyes), pero minimal.
//
// Wirea: árbol Proyecto▸Sector + mapa 2D (Leaflet, todos los tramos) + relieve 3D
// (Three.js, sector con DEM). El resto (hidrología, cuencas, secciones, socavación)
// se monta sobre este esqueleto en fases siguientes.
// ─────────────────────────────────────────────────────────────────────────────
import { SceneView } from './scene_view.js?v=3';
import { toast } from './ui/toast.js?v=3';
import { MapView } from './map_view.js?v=3';
import { Capas } from './capas/capas.js?v=3';
import { loadProject } from './data.js?v=3';
import { HydroPanel } from './hidro/panel.js?v=3';
import { BatiPanel } from './bati/bati_ui.js?v=3';
import { Dock } from './ui/dock.js?v=3';
import { HudManager } from './ui/hud.js?v=3';
import { abrirEstacionHUD } from './datos/estacion_hud.js?v=3';
import { abrirConfigHUD } from './ui/config_ui.js?v=3';
import { generarInforme, generarInformeWord } from './informe/informe.js?v=3';
import { abrirAyudaHUD } from './ui/ayuda.js?v=3';
import { setupMenubar } from './ui/menubar.js?v=3';
import { abrirEmbalseHUD } from './hidro/embalse_ui.js?v=3';
import { abrirAlcantarillaHUD } from './hidraulica/alcantarilla_ui.js?v=3';
import { abrirPuenteHUD } from './hidraulica/puente_presion_ui.js?v=3';
import { abrirEnrocadoHUD } from './hidraulica/enrocado_ui.js?v=3';
import { abrirVerificacionesHUD } from './hidraulica/verificaciones_ui.js?v=3';
import { abrirDegradacionHUD } from './hidraulica/degradacion_ui.js?v=3';
import { abrirRoutingHUD } from './hidro/routing_ui.js?v=3';
import { abrirConvolucionHUD } from './hidro/convolucion_ui.js?v=3';
import { abrirTormentaHUD } from './hidro/tormenta_ui.js?v=3';
import { abrirRedHUD } from './hidro/red_ui.js?v=3';
import { abrirMorfoHUD } from './hidraulica/morfo1d_ui.js?v=3';
import { abrirContinuoHUD } from './hidro/continuo_ui.js?v=3';
import { abrirCalibracionHUD } from './hidro/calibracion_ui.js?v=3';
import { abrirModClarkHUD } from './hidro/modclark_ui.js?v=3';
import { abrirBreachHUD } from './hidro/breach_ui.js?v=3';
import { abrirSismoEstriboHUD } from './hidraulica/sismo_estribo_ui.js?v=3';
import { Flujo2D } from './hidraulica/panel2d.js?v=3';
import { EstructurasPanel } from './estructuras/panel.js?v=3';
import { delinearAuto } from './cuenca/cuenca.js?v=3';
import { delinearEnGrid, morfometria } from './cuenca/delineacion.js?v=3';
import { fetchDEM } from './cuenca/dem_tiles.js?v=3';
import { estacionesCercanas } from './datos/dga.js?v=3';
import { cargarHydroBasins, cuencaHydroBasins } from './cuenca/hydrobasins.js?v=3';
import { extraerRed, trazarCauce } from './cuenca/red_drenaje.js?v=3';
import { routD8 } from './cuenca/delineacion.js?v=3';
import { bus } from './ui/bus.js?v=3';
import { setActivo, infoTipo } from './ui/seleccion.js?v=3';
import { curvaAlturaVolumen, vasoANivel } from './hidro/presa.js?v=3';

export const KOI_VER = 'v2';

const $ = (id) => document.getElementById(id);

async function startBoot() {
  const status = $('load-status'), pct = $('load-pct'), bar = $('load-bar');
  const setProg = (p, msg) => { if (bar) bar.style.width = p + '%'; if (pct) pct.textContent = p + '%'; if (msg && status) status.textContent = msg; };

  setProg(10, 'Cargando proyecto…');
  const { project, fc, state } = await loadProject();

  setProg(35, 'Construyendo vistas…');
  const hydro = new HydroPanel();
  const huds = new HudManager($('viewport-wrap'));   // ventanas flotantes de resultados
  const map = new MapView($('map-container'), {
    onSelect: (f) => onTramoSelect(byName(f.properties.name)),
    onPointAdd: (p) => { hydro.setPuntos(map.getPoints()); hydro.analizarPunto(p); capas.render(); activarPunto(p); },
    onPointSelect: (p) => { hydro.setPuntos(map.getPoints()); hydro.analizarPunto(p); capas.render(); activarPunto(p); },
    onStationClick: (e) => abrirEstacionHUD(huds, e, { onLink: () => window.__koi?.dock?.show?.('hidro') }),
  });

  // Cálculo de cuenca a demanda (botón) — SOLO nuestro D8 sobre los flujos. HydroBASINS
  // NO entra acá: es referencia aparte (botón 🌎 "Ver cuenca aportante completa").
  hydro.calcularCuenca = async (p, onProgress) => {
    const snapMeters = p.snapMeters ?? hydro.snapMeters;
    // Si hay red de drenaje calculada y el punto cae dentro, delinea sobre ESE MISMO
    // grid/ruteo → la cuenca RESPETA los flujos que se ven (pedido del usuario).
    const rs = hydro.redState, b = rs?.grid?.bbox;
    const enRed = b && p.lon >= b.west && p.lon <= b.east && p.lat >= b.south && p.lat <= b.north;
    let r;
    if (enRed) {
      onProgress?.('Delineando sobre la red de drenaje…');
      r = delinearEnGrid(rs.grid, rs.rout, p.lon, p.lat, { snapMeters: snapMeters ?? 60 });
      r.grid = rs.grid; r.half = null; r.truncada = r.tocaBorde; r.enRed = true;
    } else {
      r = await delinearAuto(p.lon, p.lat, { snapMeters }, onProgress);
    }
    p.cuenca = r;
    map.showCuenca(p.id, r.polygon);
    capas.render();
    return r;
  };
  // Red de drenaje / afluentes de la VISTA ACTUAL (como el channel network de QGIS).
  hydro.redDrenaje = async (umbralKm2, onProgress) => {
    const b = map.map.getBounds();
    const bbox = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
    onProgress?.('Descargando DEM de la vista…');
    const grid = await fetchDEM(bbox, { maxDim: 512 });
    onProgress?.('Calculando red de drenaje…');
    const fc = extraerRed(grid, { umbralKm2: umbralKm2 || 0.25 });
    map.showRedDrenaje(fc);
    hydro.redState = { grid: fc.grid, rout: fc.rout };   // para delinear RESPETANDO estos flujos
    capas.render();
    return fc.meta;
  };
  hydro.limpiarRed = () => { map.clearRed(); };
  // Ruteo D8 en un WORKER (no congela la UI); si el worker falla, cae al síncrono.
  function routD8Async(grid) {
    return new Promise((resolve) => {
      let w;
      try { w = new Worker(new URL('./cuenca/worker_routd8.js', import.meta.url), { type: 'module' }); }
      catch { resolve(routD8(grid)); return; }
      const fin = (r) => { try { w.terminate(); } catch {} resolve(r); };
      const safety = setTimeout(() => fin(routD8(grid)), 20000);
      w.onmessage = (ev) => { clearTimeout(safety); fin(ev.data.error ? routD8(grid) : { elev: ev.data.elev, recv: ev.data.recv, accum: ev.data.accum }); };
      w.onerror = () => { clearTimeout(safety); fin(routD8(grid)); };
      w.postMessage({ grid });
    });
  }
  // Cauce del PUNTO pinchado: solo su árbol de afluentes (red ∩ cuenca del punto),
  // no toda la red de la vista. Reusa el ruteo cacheado si cubre el punto; si no,
  // baja un DEM alrededor (con holgura) y lo rutea EN UN WORKER. El umbral se puede
  // re-pasar en vivo (barato: no re-rutea). Deja la traza en el mapa y devuelve meta.
  hydro.cauceEnPunto = async (lon, lat, umbralKm2, onProgress) => {
    let st = hydro.redState;
    const dentro = (g) => g && lon >= g.bbox.west && lon <= g.bbox.east && lat >= g.bbox.south && lat <= g.bbox.north;
    if (!dentro(st?.grid)) {
      onProgress?.('Descargando DEM alrededor del punto…');
      // bbox centrado en el punto con holgura (mitiga el corte de cuenca por la vista).
      const b = map.map.getBounds();
      const dw = Math.max((b.getEast() - b.getWest()) * 0.75, 0.05), dh = Math.max((b.getNorth() - b.getSouth()) * 0.75, 0.05);
      const grid = await fetchDEM({ west: lon - dw, east: lon + dw, south: lat - dh, north: lat + dh }, { maxDim: 512 });
      onProgress?.('Ruteando el flujo (D8)…');
      st = hydro.redState = { grid, rout: await routD8Async(grid), zoom: map.map.getZoom() };
    }
    onProgress?.('Trazando el cauce del punto…');
    const fc = trazarCauce(st.grid, st.rout, lon, lat, { umbralKm2: umbralKm2 || 0.05 });
    map.showRedDrenaje(fc);
    hydro._ultimoCauce = { lon, lat };
    capas.render();
    return fc.meta;
  };
  // Auto-trazado: re-traza el punto activo al mover/zoom el mapa (debounce), con el
  // ruteo en el worker. Al cambiar el zoom se invalida el DEM cacheado para refinar
  // a la resolución del nuevo zoom. Un flag evita solapar corridas.
  hydro._autoCauce = false;
  hydro.setAutoCauce = (on) => {
    hydro._autoCauce = !!on;
    if (on && hydro._ultimoCauce) hydro._autoTick();
  };
  hydro._autoTick = () => {
    clearTimeout(hydro._autoTimer);
    hydro._autoTimer = setTimeout(async () => {
      if (!hydro._autoCauce || hydro._autoBusy) return;
      const c = hydro._ultimoCauce; if (!c) return;
      hydro._autoBusy = true;
      try {
        const z = map.map.getZoom();
        // el punto salió de la vista → no re-trazar (evita bajar DEM lejos del cauce)
        if (!map.map.getBounds().contains([c.lat, c.lon])) return;
        if (hydro.redState && Math.abs(z - (hydro.redState.zoom ?? z)) >= 1) hydro.redState = null; // refina por zoom
        const um = parseFloat(document.getElementById('rd_umbral')?.value) || 0.05;
        await hydro.cauceEnPunto(c.lon, c.lat, um);
      } catch (e) { console.warn('auto-cauce:', e.message); }
      finally { hydro._autoBusy = false; }
    }, 550);
  };
  map.map.on('moveend', () => { if (hydro._autoCauce) hydro._autoTick(); });

  // Colocar una PRESA/DEPÓSITO: clic en el muro → se saca el VASO del DEM (aguas
  // arriba, tipo bañera) + la curva altura-volumen. Objeto seleccionable (tipo presa),
  // que alimenta la rotura de presa (Vw) y, luego, la entrada del hidrograma al 2D.
  hydro.colocarPresa = () => {
    map.pickOnce(async (lon, lat) => {
      try {
        toast('Calculando el vaso desde el DEM…', 'info');
        let st = hydro.redState;
        const dentro = (g) => g && lon >= g.bbox.west && lon <= g.bbox.east && lat >= g.bbox.south && lat <= g.bbox.north;
        if (!dentro(st?.grid)) {
          const b = map.map.getBounds();
          const dw = Math.max((b.getEast() - b.getWest()) * 0.75, 0.05), dh = Math.max((b.getNorth() - b.getSouth()) * 0.75, 0.05);
          const grid = await fetchDEM({ west: lon - dw, east: lon + dw, south: lat - dh, north: lat + dh }, { maxDim: 512 });
          st = hydro.redState = { grid, rout: await routD8Async(grid), zoom: map.map.getZoom() };
        }
        const altura = 20;   // altura de muro por defecto [m] (editable luego)
        const cav = curvaAlturaVolumen(st.grid, st.rout, lon, lat, { alturaMax: 60, dz: 4 });
        const vaso = vasoANivel(st.grid, st.rout, lon, lat, cav.zBase + altura);
        const koi = window.__koi; koi.presas = koi.presas || [];
        const id = 'presa' + Date.now().toString(36);
        const presa = { id, tipo: 'presa', nombre: 'Presa ' + (koi.presas.length + 1), lon, lat, zBase: cav.zBase, altura, volumen: vaso.volumen, area: vaso.area, vaso: vaso.polygon, curva: cav.curva };
        koi.presas.push(presa);
        const activar = () => setActivo({ tipo: 'presa', id, nombre: presa.nombre, meta: `vaso ${(presa.volumen / 1e6).toFixed(2)} Mm³ · muro ${altura} m` });
        map.showPresa(presa, { onClick: activar });
        activar();
        toast(`Presa colocada: vaso ${(presa.volumen / 1e6).toFixed(2)} Mm³ (muro ${altura} m) desde el DEM.`, 'ok');
      } catch (e) { toast('No se pudo calcular el vaso: ' + e.message, 'error'); }
    }, 'Clic en el muro de la presa (sobre el cauce)');
  };
  // Cuenca aportante completa (HydroBASINS) a pedido, para cualquier punto.
  hydro.cuencaCompleta = async (p) => {
    await cargarHydroBasins();
    const hb = cuencaHydroBasins(p.lon, p.lat);
    if (hb) { p.cuencaHB = hb; map.showCuencaMulti(p.id, hb.multipolygon); }
    return hb;
  };
  hydro.irAPunto = (id) => { const p = map.getPoints().find((x) => x.id === id); if (p) { map.selectPoint(id); hydro.analizarPunto(p); activarPunto(p); } };
  hydro.borrarPunto = (id) => { map.removePoint(id); map.clearCuenca(id); hydro.setPuntos(map.getPoints()); capas.render(); };
  // Área de la cuenca de una estación de control (Apc) por delineación automática.
  hydro.delinearArea = async (lon, lat, onProgress) => {
    const r = await delinearAuto(lon, lat, {}, onProgress);
    return r?.morfometria?.A ?? null;
  };
  // Devuelve una grilla DEM (formato fetchDEM) para el tramo, bajándola si hace falta.
  hydro.getDemGrid = async (t, onProgress) => {
    if (t.demGrid) return t.demGrid;
    const cs = t.feature.geometry.coordinates;
    let w = 180, s = 90, e = -180, n = -90;
    for (const [lon, lat] of cs) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
    const mLon = Math.max((e - w) * 0.25, 0.006), mLat = Math.max((n - s) * 0.25, 0.006);
    onProgress?.('Descargando relieve…');
    t.demGrid = await fetchDEM({ west: w - mLon, east: e + mLon, south: s - mLat, north: n + mLat }, { maxDim: 256 });
    return t.demGrid;
  };
  const scene = new SceneView($('viewport-container'));
  const dock = new Dock($('main') || document.body);
  dock.map = map.map;
  // Layout del grid #main lo maneja JS (var() no resuelve en grid-template en este motor).
  let treeW = 270, dockW = 34;
  const applyGrid = () => { $('main').style.gridTemplateColumns = `${treeW}px 6px minmax(0,1fr) ${dockW}px`; map.map.invalidateSize(); };
  dock.onResize = (w) => { dockW = w; applyGrid(); };
  applyGrid();
  wireTreeResize(() => treeW, (w) => { treeW = w; applyGrid(); });
  hydro.setMap(map); hydro.setDock(dock);
  hydro._renderCuenca(null);   // deja el botón "Agregar punto" visible en la pestaña Cuenca
  const bati = new BatiPanel();
  bati.setMap(map); bati.setScene(scene); bati.setDock(dock);
  bati.onVer3D(() => { if (current) { setMode('3d'); } });
  const flujo2d = new Flujo2D();
  flujo2d.setMap(map); flujo2d.setScene(scene); flujo2d.setDock(dock);
  const estr = new EstructurasPanel();
  estr.setMap(map); estr.setScene(scene); estr.setDock(dock);
  estr.onVer3D(() => { if (current && tieneRelieve(current)) { setMode('3d'); load3D(current); } else setMode('3d'); });
  const capas = new Capas($('tree'), { map, project, onSelectTramo: onTramoSelect, onRelieve: relieveTramo, hydro });
  window.__koi = { capas, map, scene, hydro, bati, flujo2d, estr, dock, huds, project };   // hook de depuración/automatización
  if (state) capas.aplicarEstado(state);   // restaura puntos/cuencas/estructuras/eje del proyecto abierto

  // Relieve "activo" = disponible (DEM bajado o pre-generado) y no desactivado.
  const tieneRelieve = (t) => !!(t && !t.relieveOff && (t.dem || t.demGrid));

  // Carga el relieve 3D del tramo (DEM JSON pre-generado o grilla bajada).
  async function load3D(t) {
    if (t.demGrid) scene.loadSectorGrid(t.demGrid, t.feature);
    else if (t.dem) await scene.loadSector(t.dem, t.feature);
  }

  const menuItem = (a) => document.querySelector(`.menu-item[data-action="${a}"]`);
  function refreshBtn3D() {
    const t = current; if (!t) return;
    const has = tieneRelieve(t);
    menuItem('ver-3d')?.classList.toggle('disabled', !has);
    if ($('sel-info')) $('sel-info').textContent = `${t.npts} puntos · ${has ? 'relieve activo' : 'sin relieve'}`;
  }

  // La montañita del árbol SÓLO activa/desactiva el relieve del tramo (no cambia la vista).
  async function relieveTramo(t) {
    if (tieneRelieve(t)) {                       // desactivar (quitar)
      t.relieveOff = true; t.demGrid = null;
      if (current === t && mode === '3d') setMode('2d');
    } else {                                     // activar (descargar si hace falta)
      t.relieveOff = false;
      if (!t.dem && !t.demGrid) {
        const cs = t.feature.geometry.coordinates;
        let w = 180, s = 90, e = -180, n = -90;
        for (const [lon, lat] of cs) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
        const mLon = Math.max((e - w) * 0.25, 0.006), mLat = Math.max((n - s) * 0.25, 0.006);
        capas.setRelieveCargando(t.name, true);
        try { t.demGrid = await fetchDEM({ west: w - mLon, east: e + mLon, south: s - mLat, north: n + mLat }, { maxDim: 256 }); }
        catch (err) { capas.setRelieveCargando(t.name, false); toast('No se pudo bajar el relieve: ' + err.message, 'error'); return; }
      }
    }
    capas.render();
    refreshBtn3D();
  }

  // Redimensionado del árbol izquierdo (arrastre del divisor).
  function wireTreeResize(getW, setW) {
    const tree = $('tree'), h = $('tree-resize'); if (!tree || !h) return;
    let drag = false, sx = 0, sw = 0;
    const onMove = (e) => { if (!drag) return; setW(Math.max(180, Math.min(560, sw + (e.clientX - sx)))); };
    const onUp = () => { drag = false; document.body.style.cursor = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); map.map.invalidateSize(); };
    h.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sw = getW(); document.body.style.cursor = 'col-resize'; e.preventDefault(); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); });
  }

  map.setTramos(fc);

  // Estaciones DGA: catálogo NACIONAL → muestra las cercanas a DONDE ESTÁS MIRANDO
  // (centro del mapa), y se actualizan al mover el mapa. (Osorno→Osorno, etc.)
  let _estTimer;
  async function actualizarEstaciones() {
    try {
      const c = map.map.getCenter(); const centro = [c.lng, c.lat];
      const pl = await estacionesCercanas(centro, { tipo: 'pluviometrica', n: 18 });
      const fl = await estacionesCercanas(centro, { tipo: 'fluviometrica', n: 18 });
      if (pl.length || fl.length) map.showStations([...pl, ...fl]);
    } catch (err) { console.warn('estaciones DGA:', err.message); }
  }
  hydro.actualizarEstaciones = actualizarEstaciones;
  actualizarEstaciones();
  map.map.on('moveend', () => { clearTimeout(_estTimer); _estTimer = setTimeout(actualizarEstaciones, 500); });

  let mode = '2d';            // '2d' (mapa) | '3d' (relieve)
  let current = null;         // tramo seleccionado

  function byName(name) { return project.tramos.find((t) => t.name === name); }

  function setMode(m) {
    mode = m;
    const is3d = m === '3d';
    scene.setVisible(is3d);
    map.setVisible(!is3d);
    menuItem('ver-2d')?.classList.toggle('on', !is3d);
    menuItem('ver-3d')?.classList.toggle('on', is3d);
  }

  // Marca un punto como objeto activo (indicador "Trabajando en: X").
  function activarPunto(p) {
    if (!p) return;
    // Cada objeto lleva SU crecida: al activarlo, esa (o ninguna) es la que usan el 2D/tránsito.
    const k = window.__koi; if (k) { k.hidrogramaCrecida = p.crecida?.hidrograma || null; k.reologia = p.crecida?.reologia || null; }
    setActivo({ tipo: p.cuenca ? 'cuenca' : 'punto', id: p.id, nombre: p.nombre,
      meta: p.cuenca ? `cuenca ${p.cuenca.morfometria.A} km² · ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` });
  }
  // Indicador universal "Trabajando en: <objeto>" sobre la tarjeta #sel-card.
  bus.on('seleccion:cambio', (o) => {
    const card = $('sel-card'), nm = $('sel-name'), inf = $('sel-info');
    if (!card) return;
    if (!o) { card.classList.remove('sel-activo'); if (nm) nm.textContent = '—'; if (inf) inf.textContent = 'Nada seleccionado'; return; }
    const t = infoTipo(o.tipo);
    card.classList.add('sel-activo');
    card.style.setProperty('--sel-color', t.color);
    if (nm) nm.innerHTML = `<span class="sel-badge" style="background:${t.color}">${t.ico} ${t.label}</span><span class="sel-nom">${o.nombre || ''}</span>`;
    if (inf) inf.textContent = o.meta || 'Trabajando en este objeto';
  });

  async function onTramoSelect(t) {
    if (!t) return;
    current = t;
    capas.selectTramo(t.name);
    map.select(t.name);
    const has = tieneRelieve(t);
    menuItem('ver-3d')?.classList.toggle('disabled', !has);
    hydro.setTramo(t);
    bati.setTramo(t);
    flujo2d.setTramo(t);
    setActivo({ tipo: 'tramo', id: t.name, nombre: t.name, meta: has ? `${t.npts} puntos · relieve disponible` : `${t.npts} puntos · sin relieve` });
    if (has && mode === '3d') await load3D(t);
  }

  const treeQ = (sel) => $('tree')?.querySelector(sel);
  const acciones = {
    'proj-nuevo': () => capas._nuevoProyecto(),
    'proj-abrir': () => treeQ('#cap-proj')?.click(),
    'proj-guardar': () => capas.guardarProyecto(),
    'importar': () => treeQ('#cap-file')?.click(),
    'bati': () => { dock.show('hidraulica'); setTimeout(() => bati.body?.querySelector('#bp-file')?.click(), 60); },
    'informe': () => generarInforme(window.__koi),
    'informe-word': () => generarInformeWord(window.__koi),
    'add-punto': () => { if (mode !== '2d') setMode('2d'); map.setPickMode(!map.pickMode); },
    'add-etiqueta': () => capas._colocarEtiqueta(),
    'config': () => abrirConfigHUD(huds),
    'ver-2d': () => setMode('2d'),
    'ver-3d': () => { if (current && tieneRelieve(current)) { setMode('3d'); load3D(current); } else setMode('3d'); },
    'tema': () => window.__koiToggleTheme?.(),
    'tab-cuenca': () => dock.show('cuenca'),
    'tab-hidro': () => dock.show('hidro'),
    'tab-hidraulica': () => dock.show('hidraulica'),
    'tab-estructuras': () => dock.show('estructuras'),
    'embalse': () => abrirEmbalseHUD(window.__koi, huds),
    'alcantarilla': () => abrirAlcantarillaHUD(window.__koi, huds),
    'puente-presion': () => abrirPuenteHUD(window.__koi, huds),
    'enrocado': () => abrirEnrocadoHUD(window.__koi, huds),
    'verificaciones': () => abrirVerificacionesHUD(window.__koi, huds),
    'degradacion': () => abrirDegradacionHUD(window.__koi, huds),
    'routing': () => abrirRoutingHUD(window.__koi, huds),
    'tormenta': () => abrirTormentaHUD(window.__koi, huds),
    'convolucion': () => abrirConvolucionHUD(window.__koi, huds),
    'red': () => abrirRedHUD(window.__koi, huds),
    'continuo': () => abrirContinuoHUD(window.__koi, huds),
    'calibracion': () => abrirCalibracionHUD(window.__koi, huds),
    'modclark': () => abrirModClarkHUD(window.__koi, huds),
    'morfo1d': () => abrirMorfoHUD(window.__koi, huds),
    'colocar-presa': () => hydro.colocarPresa(),
    'breach': () => abrirBreachHUD(window.__koi, huds),
    'sismo-estribo': () => abrirSismoEstriboHUD(window.__koi, huds),
    'ayuda': () => abrirAyudaHUD(huds),
    'acerca': () => huds.open('acerca', { title: 'Acerca de koi-flow', w: 380, h: 240,
      html: `<p><b>koi-flow</b> — estudios hidrológico-hidráulicos en el navegador (MC-V3 / DGA).</p>
        <p class="hud-note">Software propiedad de <b>JPReyes / Conmuta.cl</b>. Licencia <b>AGPL-3.0</b>.</p>
        <p class="hud-note">PWA sin build · JS ES-modules + Three.js + Leaflet.</p>` }),
  };
  setupMenubar(acciones);
  // Los chips de "Resultados calculados" (árbol) reabren su HUD por el bus.
  bus.on('abrir:analisis', (a) => acciones[a]?.());
  // Aviso al proyecto abierto (por si algún panel quiere reaccionar).
  bus.emit('proyecto:abierto', { id: project.id, name: project.name });

  // Atajos de teclado globales: Ctrl+S guarda el proyecto (sin abrir el diálogo del navegador).
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      capas.guardarProyecto();
    }
  });

  // Selección inicial: el primer tramo con DEM (Tramo 3) para mostrar algo rico.
  const first = project.tramos.find((t) => t.dem) || project.tramos[0];
  setMode('2d');
  onTramoSelect(first);

  setProg(100, 'Listo');
  setTimeout(() => window.__koiCloseLanding?.(), 350);
}

if (document.readyState === 'complete') startBoot();
else window.addEventListener('load', startBoot);
