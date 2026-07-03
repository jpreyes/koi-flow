// ─────────────────────────────────────────────────────────────────────────────
// map_view.js — vista 2D (Leaflet) de koi-flow. Muestra todos los tramos del
// proyecto sobre imagen satelital / topográfica y permite seleccionar uno.
// Adaptado de la lógica de wind-shm/js/shm/map_view.js (jpreyes), simplificado.
// `window.L` lo provee lib/leaflet/leaflet.js (cargado antes que los módulos).
// ─────────────────────────────────────────────────────────────────────────────
export class MapView {
  constructor(container, { onSelect, onPointAdd, onPointSelect, onStationClick } = {}) {
    this.el = container;
    this.onSelect = onSelect;
    this.onPointAdd = onPointAdd;
    this.onPointSelect = onPointSelect;
    this.onStationClick = onStationClick;
    this.layers = new Map();   // name -> polyline
    this.selected = null;
    this.points = [];          // [{id, lon, lat, nombre}]
    this.pointLayers = new Map();
    this.stationLayers = new Map();   // bna_tipo -> marker
    this.pickMode = false;
    this._seq = 0;

    const L = window.L;
    this.map = L.map(container, { zoomControl: true, attributionControl: true, maxZoom: 22 })
      .setView([-35.5, -71.2], 5);   // vista inicial: gran parte de Chile (no un sector puntual)
    this.map.on('click', (e) => { if (this.pickMode) this.addPoint(e.latlng.lng, e.latlng.lat); });
    // Encuadra Chile continental de forma robusta según el tamaño de la ventana (Arica→Chiloé
    // aprox.), independiente del aspecto de pantalla. Si falla, queda el setView de arriba.
    try { this.map.fitBounds([[-18.4, -75.8], [-43.5, -66.0]], { padding: [10, 10] }); } catch {}

    // maxNativeZoom: al pasar el zoom nativo, Leaflet ESCALA el último tile disponible
    // en vez de pedir tiles inexistentes (evita el cartel "Map data not yet available").
    // En Atacama Esri sólo tiene imagen satelital hasta ~z17 (z18+ devuelve el tile
    // "Map data not yet available"). maxNativeZoom=17 → Leaflet ESCALA el z17 real
    // en vez de pedir los placeholders. OpenTopoMap hasta z16.
    this.baseSat = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 22, maxNativeZoom: 17, attribution: 'Esri World Imagery' });
    this.baseTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { maxZoom: 22, maxNativeZoom: 16, attribution: '© OpenTopoMap' });
    this.baseSat.addTo(this.map);
    L.control.layers({ 'Satélite': this.baseSat, 'Topográfico': this.baseTopo }).addTo(this.map);
    L.control.scale({ imperial: false }).addTo(this.map);

    // Grupos de capas conmutables (árbol de capas tipo Google Earth).
    this.groups = {
      tramos: L.layerGroup().addTo(this.map),
      puntos: L.layerGroup().addTo(this.map),
      cuencas: L.layerGroup().addTo(this.map),
      estaciones: L.layerGroup().addTo(this.map),
      bati: L.layerGroup().addTo(this.map),
      red: L.layerGroup().addTo(this.map),
      malla2d: L.layerGroup().addTo(this.map),
      labels: L.layerGroup().addTo(this.map),
      estructuras: L.layerGroup().addTo(this.map),
      presas: L.layerGroup().addTo(this.map),
    };
    this.importLayers = new Map();   // id -> { group, name, bounds }
    this._impSeq = 0;
    this.labelLayers = new Map();    // id -> marker (etiquetas referenciales)
    this._lblSeq = 0;
  }

  // Activa/desactiva un grupo base ('tramos'|'puntos'|'cuencas'|'estaciones').
  setLayerVisible(key, on) {
    const g = this.groups[key]; if (!g) return;
    if (on) this.map.addLayer(g); else this.map.removeLayer(g);
  }

  // ── Capas importadas (KML/KMZ referenciales) ────────────────────────────────
  addImport(name, geojson, opts = {}) {
    const L = window.L;
    const id = ++this._impSeq;
    const color = opts.color || '#f59e0b';
    const layer = L.geoJSON(geojson, {
      style: () => ({ color, weight: 2, fillColor: color, fillOpacity: 0.12 }),
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 4, color, weight: 2, fillOpacity: 0.8 }),
      onEachFeature: (f, ly) => { const n = f.properties?.name; if (n) ly.bindTooltip(String(n), { sticky: true }); },
    }).addTo(this.map);
    let bounds = null; try { bounds = layer.getBounds(); } catch {}
    this.importLayers.set(id, { group: layer, name, bounds, color });
    return id;
  }
  toggleImport(id, on) {
    const it = this.importLayers.get(id); if (!it) return;
    if (on) this.map.addLayer(it.group); else this.map.removeLayer(it.group);
  }
  removeImport(id) {
    const it = this.importLayers.get(id); if (!it) return;
    this.map.removeLayer(it.group); this.importLayers.delete(id);
  }
  zoomImport(id) {
    const it = this.importLayers.get(id); if (it?.bounds?.isValid()) this.map.fitBounds(it.bounds, { padding: [40, 40] });
  }

  // geojson FeatureCollection de LineStrings (tramos)
  setTramos(fc) {
    const L = window.L;
    this.groups.tramos.clearLayers();
    this.layers.clear();
    const bounds = [];
    for (const f of fc.features) {
      const latlngs = f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      bounds.push(...latlngs);
      const pl = L.polyline(latlngs, { color: '#e23b5a', weight: 4, opacity: 0.9 })
        .bindTooltip(f.properties.name, { sticky: true });
      pl.on('click', () => { if (this._noSelect) return; this.select(f.properties.name); this.onSelect?.(f); });
      this.groups.tramos.addLayer(pl);
      this.layers.set(f.properties.name, pl);
    }
    if (bounds.length) this.map.fitBounds(bounds, { padding: [40, 40] });
  }

  // Agrega UN tramo (LineString feature) sin reconstruir los demás. Usado al
  // importar KMZ/KML: la línea importada se vuelve un tramo de primera clase
  // (seleccionable, con relieve/eje/hidrología) igual que los del proyecto.
  //   opts.zoom: encuadrar al tramo recién añadido.
  addTramo(feature, opts = {}) {
    const L = window.L;
    const name = feature.properties?.name;
    if (!name || !feature.geometry?.coordinates?.length) return null;
    const latlngs = feature.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    const pl = L.polyline(latlngs, { color: '#e23b5a', weight: 4, opacity: 0.9 })
      .bindTooltip(name, { sticky: true });
    pl.on('click', () => { if (this._noSelect) return; this.select(name); this.onSelect?.(feature); });
    this.groups.tramos.addLayer(pl);
    this.layers.set(name, pl);
    if (opts.zoom) { try { this.map.fitBounds(pl.getBounds(), { padding: [60, 60], maxZoom: 15 }); } catch {} }
    return pl;
  }

  removeTramo(name) {
    const ly = this.layers.get(name);
    if (ly) this.groups.tramos.removeLayer(ly);
    this.layers.delete(name);
    if (this.selected === name) this.selected = null;
  }

  select(name) {
    if (this.selected && this.layers.has(this.selected))
      this.layers.get(this.selected).setStyle({ color: '#e23b5a', weight: 4 });
    this.selected = name;
    const ly = this.layers.get(name);
    if (ly) { ly.setStyle({ color: '#1ea7c5', weight: 6 }); ly.bringToFront(); this.map.fitBounds(ly.getBounds(), { padding: [80, 80], maxZoom: 15 }); }
  }

  // ── Cuencas delineadas ──────────────────────────────────────────────────────
  showCuenca(id, polygon) {
    const L = window.L;
    this.cuencaLayers = this.cuencaLayers || new Map();
    this.clearCuenca(id);
    if (!polygon || !polygon.length) return;
    const latlngs = polygon.map(([lon, lat]) => [lat, lon]);
    const poly = L.polygon(latlngs, { color: '#2563eb', weight: 2, fillColor: '#2563eb', fillOpacity: 0.18 });
    this.groups.cuencas.addLayer(poly);
    this.cuencaLayers.set(id, poly);
    this.map.fitBounds(poly.getBounds(), { padding: [40, 40], maxZoom: 16 });
  }
  // Cuenca aportante COMPLETA (HydroBASINS): multipolígono de sub-cuencas.
  showCuencaMulti(id, multipolygon) {
    const L = window.L;
    this.cuencaLayers = this.cuencaLayers || new Map();
    this.clearCuenca(id);
    if (!multipolygon || !multipolygon.length) return;
    const latlngs = multipolygon.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
    const poly = L.polygon(latlngs, { color: '#7c3aed', weight: 1.5, fillColor: '#7c3aed', fillOpacity: 0.12 });
    this.groups.cuencas.addLayer(poly);
    this.cuencaLayers.set(id, poly);
    try { this.map.fitBounds(poly.getBounds(), { padding: [40, 40] }); } catch {}
  }

  clearCuenca(id) {
    if (!this.cuencaLayers) return;
    if (id == null) { for (const p of this.cuencaLayers.values()) this.groups.cuencas.removeLayer(p); this.cuencaLayers.clear(); return; }
    const p = this.cuencaLayers.get(id); if (p) { this.groups.cuencas.removeLayer(p); this.cuencaLayers.delete(id); }
  }

  // ── Presa / depósito (embalse o relave): vaso (polígono) + muro (marcador) ─────
  showPresa(presa, { onClick } = {}) {
    const L = window.L;
    this.presaLayers = this.presaLayers || new Map();
    this.clearPresa(presa.id);
    const g = L.layerGroup();
    if (presa.vaso?.length) {
      const latlngs = presa.vaso.map(([lo, la]) => [la, lo]);
      g.addLayer(L.polygon(latlngs, { color: '#d97706', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.28 })
        .bindTooltip(`Vaso de ${presa.nombre} · ${(presa.volumen / 1e6).toFixed(2)} Mm³`, { sticky: true }));
    }
    const icon = L.divIcon({ className: 'koi-presa', html: '⛰', iconSize: [26, 26], iconAnchor: [13, 13] });
    const mk = L.marker([presa.lat, presa.lon], { icon, zIndexOffset: 700 }).bindTooltip(presa.nombre, { direction: 'top' });
    if (onClick) mk.on('click', () => onClick(presa));
    g.addLayer(mk);
    g.addTo(this.map);
    this.presaLayers.set(presa.id, g);
  }
  clearPresa(id) {
    if (!this.presaLayers) return;
    if (id == null) { for (const g of this.presaLayers.values()) this.map.removeLayer(g); this.presaLayers.clear(); return; }
    const g = this.presaLayers.get(id); if (g) { this.map.removeLayer(g); this.presaLayers.delete(id); }
  }

  // ── Estaciones DGA en el mapa ───────────────────────────────────────────────
  showStations(estaciones) {
    const L = window.L;
    this._stations = estaciones || [];
    this.clearStations();
    for (const e of estaciones) {
      const fluvio = e.tipo === 'fluviometrica';
      const cls = `koi-st ${fluvio ? 'fl' : 'pl'}`;
      const icon = L.divIcon({ className: cls, html: `<span>${fluvio ? '🌊' : '🌧'}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      const mk = L.marker([e.lat, e.lon], { icon, zIndexOffset: -100 })
        .bindTooltip(`${e.nombre} · ${fluvio ? 'fluvio' : 'pluvio'} · ${e.n_anios} a · clic para ver serie`, { direction: 'top' });
      mk.on('click', () => { this.highlightStation(e, { pan: false }); this.onStationClick?.(e); });
      this.groups.estaciones.addLayer(mk);
      this.stationLayers.set(e.bna + '_' + e.tipo, mk);
    }
  }

  highlightStation(est, { pan = true } = {}) {
    const key = est.bna + '_' + est.tipo;
    for (const [k, mk] of this.stationLayers) mk.getElement()?.classList.toggle('sel', k === key);
    const mk = this.stationLayers.get(key);
    if (mk && pan) this.map.panTo(mk.getLatLng());
  }

  clearStations() {
    for (const mk of this.stationLayers.values()) this.groups.estaciones.removeLayer(mk);
    this.stationLayers.clear();
  }

  // ── Dibujo interactivo de polígono/polilínea (para el dominio 2D y el cauce) ──
  // modo:'poly'|'line'. Llama onDone([[lon,lat]…]) al terminar (dblclick o Esc).
  dibujar(modo, color, onDone, opts = {}) {
    const L = window.L;
    const maxPts = opts.maxPts || 0;                // si >0, termina solo al llegar a ese nº de puntos
    this.cancelarDibujo();
    if (this.pickMode) this.setPickMode(false);   // interactuar con otra entidad apaga el modo Punto
    this._noSelect = true;                          // mientras dibujas no seleccionas lo de abajo
    const pts = [];
    const g = this.groups.malla2d;
    const linea = L.polyline([], { color, weight: 2, dashArray: '4 3' }); g.addLayer(linea);
    const verts = L.layerGroup(); g.addLayer(verts);
    const redraw = () => {
      const ll = pts.map(([lo, la]) => [la, lo]);
      linea.setLatLngs(modo === 'poly' && pts.length > 2 ? [...ll, ll[0]] : ll);
    };
    const onClick = (e) => {
      pts.push([e.latlng.lng, e.latlng.lat]);
      verts.addLayer(L.circleMarker(e.latlng, { radius: 4, color, weight: 2, fillOpacity: 1, fillColor: '#fff' }));
      redraw();
      if (maxPts && pts.length >= maxPts) finish();   // auto-termina al llegar al nº de puntos
    };
    const finish = (e) => { if (e) window.L.DomEvent.stop(e); this.cancelarDibujo(); if (pts.length >= (modo === 'poly' ? 3 : 2)) onDone?.(pts); };
    const cont = this.map.getContainer();
    cont.classList.add('dibujando');
    // BLOQUEA el arrastre de otros marcadores (p.ej. el ✛ del DEM batimétrico) para que
    // los clics agreguen vértices y NO muevan el DEM.
    this._lockedDrag = [];
    for (const grp of [this.groups.bati, this.groups.puntos]) grp.eachLayer((l) => { if (l.dragging?.enabled?.()) { l.dragging.disable(); this._lockedDrag.push(l); } });
    // aviso persistente
    const hint = document.createElement('div'); hint.className = 'draw-hint';
    hint.innerHTML = `✏️ Dibujando ${modo === 'poly' ? 'el dominio' : 'el cauce'} — <b>clic</b> = vértice · <b>doble-clic / clic-derecho / Esc</b> = terminar`;
    cont.appendChild(hint); this._drawHint = hint;
    this.map.on('click', onClick);
    this.map.on('dblclick', finish);
    this.map.on('contextmenu', finish);
    this._draw2d = { onClick, finish, prevDbl: this.map.doubleClickZoom.enabled() };
    this.map.doubleClickZoom.disable();
    this._escH = (ev) => { if (ev.key === 'Escape') finish(); };
    document.addEventListener('keydown', this._escH);
  }
  enDibujo() { return !!this._draw2d; }
  cancelarDibujo() {
    this._noSelect = false;
    if (this._pick1) this._pick1.done();
    if (!this._draw2d) return;
    this.map.off('click', this._draw2d.onClick); this.map.off('dblclick', this._draw2d.finish); this.map.off('contextmenu', this._draw2d.finish);
    if (this._draw2d.prevDbl) this.map.doubleClickZoom.enable();
    this.map.getContainer().classList.remove('dibujando');
    for (const l of (this._lockedDrag || [])) l.dragging?.enable?.();
    this._lockedDrag = [];
    if (this._drawHint) { this._drawHint.remove(); this._drawHint = null; }
    document.removeEventListener('keydown', this._escH);
    this._draw2d = null;
  }

  // Captura UN solo clic en el mapa → onPick(lon, lat). Cursor de mira + Esc cancela.
  pickOnce(onPick, hintTxt = 'Clic en el mapa para colocar · Esc cancela') {
    this.cancelarDibujo();
    if (this.pickMode) this.setPickMode(false);   // apaga el modo Punto al colocar otra entidad
    this._noSelect = true;                          // no seleccionar lo que hay debajo al colocar
    const cont = this.map.getContainer();
    cont.classList.add('dibujando');
    const hint = document.createElement('div'); hint.className = 'draw-hint';
    hint.innerHTML = `🏷 ${hintTxt}`; cont.appendChild(hint);
    const done = () => {
      this._noSelect = false;
      this.map.off('click', onClick); document.removeEventListener('keydown', esc);
      cont.classList.remove('dibujando'); hint.remove(); this._pick1 = null;
    };
    const onClick = (e) => { const { lng, lat } = e.latlng; done(); onPick?.(lng, lat); };
    const esc = (ev) => { if (ev.key === 'Escape') done(); };
    this.map.on('click', onClick); document.addEventListener('keydown', esc);
    this._pick1 = { done };
  }

  // ── Etiquetas referenciales (río / ciudad / camino / punto) ──────────────────
  addLabel({ id, lon, lat, name, tipo = 'rio' } = {}) {
    const L = window.L;
    if (id == null) id = ++this._lblSeq; else this._lblSeq = Math.max(this._lblSeq, id);
    const glyph = { rio: '≈', ciudad: '◉', camino: '▤', punto: '•' }[tipo] || '•';
    const icon = L.divIcon({ className: `koi-label koi-label-${tipo}`, iconSize: null, iconAnchor: [7, 7],
      html: `<span class="koi-label-dot">${glyph}</span><span class="koi-label-tx">${name || ''}</span>` });
    const mk = L.marker([lat, lon], { icon, interactive: true });
    mk.bindTooltip(`${tipo}: ${name || '—'} · ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    this.groups.labels.addLayer(mk);
    this.labelLayers.set(id, mk);
    return id;
  }
  removeLabel(id) { const mk = this.labelLayers.get(id); if (mk) { this.groups.labels.removeLayer(mk); this.labelLayers.delete(id); } }
  zoomLabel(id) { const mk = this.labelLayers.get(id); if (mk) this.map.panTo(mk.getLatLng()); }

  // ── Estructuras (planta) ─────────────────────────────────────────────────────
  // estructuras: [{id, tipo, solido, planta:[[lon,lat]], nombre}]; onPick(id) al clic.
  showEstructuras(estructuras, { onPick, sel } = {}) {
    const L = window.L;
    this.groups.estructuras.clearLayers();
    for (const e of estructuras || []) {
      const poly = e.planta; if (!poly || poly.length < 2) continue;
      const color = e.solido ? '#a855f7' : '#f59e0b';
      const ll = poly.map(([lo, la]) => [la, lo]);
      const shape = e.forma === 'linea'
        ? L.polyline(ll, { color, weight: 4, opacity: 0.9 })
        : L.polygon(ll, { color, weight: 2, fillColor: color, fillOpacity: e.id === sel ? 0.5 : 0.3 });
      shape.bindTooltip(`${e.nombre}${e.zBase != null ? ' · base ' + e.zBase.toFixed(1) + ' m' : ''}`, { sticky: true });
      // Mientras colocas/dibujas (_noSelect) NO interceptes el clic: deja que el mapa
      // reciba el punto (p.ej. poner una pila bajo un puente existente).
      shape.on('click', (ev) => { if (this._noSelect) return; window.L.DomEvent.stop(ev); onPick?.(e.id); });
      this.groups.estructuras.addLayer(shape);
    }
  }
  clearEstructuras() { this.groups.estructuras.clearLayers(); }

  // ── Edición de vértices (GIS) — toggle ────────────────────────────────────────
  // Muestra manejadores arrastrables en los vértices de las capas (polyline/polygon).
  // Llamar de nuevo (o Esc) para terminar. onChange se dispara al soltar un vértice.
  editarVertices(layers, onChange) {
    const L = window.L;
    if (this._vtxEdit) { this._vtxEdit.grp.remove(); document.removeEventListener('keydown', this._vtxEdit.esc); this._vtxEdit = null; return false; }
    if (!layers || !layers.length) return false;
    const grp = L.layerGroup().addTo(this.map);
    const mkHandle = (arr, i, layer) => {
      const icon = L.divIcon({ className: 'koi-sec-vtx', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
      const mk = L.marker(arr[i], { icon, draggable: true, zIndexOffset: 800 });
      mk.on('drag', () => { arr[i] = mk.getLatLng(); layer.setLatLngs(layer._koiRoot); });
      mk.on('dragend', () => { arr[i] = mk.getLatLng(); layer.setLatLngs(layer._koiRoot); onChange?.(); });
      grp.addLayer(mk);
    };
    const walk = (arr, layer) => {
      if (!Array.isArray(arr)) return;
      if (arr.length && arr[0] instanceof L.LatLng) { for (let i = 0; i < arr.length; i++) mkHandle(arr, i, layer); }
      else for (const sub of arr) walk(sub, layer);
    };
    let n = 0;
    for (const layer of layers) { if (!layer?.getLatLngs) continue; layer._koiRoot = layer.getLatLngs(); walk(layer._koiRoot, layer); n++; }
    if (!n) { grp.remove(); return false; }
    const esc = (e) => { if (e.key === 'Escape') this.editarVertices([]); };
    document.addEventListener('keydown', esc);
    this._vtxEdit = { grp, esc };
    return true;
  }
  enEdicion() { return !!this._vtxEdit; }

  // Muestra el dominio, el cauce y la MALLA 2D (aristas de triángulos).
  showMalla2D({ dominio, cauce, mesh } = {}) {
    const L = window.L;
    this.groups.malla2d.clearLayers();
    if (dominio) this.groups.malla2d.addLayer(L.polygon(dominio.map(([lo, la]) => [la, lo]), { color: '#22c55e', weight: 2, fill: false }));
    if (cauce) this.groups.malla2d.addLayer(L.polyline(cauce.map(([lo, la]) => [la, lo]), { color: '#38bdf8', weight: 2 }));
    if (mesh) {
      const seen = new Set(), feats = [];
      const N = mesh.nodes;
      const edge = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (seen.has(k)) return; seen.add(k); feats.push({ c: [[N[a].lon, N[a].lat], [N[b].lon, N[b].lat]], cauce: N[a].enCauce && N[b].enCauce }); };
      for (const t of mesh.tris) { edge(t[0], t[1]); edge(t[1], t[2]); edge(t[2], t[0]); }
      const gj = { type: 'FeatureCollection', features: feats.map((f) => ({ type: 'Feature', properties: { cauce: f.cauce }, geometry: { type: 'LineString', coordinates: f.c } })) };
      // aristas del cauce (malla más fina) resaltadas; la planicie más tenue
      this.groups.malla2d.addLayer(L.geoJSON(gj, { style: (f) => f.properties.cauce ? { color: '#38bdf8', weight: 0.8, opacity: 0.9 } : { color: '#94a3b8', weight: 0.4, opacity: 0.6 } }));
    }
  }
  clearMalla2D() { this.groups.malla2d.clearLayers(); }

  // Mancha de inundación RASTER (desde el eje 1D): pinta el calado sobre la grilla DEM.
  //   grid: {nx,ny,bbox,data}  depth: Float32Array(nx*ny) [m]
  showInundacionRaster(grid, depth, opts = {}) {
    const L = window.L;
    if (this._inun1dLayer) { this.map.removeLayer(this._inun1dLayer); this._inun1dLayer = null; }
    const { nx, ny } = grid, b = grid.bbox;
    const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(nx, ny);
    let hmax = 0; for (const d of depth) if (d > hmax) hmax = d; hmax = hmax || 1;
    for (let i = 0; i < depth.length; i++) {
      const o = i * 4, d = depth[i];
      if (d > 0.02) { const t = Math.min(1, d / hmax); img.data[o] = 20 + (1 - t) * 90; img.data[o + 1] = 120 + (1 - t) * 70; img.data[o + 2] = 200 + t * 40; img.data[o + 3] = 175; }
      else img.data[o + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);
    this._inun1dLayer = L.imageOverlay(cv.toDataURL(), [[b.south, b.west], [b.north, b.east]], { opacity: opts.opacity ?? 0.6 }).addTo(this.map);
    return hmax;
  }
  clearInun1D() { if (this._inun1dLayer) { this.map.removeLayer(this._inun1dLayer); this._inun1dLayer = null; } }

  // Mancha de inundación: rasteriza los triángulos coloreados por profundidad (canvas).
  showInundacion(mesh, h, opts = {}) {
    const L = window.L;
    this.groups.malla2d.clearLayers();
    const N = mesh.nodes;
    let w = 180, s = 90, e = -180, n = -90, hmax = opts.hmax || 0;
    for (const nd of N) { w = Math.min(w, nd.lon); e = Math.max(e, nd.lon); s = Math.min(s, nd.lat); n = Math.max(n, nd.lat); }
    if (!hmax) for (const v of h) hmax = Math.max(hmax, v);
    hmax = hmax || 1;
    const W = 900, H = Math.max(1, Math.round(W * (n - s) / (e - w)));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const X = (lon) => (lon - w) / (e - w) * W;
    const Y = (lat) => (n - lat) / (n - s) * H;
    const col = (d) => { const t = Math.min(1, d / hmax); const r = Math.round(180 - 150 * t), g = Math.round(215 - 120 * t), b = 255; return `rgba(${r},${g},${b},${0.35 + 0.5 * t})`; };
    for (const t of mesh.tris) {
      const hd = (h[t[0]] + h[t[1]] + h[t[2]]) / 3;
      if (hd < (opts.hmin || 0.02)) continue;
      ctx.beginPath();
      ctx.moveTo(X(N[t[0]].lon), Y(N[t[0]].lat)); ctx.lineTo(X(N[t[1]].lon), Y(N[t[1]].lat)); ctx.lineTo(X(N[t[2]].lon), Y(N[t[2]].lat)); ctx.closePath();
      ctx.fillStyle = col(hd); ctx.fill();
    }
    this._inunLayer = L.imageOverlay(cv.toDataURL(), [[s, w], [n, e]], { opacity: opts.opacity ?? 0.75 });
    this.groups.malla2d.addLayer(this._inunLayer);
    if (opts.cauce) this.groups.malla2d.addLayer(L.polyline(opts.cauce.map(([lo, la]) => [la, lo]), { color: '#0369a1', weight: 1.5 }));
    this._leyenda('Calado h [m]', [[0, 'rgba(180,215,255,.75)'], [hmax / 2, 'rgba(105,155,255,.85)'], [hmax, 'rgba(30,95,255,.9)']], (v) => v.toFixed(2));
  }

  // Leyenda flotante del campo 2D (calado o Δz). Un solo control reutilizado.
  _leyenda(titulo, tramos, fmt) {
    const L = window.L;
    if (!this._legendCtl) {
      this._legendCtl = L.control({ position: 'bottomright' });
      this._legendCtl.onAdd = () => { const d = L.DomUtil.create('div', 'koi-leyenda'); this._legendEl = d; return d; };
      this._legendCtl.addTo(this.map);
    }
    if (this._legendEl) {
      this._legendEl.innerHTML = `<div class="kl-t">${titulo}</div>` +
        tramos.map(([v, c]) => `<div class="kl-fila"><span class="kl-c" style="background:${c}"></span>${fmt(v)}</div>`).join('');
      this._legendEl.style.display = '';
    }
  }
  clearLeyenda() { if (this._legendEl) this._legendEl.style.display = 'none'; }

  // Mapa de cambio de lecho Δz del morfodinámico 2D: paleta divergente
  // (rojo = erosión Δz<0, blanco ≈ 0, azul = depósito Δz>0), rasterizado igual
  // que la mancha de inundación.
  showDzMap(mesh, dz, opts = {}) {
    const L = window.L;
    this.groups.malla2d.clearLayers();
    const N = mesh.nodes;
    let w = 180, s = 90, e = -180, n = -90;
    for (const nd of N) { w = Math.min(w, nd.lon); e = Math.max(e, nd.lon); s = Math.min(s, nd.lat); n = Math.max(n, nd.lat); }
    let lim = opts.lim || 0;
    if (!lim) for (const v of dz) lim = Math.max(lim, Math.abs(v));
    lim = lim || 1e-6;
    const W = 900, H = Math.max(1, Math.round(W * (n - s) / (e - w)));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const X = (lon) => (lon - w) / (e - w) * W;
    const Y = (lat) => (n - lat) / (n - s) * H;
    const col = (d) => {
      const t = Math.max(-1, Math.min(1, d / lim));
      if (t < 0) { const k = -t; return `rgba(${Math.round(180 + 60 * k)},${Math.round(90 - 60 * k)},${Math.round(70 - 40 * k)},${0.25 + 0.6 * k})`; } // erosión → rojo
      return `rgba(${Math.round(90 - 60 * t)},${Math.round(120 - 30 * t)},${Math.round(200 + 55 * t)},${0.25 + 0.6 * t})`;                                  // depósito → azul
    };
    const umbral = opts.umbral ?? lim * 0.02;
    for (const t of mesh.tris) {
      const dm = (dz[t[0]] + dz[t[1]] + dz[t[2]]) / 3;
      if (Math.abs(dm) < umbral) continue;
      ctx.beginPath();
      ctx.moveTo(X(N[t[0]].lon), Y(N[t[0]].lat)); ctx.lineTo(X(N[t[1]].lon), Y(N[t[1]].lat)); ctx.lineTo(X(N[t[2]].lon), Y(N[t[2]].lat)); ctx.closePath();
      ctx.fillStyle = col(dm); ctx.fill();
    }
    this._inunLayer = L.imageOverlay(cv.toDataURL(), [[s, w], [n, e]], { opacity: opts.opacity ?? 0.8 });
    this.groups.malla2d.addLayer(this._inunLayer);
    if (opts.cauce) this.groups.malla2d.addLayer(L.polyline(opts.cauce.map(([lo, la]) => [la, lo]), { color: '#0369a1', weight: 1.5 }));
    this._leyenda('Δz lecho [m]', [[-lim, 'rgba(240,30,30,.85)'], [0, 'rgba(255,255,255,.4)'], [lim, 'rgba(30,90,255,.85)']], (v) => (v > 0 ? '+' : '') + v.toFixed(2));
  }

  // ── Red de drenaje / afluentes (como el channel network de QGIS) ────────────
  // Estilo por área de drenaje: más ancho y claro = cauce mayor.
  showRedDrenaje(fc) {
    const L = window.L;
    this.groups.red.clearLayers();
    if (!fc?.features?.length) return;
    let maxA = 0; for (const f of fc.features) maxA = Math.max(maxA, f.properties.areaKm2);
    const layer = L.geoJSON(fc, {
      style: (f) => {
        const a = f.properties.areaKm2, t = Math.min(1, Math.log10(1 + a) / Math.log10(1 + maxA));
        return { color: `hsl(${200 - 60 * t}, 85%, ${45 + 20 * t}%)`, weight: 0.7 + 3.3 * t, opacity: 0.9 };
      },
      onEachFeature: (f, ly) => ly.bindTooltip(`cauce · ${f.properties.areaKm2} km²`, { sticky: true }),
    });
    this.groups.red.addLayer(layer);
    this._redLayer = layer;
  }
  clearRed() { this.groups.red.clearLayers(); this._redLayer = null; }

  // ── Batimetría CAD (footprint arrastrable + overlay ráster + secciones) ─────
  // Dibuja el rectángulo del DEM importado y un marcador de ancla ARRASTRABLE:
  // al soltarlo, `onMove(anchor)` recibe el nuevo centro (colocación scale-true).
  showBati({ footprint, anchor, overlay, secciones } = {}, onMove) {
    const L = window.L;
    this.clearBati();
    const g = this.groups.bati;
    if (overlay?.url && overlay?.bounds) {
      this._batiImg = L.imageOverlay(overlay.url, overlay.bounds, { opacity: overlay.opacity ?? 0.75, interactive: false });
      g.addLayer(this._batiImg);
    }
    if (footprint?.length) {
      this._batiPoly = L.polygon(footprint.map(([lon, lat]) => [lat, lon]),
        { color: '#a855f7', weight: 2, dashArray: '5 4', fillColor: '#a855f7', fillOpacity: overlay ? 0.04 : 0.12 });
      g.addLayer(this._batiPoly);
    }
    for (const s of (secciones || [])) this._addSeccionLayer(s);
    if (anchor) {
      const icon = L.divIcon({ className: 'koi-bati-anchor', html: '<span>✛</span>', iconSize: [26, 26], iconAnchor: [13, 13] });
      this._batiMk = L.marker([anchor.lat, anchor.lon], { icon, draggable: true, zIndexOffset: 500 })
        .bindTooltip('Arrastra para ubicar la batimetría', { direction: 'top' });
      this._batiMk.on('drag', () => { const ll = this._batiMk.getLatLng(); onMove?.({ lon: ll.lng, lat: ll.lat }, true); });
      this._batiMk.on('dragend', () => { const ll = this._batiMk.getLatLng(); onMove?.({ lon: ll.lng, lat: ll.lat }, false); });
      g.addLayer(this._batiMk);
    }
  }
  // Reubica footprint + overlay sin recrear el marcador (durante el arrastre).
  updateBati({ footprint, overlay } = {}) {
    if (footprint && this._batiPoly) this._batiPoly.setLatLngs(footprint.map(([lon, lat]) => [lat, lon]));
    if (overlay?.bounds && this._batiImg) { this._batiImg.setBounds(overlay.bounds); if (overlay.url) this._batiImg.setUrl(overlay.url); }
  }
  _addSeccionLayer(s) {
    const L = window.L;
    const pl = L.polyline(s.pts.map(([lon, lat]) => [lat, lon]), { color: '#22d3ee', weight: 3 })
      .bindTooltip(s.nombre || 'Sección', { sticky: true });
    if (s.onClick) pl.on('click', (e) => { window.L.DomEvent.stop(e); s.onClick(); });
    this.groups.bati.addLayer(pl);
    (this._batiSecs = this._batiSecs || []).push(pl);
  }
  fitBati() {
    const b = this._batiPoly?.getBounds?.();
    if (b?.isValid()) this.map.fitBounds(b, { padding: [60, 60], maxZoom: 18 });
  }
  clearBati() {
    this.groups.bati.clearLayers();
    this._batiImg = this._batiPoly = this._batiMk = null; this._batiSecs = [];
  }

  // ── Puntos de análisis (picking) ──────────────────────────────────────────
  setPickMode(on) {
    this.pickMode = !!on;
    this.el.style.cursor = on ? 'crosshair' : '';
    this.el.classList.toggle('picking', !!on);
    // refleja el estado en el menú y en el botón de la barra izquierda
    document.querySelector('.menu-item[data-action="add-punto"]')?.classList.toggle('on', this.pickMode);
    document.getElementById('cap-pt')?.classList.toggle('active', this.pickMode);
  }

  addPoint(lon, lat, nombre) {
    const L = window.L;
    const id = ++this._seq;
    const p = { id, lon, lat, nombre: nombre || `Punto ${id}` };
    const icon = L.divIcon({ className: 'koi-pt', html: `<span>${id}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] });
    const mk = L.marker([lat, lon], { icon, draggable: true });
    const tip = () => `${p.nombre}<br>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    mk.bindTooltip(tip(), { direction: 'top', offset: [0, -10] });
    this.groups.puntos.addLayer(mk);
    mk.on('click', (e) => { window.L.DomEvent.stop(e); this.selectPoint(id); this.onPointSelect?.(p); });
    mk.on('dragend', () => { const ll = mk.getLatLng(); p.lon = ll.lng; p.lat = ll.lat; p.cuenca = null; mk.setTooltipContent(tip()); this.onPointSelect?.(p); });
    this.points.push(p);
    this.pointLayers.set(id, mk);
    this.selectPoint(id);
    this.onPointAdd?.(p);
    return p;
  }

  // Restaura un punto guardado (con su cuenca) sin disparar la delineación.
  restorePoint(lon, lat, nombre, cuenca) {
    const L = window.L;
    const id = ++this._seq;
    const p = { id, lon, lat, nombre: nombre || `Punto ${id}`, cuenca: cuenca || null };
    const icon = L.divIcon({ className: 'koi-pt', html: `<span>${id}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] });
    const mk = L.marker([lat, lon], { icon, draggable: true });
    const tip = () => `${p.nombre}<br>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    mk.bindTooltip(tip(), { direction: 'top', offset: [0, -10] });
    this.groups.puntos.addLayer(mk);
    mk.on('click', (e) => { window.L.DomEvent.stop(e); this.selectPoint(id); this.onPointSelect?.(p); });
    mk.on('dragend', () => { const ll = mk.getLatLng(); p.lon = ll.lng; p.lat = ll.lat; p.cuenca = null; mk.setTooltipContent(tip()); this.onPointSelect?.(p); });
    this.points.push(p);
    this.pointLayers.set(id, mk);
    return p;
  }

  selectPoint(id) {
    this.selectedPoint = id;
    for (const [pid, mk] of this.pointLayers) {
      mk.getElement()?.classList.toggle('sel', pid === id);
    }
  }

  removePoint(id) {
    const mk = this.pointLayers.get(id);
    if (mk) this.groups.puntos.removeLayer(mk);
    this.pointLayers.delete(id);
    this.points = this.points.filter((p) => p.id !== id);
  }

  getPoints() { return this.points; }

  setVisible(v) {
    this.el.style.display = v ? '' : 'none';
    if (v) setTimeout(() => this.map.invalidateSize(), 60);
  }
}
