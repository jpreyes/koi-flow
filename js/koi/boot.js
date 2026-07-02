// ─────────────────────────────────────────────────────────────────────────────
// boot.js — arranque de koi-flow (Fase 0, scaffold). Self-boot: app.html importa
// este módulo y en `load` se construye la UI. Hereda el patrón self-boot de
// wind-shm/js/shm/shm_mode.js (jpreyes), pero minimal.
//
// Wirea: árbol Proyecto▸Sector + mapa 2D (Leaflet, todos los tramos) + relieve 3D
// (Three.js, sector con DEM). El resto (hidrología, cuencas, secciones, socavación)
// se monta sobre este esqueleto en fases siguientes.
// ─────────────────────────────────────────────────────────────────────────────
import { SceneView } from './scene_view.js?v=2';
import { MapView } from './map_view.js?v=2';
import { Capas } from './capas/capas.js?v=2';
import { loadProject } from './data.js?v=2';
import { HydroPanel } from './hidro/panel.js?v=2';
import { BatiPanel } from './bati/bati_ui.js?v=2';
import { Dock } from './ui/dock.js?v=2';
import { HudManager } from './ui/hud.js?v=2';
import { abrirEstacionHUD } from './datos/estacion_hud.js?v=2';
import { abrirConfigHUD } from './ui/config_ui.js?v=2';
import { generarInforme, generarInformeWord } from './informe/informe.js?v=2';
import { abrirAyudaHUD } from './ui/ayuda.js?v=2';
import { setupMenubar } from './ui/menubar.js?v=2';
import { abrirEmbalseHUD } from './hidro/embalse_ui.js?v=2';
import { abrirAlcantarillaHUD } from './hidraulica/alcantarilla_ui.js?v=2';
import { abrirPuenteHUD } from './hidraulica/puente_presion_ui.js?v=2';
import { abrirEnrocadoHUD } from './hidraulica/enrocado_ui.js?v=2';
import { abrirVerificacionesHUD } from './hidraulica/verificaciones_ui.js?v=2';
import { abrirDegradacionHUD } from './hidraulica/degradacion_ui.js?v=2';
import { abrirRoutingHUD } from './hidro/routing_ui.js?v=2';
import { abrirConvolucionHUD } from './hidro/convolucion_ui.js?v=2';
import { abrirRedHUD } from './hidro/red_ui.js?v=2';
import { abrirMorfoHUD } from './hidraulica/morfo1d_ui.js?v=2';
import { abrirContinuoHUD } from './hidro/continuo_ui.js?v=2';
import { Flujo2D } from './hidraulica/panel2d.js?v=2';
import { EstructurasPanel } from './estructuras/panel.js?v=2';
import { delinearAuto } from './cuenca/cuenca.js?v=2';
import { delinearEnGrid, morfometria } from './cuenca/delineacion.js?v=2';
import { fetchDEM } from './cuenca/dem_tiles.js?v=2';
import { estacionesCercanas } from './datos/dga.js?v=2';
import { cargarHydroBasins, cuencaHydroBasins } from './cuenca/hydrobasins.js?v=2';
import { extraerRed } from './cuenca/red_drenaje.js?v=2';

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
    onPointAdd: (p) => { hydro.setPuntos(map.getPoints()); hydro.analizarPunto(p); capas.render(); },
    onPointSelect: (p) => { hydro.setPuntos(map.getPoints()); hydro.analizarPunto(p); capas.render(); },
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
  // Cuenca aportante completa (HydroBASINS) a pedido, para cualquier punto.
  hydro.cuencaCompleta = async (p) => {
    await cargarHydroBasins();
    const hb = cuencaHydroBasins(p.lon, p.lat);
    if (hb) { p.cuencaHB = hb; map.showCuencaMulti(p.id, hb.multipolygon); }
    return hb;
  };
  hydro.irAPunto = (id) => { const p = map.getPoints().find((x) => x.id === id); if (p) { map.selectPoint(id); hydro.analizarPunto(p); } };
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
        catch (err) { capas.setRelieveCargando(t.name, false); alert('No se pudo bajar el relieve: ' + err.message); return; }
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

  async function onTramoSelect(t) {
    if (!t) return;
    current = t;
    capas.selectTramo(t.name);
    map.select(t.name);
    const has = tieneRelieve(t);
    menuItem('ver-3d')?.classList.toggle('disabled', !has);
    $('sel-name').textContent = t.name;
    $('sel-info').textContent = has ? `${t.npts} puntos · relieve disponible` : `${t.npts} puntos · sin relieve`;
    hydro.setTramo(t);
    bati.setTramo(t);
    flujo2d.setTramo(t);
    if (has && mode === '3d') await load3D(t);
  }

  const treeQ = (sel) => $('tree')?.querySelector(sel);
  setupMenubar({
    'proj-nuevo': () => capas._nuevoProyecto(),
    'proj-demo': () => capas._abrirProyecto('demo'),
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
    'convolucion': () => abrirConvolucionHUD(window.__koi, huds),
    'red': () => abrirRedHUD(window.__koi, huds),
    'continuo': () => abrirContinuoHUD(window.__koi, huds),
    'morfo1d': () => abrirMorfoHUD(window.__koi, huds),
    'ayuda': () => abrirAyudaHUD(huds),
    'acerca': () => huds.open('acerca', { title: 'Acerca de koi-flow', w: 380, h: 240,
      html: `<p><b>koi-flow</b> — estudios hidrológico-hidráulicos en el navegador (MC-V3 / DGA).</p>
        <p class="hud-note">Software propiedad de <b>JPReyes / Conmuta.cl</b>. Licencia <b>AGPL-3.0</b>.</p>
        <p class="hud-note">PWA sin build · JS ES-modules + Three.js + Leaflet.</p>` }),
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
