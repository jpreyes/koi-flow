// ─────────────────────────────────────────────────────────────────────────────
// capas.js — panel GIS izquierdo de koi-flow (rediseño). Barra de herramientas real
// (agregar punto · etiqueta referencial · importar · guardar/abrir) con ICONOS SVG
// modernos, y árbol de capas: Proyecto/tramos, Puntos, Cuencas, Red de drenaje,
// Estaciones DGA, Referencias (río/ciudad/camino) e Importados. Cada capa se puede
// mostrar/ocultar (casilla) y sus entidades ir/borrar. Estilo cercano a wind-shm.
// ─────────────────────────────────────────────────────────────────────────────
import { leerKMLoKMZ } from './kml.js?v=2';
import { listProjects, saveProject, removeProject, setOpen, newProjectId } from '../proyectos.js?v=2';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ── Set de iconos SVG (stroke currentColor) ──────────────────────────────────
const P = {
  project: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  point: '<path d="M12 21s6-5.6 6-10a6 6 0 10-12 0c0 4.4 6 10 6 10z"/><circle cx="12" cy="11" r="2"/>',
  basin: '<path d="M7 4h10l4 8-4 8H7l-4-8z"/>',
  wave: '<path d="M3 8c3-3 5 3 8 0s5-3 8 0M3 15c3-3 5 3 8 0s5-3 8 0"/>',
  station: '<path d="M12 3s6 6 6 10a6 6 0 01-12 0c0-4 6-10 6-10z"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  label: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-6.2-6.2a2 2 0 010-2.8l7.2-7.2 9 1z"/><circle cx="15.5" cy="8.5" r="1.5"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>',
  open: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2"/><path d="M3 9h18l-2 10H5z"/>',
  locate: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  mountain: '<path d="M3 19l6-10 4 6 2-3 6 7z"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  rio: '<path d="M3 8c3-3 5 3 8 0s5-3 8 0M3 15c3-3 5 3 8 0s5-3 8 0"/>',
  ciudad: '<path d="M4 21V8l5-2v15M13 21V3l6 2v16M3 21h18"/>',
  camino: '<path d="M8 21L10 3M16 21L14 3M12 6v2M12 11v2M12 16v2"/>',
  punto: '<circle cx="12" cy="12" r="3.5"/>',
};
const ico = (name, size = 16) => `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;

export class Capas {
  constructor(container, { map, project, onSelectTramo, onRelieve, hydro } = {}) {
    this.cont = container; this.map = map; this.project = project;
    this.onSelectTramo = onSelectTramo; this.onRelieve = onRelieve; this.hydro = hydro;
    this.imports = [];   // [{id, name}]
    this.labels = [];    // [{id, name, tipo, lon, lat}]
    this._build();
  }

  _build() {
    this.cont.innerHTML = '';

    // Barra de proyecto (nombre actual + menú: nuevo / demo / abrir guardado / borrar)
    const pbar = el('div', 'cap-proj');
    pbar.innerHTML = `
      <span class="cap-ico">${ico('project')}</span>
      <span class="cap-proj-name" title="Proyecto actual">${this.project?.name || 'Proyecto'}</span>
      <button class="cap-proj-toggle" id="cap-proj-toggle" title="Proyectos">▾</button>`;
    this.cont.appendChild(pbar);
    const pmenu = el('div', 'cap-proj-menu'); pmenu.id = 'cap-proj-menu'; pmenu.hidden = true;
    this.cont.appendChild(pmenu);
    pbar.querySelector('#cap-proj-toggle').addEventListener('click', () => { pmenu.hidden = !pmenu.hidden; if (!pmenu.hidden) this._renderProyectos(pmenu); });

    const tools = el('div', 'cap-tools');
    tools.innerHTML = `
      <div class="cap-toolbar">
        <button class="cap-tool" id="cap-pt" title="Agregar punto de análisis (clic en el mapa)">${ico('point')}<span>Punto</span></button>
        <button class="cap-tool" id="cap-lbl" title="Agregar etiqueta referencial (río / ciudad / camino)">${ico('label')}<span>Etiqueta</span></button>
        <button class="cap-tool" id="cap-import" title="Importar KMZ/KML">${ico('folder')}<span>Importar</span></button>
      </div>
      <div class="cap-toolbar">
        <select id="cap-lbl-tipo" class="cap-sel" title="Tipo de etiqueta a colocar">
          <option value="rio">≈ Río</option><option value="ciudad">◉ Ciudad</option><option value="camino">▤ Camino</option><option value="punto">• Punto</option>
        </select>
        <button class="cap-tool sm" id="cap-save" title="Guardar proyecto">${ico('save')}<span>Guardar</span></button>
        <button class="cap-tool sm" id="cap-open" title="Abrir proyecto">${ico('open')}<span>Abrir</span></button>
      </div>
      <input type="file" id="cap-file" accept=".kmz,.kml" hidden>
      <input type="file" id="cap-proj" accept=".json,.koi.json,.koi" hidden>`;
    this.cont.appendChild(tools);
    this.tree = el('div', 'cap-tree');
    this.cont.appendChild(this.tree);

    tools.querySelector('#cap-pt').addEventListener('click', () => this._agregarPunto());
    tools.querySelector('#cap-lbl').addEventListener('click', () => this._colocarEtiqueta());
    tools.querySelector('#cap-import').addEventListener('click', () => tools.querySelector('#cap-file').click());
    tools.querySelector('#cap-file').addEventListener('change', (e) => this._importar(e.target.files));
    tools.querySelector('#cap-save').addEventListener('click', () => this.guardarProyecto());
    tools.querySelector('#cap-open').addEventListener('click', () => tools.querySelector('#cap-proj').click());
    tools.querySelector('#cap-proj').addEventListener('change', (e) => this._abrir(e.target.files[0]));

    this.render();
  }

  // nodo con casilla + etiqueta (+ hijos opcionales colapsables)
  _grupo(layerKey, icon, label, children) {
    const node = el('div', 'cap-grp');
    const head = el('div', 'cap-node');
    const hasKids = children && children.length;
    head.innerHTML = `${hasKids ? '<span class="cap-caret">▾</span>' : '<span class="cap-caret empty"></span>'}
      <label><input type="checkbox" checked data-layer="${layerKey}"> <span class="cap-ico">${icon}</span> ${label}</label>`;
    node.appendChild(head);
    head.querySelector('input').addEventListener('change', (e) => this.map.setLayerVisible(layerKey, e.target.checked));
    if (hasKids) {
      const ul = el('ul', 'cap-children');
      for (const c of children) ul.appendChild(c);
      node.appendChild(ul);
      head.querySelector('.cap-caret').addEventListener('click', () => { ul.style.display = ul.style.display === 'none' ? '' : 'none'; });
    }
    return node;
  }

  render() {
    this.tree.innerHTML = '';
    // Proyecto → tramos (clic = seleccionar, relieve, borrar)
    const tramos = (this.project?.tramos || []).map((t) => {
      const has = !!(t.dem || t.demGrid) && !t.relieveOff;
      const li = el('li', 'cap-leaf');
      li.dataset.name = t.name;
      const editando = this._editTramo === t.name;
      li.innerHTML = `<span class="cap-ico">${ico('wave')}</span><span class="cap-lbl">${t.name}</span>
        <span class="cap-act cap-relieve${has ? ' on' : ''}" data-rel="1" title="${has ? 'Relieve activo — clic para desactivar' : 'Activar/descargar relieve'}">${ico('mountain')}</span>
        <span class="cap-act${editando ? ' on' : ''}" data-edittramo="${t.name}" title="Editar vértices (arrastra · Esc termina)">${ico('pencil')}</span>
        <span class="cap-act" data-deltramo="${t.name}" title="Quitar tramo">${ico('trash')}</span>
        <span class="cap-meta">${t.npts}p</span>`;
      li.addEventListener('click', (e) => {
        if (e.target.closest('[data-rel]')) { e.stopPropagation(); this.onRelieve?.(t); }
        else if (e.target.closest('[data-edittramo]')) { e.stopPropagation(); this._editarTramo(t.name); }
        else if (e.target.closest('[data-deltramo]')) { e.stopPropagation(); this._quitarTramo(t.name); }
        else { this._selTramo(t.name); this.onSelectTramo?.(t); }
      });
      return li;
    });
    this.tree.appendChild(this._grupo('tramos', ico('project'), this.project?.name || 'Proyecto', tramos));

    // Puntos de análisis (lista, ir/borrar)
    const puntos = (this.map?.getPoints?.() || []).map((p) => {
      const li = el('li', 'cap-leaf');
      li.title = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
      li.innerHTML = `<span class="cap-ico">${ico('point')}</span><span class="cap-lbl">${p.nombre}</span>
        <span class="cap-act" data-gopt="${p.id}" title="Ir">${ico('locate')}</span><span class="cap-act" data-delpt="${p.id}" title="Borrar punto">${ico('trash')}</span>
        <span class="cap-meta">${p.cuenca ? p.cuenca.morfometria.A + 'km²' : p.lat.toFixed(3) + ',' + p.lon.toFixed(3)}</span>`;
      li.querySelector('[data-gopt]').addEventListener('click', () => this.hydro?.irAPunto?.(p.id));
      li.querySelector('[data-delpt]').addEventListener('click', () => { this.hydro?.borrarPunto?.(p.id); this.render(); });
      return li;
    });
    this.tree.appendChild(this._grupo('puntos', ico('point'), `Puntos de análisis (${puntos.length})`, puntos));

    // Cuencas delineadas (puntos con cuenca)
    const cuencas = (this.map?.getPoints?.() || []).filter((p) => p.cuenca).map((p) => {
      const li = el('li', 'cap-leaf');
      li.innerHTML = `<span class="cap-ico">${ico('basin')}</span><span class="cap-lbl">${p.nombre}</span>
        <span class="cap-act" data-gocu="${p.id}" title="Encuadrar">${ico('locate')}</span><span class="cap-act" data-delcu="${p.id}" title="Borrar cuenca">${ico('trash')}</span>
        <span class="cap-meta">${p.cuenca.morfometria.A}km²</span>`;
      li.querySelector('[data-gocu]').addEventListener('click', () => this.map.showCuenca(p.id, p.cuenca.polygonSuave || p.cuenca.polygon));
      li.querySelector('[data-delcu]').addEventListener('click', () => { this.map.clearCuenca(p.id); p.cuenca = null; this.render(); });
      return li;
    });
    this.tree.appendChild(this._grupo('cuencas', ico('basin'), `Cuencas delineadas (${cuencas.length})`, cuencas));
    this.tree.appendChild(this._grupo('red', ico('wave'), 'Red de drenaje (afluentes)'));
    this.tree.appendChild(this._grupo('estaciones', ico('station'), 'Estaciones DGA'));

    // Referencias (etiquetas río/ciudad/camino)
    const labels = this.labels.map((lb) => {
      const li = el('li', 'cap-leaf');
      li.title = `${lb.tipo} · ${lb.lat.toFixed(5)}, ${lb.lon.toFixed(5)}`;
      li.innerHTML = `<span class="cap-ico">${ico(lb.tipo)}</span><span class="cap-lbl">${lb.name}</span>
        <span class="cap-act" data-golbl="${lb.id}" title="Centrar">${ico('locate')}</span><span class="cap-act" data-dellbl="${lb.id}" title="Borrar">${ico('trash')}</span>
        <span class="cap-meta">${lb.tipo}</span>`;
      li.querySelector('[data-golbl]').addEventListener('click', () => this.map.zoomLabel(lb.id));
      li.querySelector('[data-dellbl]').addEventListener('click', () => { this.map.removeLabel(lb.id); this.labels = this.labels.filter((x) => x.id !== lb.id); this.render(); });
      return li;
    });
    this.tree.appendChild(this._grupo('labels', ico('label'), `Referencias (${labels.length})`, labels));

    // GIS creado en Hidráulica (DEM/eje/dominio/malla/estructuras) — borrable desde aquí
    const bati = window.__koi?.bati, estrP = window.__koi?.estr;
    const gis = [];
    if (bati?.demM) gis.push({ ic: 'mountain', label: 'DEM colocado', meta: `${bati.demM.nx}×${bati.demM.ny}`, zoom: () => bati.map?.fitBati?.(), del: () => bati.borrarDEM() });
    if (bati?.fused) gis.push({ ic: 'mountain', label: 'DEM fusionado', meta: '', del: () => { bati.fused = null; this.render(); } });
    if (bati?.eje) gis.push({ ic: 'wave', label: 'Eje del cauce', meta: `${bati.eje.length} pt`, del: () => bati.borrarEje() });
    if (bati?.dominio) gis.push({ ic: 'basin', label: 'Dominio 2D', meta: `${bati.dominio.length} pt`, del: () => bati.borrarDominio() });
    if (bati?.mesh2d) gis.push({ ic: 'basin', label: 'Malla / sim 2D', meta: `${bati.mesh2d.meta.nNodos} nodos`, del: () => bati.borrarMalla() });
    const gisLeaves = gis.map((g) => {
      const li = el('li', 'cap-leaf');
      li.innerHTML = `<span class="cap-ico">${ico(g.ic)}</span><span class="cap-lbl">${g.label}</span>${g.zoom ? `<span class="cap-act" data-go="1" title="Encuadrar">${ico('locate')}</span>` : ''}<span class="cap-act" data-del="1" title="Borrar">${ico('trash')}</span><span class="cap-meta">${g.meta || ''}</span>`;
      if (g.zoom) li.querySelector('[data-go]').addEventListener('click', g.zoom);
      li.querySelector('[data-del]').addEventListener('click', () => g.del());
      return li;
    });
    for (const e of (estrP?.estructuras || [])) {
      const li = el('li', 'cap-leaf');
      li.innerHTML = `<span class="cap-ico">${ico('project')}</span><span class="cap-lbl">${e.nombre}</span>
        <span class="cap-act" data-go="1" title="Centrar">${ico('locate')}</span><span class="cap-act" data-del="1" title="Borrar">${ico('trash')}</span><span class="cap-meta">${e.solido ? 'sólida' : 'pasa'}</span>`;
      li.querySelector('[data-go]').addEventListener('click', () => { if (e.center) this.map.map.panTo([e.center[1], e.center[0]]); });
      li.querySelector('[data-del]').addEventListener('click', () => { estrP.estructuras = estrP.estructuras.filter((x) => x.id !== e.id); estrP._render?.(); estrP._draw?.(); this.render(); });
      gisLeaves.push(li);
    }
    if (gisLeaves.length) {
      const grpG = el('div', 'cap-grp');
      grpG.appendChild(el('div', 'cap-node', `<span class="cap-caret empty"></span><span class="cap-ico">${ico('project')}</span> GIS creado <span class="cap-meta">${gisLeaves.length}</span>`));
      const ulG = el('ul', 'cap-children'); for (const li of gisLeaves) ulG.appendChild(li); grpG.appendChild(ulG);
      this.tree.appendChild(grpG);
    }

    // Importados
    const grp = el('div', 'cap-grp');
    grp.appendChild(el('div', 'cap-node', `<span class="cap-caret empty"></span><span class="cap-ico">${ico('folder')}</span> Importados <span class="cap-meta">${this.imports.length}</span>`));
    const ul = el('ul', 'cap-children'); grp.appendChild(ul);
    for (const im of this.imports) {
      const li = el('li', 'cap-leaf imp');
      const edI = this._editImp === im.id;
      li.innerHTML = `<label><input type="checkbox" checked data-imp="${im.id}"> <span class="cap-ico">${ico('file')}</span>${im.name}</label>
        <span class="cap-act" data-zoom="${im.id}" title="Centrar">${ico('locate')}</span>
        <span class="cap-act${edI ? ' on' : ''}" data-editimp="${im.id}" title="Editar vértices (arrastra · Esc termina)">${ico('pencil')}</span>
        <span class="cap-act" data-del="${im.id}" title="Quitar">${ico('trash')}</span>`;
      li.querySelector('input').addEventListener('change', (e) => this.map.toggleImport(im.id, e.target.checked));
      li.querySelector('[data-zoom]').addEventListener('click', () => this.map.zoomImport(im.id));
      li.querySelector('[data-editimp]').addEventListener('click', () => this._editarImport(im.id));
      li.querySelector('[data-del]').addEventListener('click', () => { if (this._editImp === im.id) { this.map.editarVertices([]); this._editImp = null; } this.map.removeImport(im.id); this.imports = this.imports.filter((x) => x.id !== im.id); this.render(); });
      ul.appendChild(li);
    }
    this.tree.appendChild(grp);
  }

  // ── Barra de herramientas ────────────────────────────────────────────────────
  _agregarPunto() {
    const on = !this.map.pickMode;
    this.map.setPickMode(on);
    document.getElementById('btn-pick')?.classList.toggle('active', on);
    this.cont.querySelector('#cap-pt')?.classList.toggle('active', on);
  }
  _colocarEtiqueta() {
    const tipo = this.cont.querySelector('#cap-lbl-tipo')?.value || 'rio';
    this.map.pickOnce((lon, lat) => {
      const name = prompt(`Nombre (${tipo}):`, '');
      if (name == null) return;
      const id = this.map.addLabel({ lon, lat, name: name || tipo, tipo });
      this.labels.push({ id, name: name || tipo, tipo, lon, lat });
      this.render();
    }, `Clic para colocar la etiqueta (${tipo})`);
  }

  // ── Gestión de proyectos ─────────────────────────────────────────────────────
  _renderProyectos(menu) {
    const saved = listProjects().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    menu.innerHTML = `
      <button class="cap-proj-item" id="pm-new">${ico('file')} Nuevo proyecto (vacío)</button>
      <button class="cap-proj-item" id="pm-demo">${ico('basin')} Cargar demo (Tarapacá)</button>
      ${saved.length ? '<div class="cap-proj-hd">Guardados</div>' : '<div class="cap-proj-hd">Sin proyectos guardados</div>'}
      ${saved.map((p) => `<div class="cap-proj-row">
        <button class="cap-proj-open" data-open="${p.id}" title="Abrir">${ico('open')}<span>${p.name}</span></button>
        <span class="cap-act" data-delproj="${p.id}" title="Borrar proyecto">${ico('trash')}</span></div>`).join('')}`;
    menu.querySelector('#pm-new').addEventListener('click', () => this._nuevoProyecto());
    menu.querySelector('#pm-demo').addEventListener('click', () => this._abrirProyecto('demo'));
    menu.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => this._abrirProyecto(b.dataset.open)));
    menu.querySelectorAll('[data-delproj]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.delproj;
      if (!confirm('¿Borrar el proyecto guardado? Esta acción no se puede deshacer.')) return;
      removeProject(id); this._renderProyectos(menu);
    }));
  }
  _nuevoProyecto() {
    if (!confirm('¿Crear un proyecto nuevo (vacío)? Se cerrará el actual (guarda antes si hace falta).')) return;
    setOpen(null); location.reload();
  }
  _abrirProyecto(id) { setOpen(id); location.reload(); }

  // Editar vértices de un tramo del proyecto (arrastre). Sincroniza la geometría.
  _editarTramo(name) {
    // termina cualquier edición en curso
    if (this._editTramo || this._editImp) { this.map.editarVertices([]); const prev = this._editTramo; this._editTramo = this._editImp = null; if (prev === name) { this.render(); return; } }
    const ly = this.map.layers?.get(name), t = this.project?.tramos.find((x) => x.name === name);
    if (!ly) { alert('Este tramo no tiene geometría editable en el mapa.'); return; }
    const on = this.map.editarVertices([ly], () => {
      const lls = ly.getLatLngs(), flat = Array.isArray(lls[0]) ? lls[0] : lls;
      if (t) { t.feature.geometry.coordinates = flat.map((p) => [p.lng, p.lat]); t.npts = flat.length; }
    });
    this._editTramo = on ? name : null; this.render();
  }
  // Editar vértices de una capa importada (KMZ/KML).
  _editarImport(id) {
    if (this._editTramo || this._editImp) { this.map.editarVertices([]); const prev = this._editImp; this._editTramo = this._editImp = null; if (prev === id) { this.render(); return; } }
    const it = this.map.importLayers.get(id);
    const subs = it ? it.group.getLayers() : [];
    const on = this.map.editarVertices(subs);
    if (!on) alert('Esta capa no tiene líneas/polígonos editables (¿solo puntos?).');
    this._editImp = on ? id : null; this.render();
  }

  _quitarTramo(name) {
    if (!confirm(`¿Quitar el tramo "${name}" del proyecto?`)) return;
    this.map.removeTramo?.(name);
    if (this.project?.tramos) this.project.tramos = this.project.tramos.filter((t) => t.name !== name);
    this.render();
  }

  _selTramo(name) {
    for (const li of this.tree.querySelectorAll('.cap-leaf')) li.classList.toggle('sel', li.dataset.name === name);
  }
  selectTramo(name) { this._selTramo(name); }

  // Marca el botón de relieve de un tramo como "cargando".
  setRelieveCargando(name, on) {
    const li = [...this.tree.querySelectorAll('.cap-leaf')].find((x) => x.dataset.name === name);
    const b = li?.querySelector('.cap-relieve');
    if (b) b.classList.toggle('loading', on);
  }

  async _importar(files) {
    for (const f of files || []) {
      try {
        const gj = await leerKMLoKMZ(f);
        const id = this.map.addImport(f.name, gj);
        this.imports.push({ id, name: f.name });
        this.map.zoomImport(id);
      } catch (e) { alert('No se pudo importar ' + f.name + ': ' + e.message); }
    }
    this.render();
  }

  // ── Guardar / abrir proyecto (localStorage + archivo) ───────────────────────
  _estadoActual() {
    const puntos = (this.map.getPoints() || []).map((p) => ({
      lon: p.lon, lat: p.lat, nombre: p.nombre,
      cuenca: p.cuenca ? { polygon: p.cuenca.polygon, polygonSuave: p.cuenca.polygonSuave || null, morfometria: p.cuenca.morfometria } : null,
    }));
    const importados = [...this.map.importLayers.entries()].map(([id, it]) => {
      let gj = null; try { gj = it.group.toGeoJSON(); } catch {}
      return { name: it.name, geojson: gj };
    });
    const etiquetas = this.labels.map(({ name, tipo, lon, lat }) => ({ name, tipo, lon, lat }));
    const tramos = (this.project?.tramos || []).map((t) => ({ name: t.name, feature: t.feature, dem: t.dem || null }));
    return { puntos, importados, etiquetas, tramos };
  }

  guardarProyecto() {
    const cur = this.project?.name;
    const name = prompt('Nombre del proyecto:', (cur && cur !== 'Proyecto nuevo') ? cur.replace(/^Demo — /, '') : '');
    if (name == null) return;
    let id = this.project?.id;
    if (!id || id === 'demo' || id === 'nuevo') id = newProjectId();
    const st = this._estadoActual();
    const state = { id, name: name || id, ...st };
    saveProject(state); setOpen(id);
    if (this.project) { this.project.id = id; this.project.name = name || id; }
    const nm = this.cont.querySelector('.cap-proj-name'); if (nm) nm.textContent = name || id;
    // descarga de respaldo (.json)
    const proj = { app: 'koi-flow', version: 1, fecha: new Date().toISOString(), proyecto: id, name: name || id, ...st };
    const blob = new Blob([JSON.stringify(proj, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${id}_koi.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    alert(`Proyecto guardado: ${name || id}`);
  }

  // Aplica un estado (puntos/cuencas/importados/etiquetas) sobre el mapa. Usado al
  // abrir un archivo y al cargar un proyecto guardado en el arranque.
  aplicarEstado(data) {
    if (!data) return;
    for (const im of data.importados || []) { if (im.geojson) { const id = this.map.addImport(im.name, im.geojson); this.imports.push({ id, name: im.name }); } }
    for (const p of data.puntos || []) {
      const pt = this.map.restorePoint(p.lon, p.lat, p.nombre, p.cuenca);
      if (p.cuenca) this.map.showCuenca(pt.id, p.cuenca.polygonSuave || p.cuenca.polygon);
    }
    for (const lb of data.etiquetas || []) { const id = this.map.addLabel(lb); this.labels.push({ id, ...lb }); }
    this.render();
  }

  async _abrir(file) {
    if (!file) return;
    let data; try { data = JSON.parse(await file.text()); } catch { return alert('Archivo de proyecto inválido.'); }
    if (data.app !== 'koi-flow') return alert('No es un proyecto koi-flow.');
    this.aplicarEstado(data);
    alert(`Proyecto cargado: ${data.puntos?.length || 0} puntos, ${data.importados?.length || 0} capas, ${data.etiquetas?.length || 0} referencias.`);
  }
}
