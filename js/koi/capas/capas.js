// ─────────────────────────────────────────────────────────────────────────────
// capas.js — panel GIS izquierdo de koi-flow (rediseño). Barra de herramientas real
// (agregar punto · etiqueta referencial · importar · guardar/abrir) con ICONOS SVG
// modernos, y árbol de capas: Proyecto/tramos, Puntos, Cuencas, Red de drenaje,
// Estaciones DGA, Referencias (río/ciudad/camino) e Importados. Cada capa se puede
// mostrar/ocultar (casilla) y sus entidades ir/borrar. Estilo cercano a wind-shm.
// ─────────────────────────────────────────────────────────────────────────────
import { leerKMLoKMZ } from './kml.js?v=13';
import { toast } from '../ui/toast.js?v=13';
import { bus } from '../ui/bus.js?v=13';
import { listProjects, saveProject, removeProject, setOpen, newProjectId } from '../proyectos.js?v=13';
import { escribirKoi, leerKoi } from '../proyecto/koi_file.js?v=13';
import { infoTipo, getActivo } from '../ui/seleccion.js?v=13';
import { ensurePointContext, migrateProjectPoints, pointImportLite, pointRefLite, serializePoint } from '../punto_contexto.js?v=13';

// Módulos de koi.reg → acción de menú (para reabrir el HUD) y etiqueta del chip.
const REG_INFO = {
  tormenta: ['tormenta', 'Tormenta de diseño'],
  convolucion: ['convolucion', 'Hidrograma de crecida (HU)'],
  routing: ['routing', 'Tránsito en cauce'],
  red: ['red', 'Red de cuencas'],
  continuo: ['continuo', 'Continua + deshielo'],
  calibracion: ['calibracion', 'Calibración'],
  modclark: ['modclark', 'ModClark'],
  degradacion: ['degradacion', 'Degradación'],
  morfo1d: ['morfo1d', 'Lecho móvil 1D'],
  alcantarilla: ['alcantarilla', 'Alcantarilla HDS-5'],
  puentePresion: ['puente-presion', 'Puente presión/vertedero'],
  enrocado: ['enrocado', 'Enrocado / defensas'],
  verificaciones: ['verificaciones', 'Verificaciones'],
  sismo: ['sismo-estribo', 'Sísmica de estribos'],
  breach: ['breach', 'Rotura de presa / relaves'],
};

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const descargarJSON = (name, data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

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
    // Refresca los chips de "Resultados calculados" cuando un motor registra algo.
    bus.on('reg:actualizado', () => { clearTimeout(this._regT); this._regT = setTimeout(() => this.render(), 60); });
    // Resalta en el árbol el objeto activo (mismo objeto del indicador "Trabajando en:").
    bus.on('seleccion:cambio', (o) => this._marcarActivo(o));
  }

  // Marca la hoja del árbol que corresponde al objeto activo (por id).
  _marcarActivo(o) {
    if (!this.tree) return;
    const id = o?.id != null ? String(o.id) : null;
    this.tree.querySelectorAll('.cap-leaf.cap-activo').forEach((li) => li.classList.remove('cap-activo'));
    if (!id) return;
    this.tree.querySelectorAll('.cap-leaf').forEach((li) => {
      if (li.dataset.objId === id) { li.classList.add('cap-activo'); li.style.setProperty('--obj-color', infoTipo(li.dataset.objTipo).color); }
    });
  }

  _build() {
    this.cont.innerHTML = '';

    // Barra de proyecto (nombre actual + menú: nuevo / demo / abrir guardado / borrar)
    const pbar = el('div', 'cap-proj');
    pbar.innerHTML = `
      <span class="cap-ico">${ico('project')}</span>
      <span class="cap-proj-name" title="Proyecto actual">${this.project?.name || 'Proyecto'}</span>
      <span class="cap-act" id="cap-proj-edit" title="Renombrar / guardar proyecto">${ico('pencil')}</span>
      <span class="cap-act" id="cap-proj-del" title="Borrar proyecto">${ico('trash')}</span>
      <button class="cap-proj-toggle" id="cap-proj-toggle" title="Proyectos">▾</button>`;
    this.cont.appendChild(pbar);
    const pmenu = el('div', 'cap-proj-menu'); pmenu.id = 'cap-proj-menu'; pmenu.hidden = true;
    this.cont.appendChild(pmenu);
    pbar.querySelector('#cap-proj-toggle').addEventListener('click', () => { pmenu.hidden = !pmenu.hidden; if (!pmenu.hidden) this._renderProyectos(pmenu); });
    pbar.querySelector('#cap-proj-edit').addEventListener('click', () => this._renombrarProyecto());
    pbar.querySelector('#cap-proj-del').addEventListener('click', () => this._borrarProyectoActual());

    const tools = el('div', 'cap-tools');
    tools.innerHTML = `
      <div class="cap-toolbar">
        <button class="cap-tool" id="cap-pt" title="Agregar punto de análisis (clic en el mapa)">${ico('point')}<span>Punto</span></button>
        <button class="cap-tool" id="cap-tramo" title="Dibujar un tramo/cauce (clic = vértices · doble-clic / clic-derecho / Esc = terminar)">${ico('wave')}<span>Tramo</span></button>
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
    tools.querySelector('#cap-tramo').addEventListener('click', () => this._dibujarTramo());
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

  _puntoActivo() {
    const pts = this.map?.getPoints?.() || [];
    const a = getActivo();
    if (a && (a.tipo === 'punto' || a.tipo === 'cuenca')) {
      const p = pts.find((x) => x.id === a.id);
      if (p) return p;
    }
    return pts.length === 1 ? pts[0] : null;
  }

  _puntosPorTramo() {
    const m = new Map();
    for (const p of this.map?.getPoints?.() || []) {
      const k = p.tramo || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return m;
  }

  _assetLeaf(icon, label, meta, onClick, cls = '') {
    const li = el('li', `cap-leaf cap-sub ${cls}`.trim());
    li.innerHTML = `<span class="cap-ico">${icon}</span><span class="cap-lbl">${label}</span><span class="cap-meta">${meta || ''}</span>`;
    if (onClick) li.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return li;
  }

  _folderLeaf(icon, label, meta, children = [], cls = '') {
    const li = el('li', `cap-leaf cap-folder ${cls}`.trim());
    li.innerHTML = `<span class="cap-caret ${children.length ? '' : 'empty'}">${children.length ? '▾' : ''}</span><span class="cap-ico">${icon}</span><span class="cap-lbl">${label}</span><span class="cap-meta">${meta || ''}</span>`;
    if (children.length) {
      const ul = el('ul', 'cap-children');
      for (const c of children) ul.appendChild(c);
      li.appendChild(ul);
      li.querySelector('.cap-caret').addEventListener('click', (e) => { e.stopPropagation(); ul.style.display = ul.style.display === 'none' ? '' : 'none'; });
    }
    return li;
  }

  _pointAssets(p) {
    const c = ensurePointContext(p);
    const selectPoint = () => this.hydro?.irAPunto?.(p.id);
    const openTool = (accion) => { selectPoint(); bus.emit('abrir:analisis', accion); };
    const out = [];
    if (p.cuenca) {
      out.push(this._assetLeaf(ico('basin'), 'Cuenca', `${p.cuenca.morfometria?.A ?? '?'}km²`, () => this.map.showCuenca(p.id, p.cuenca.polygonSuave || p.cuenca.polygon)));
    }
    if (c.red?.fc) {
      out.push(this._assetLeaf(ico('wave'), 'Red de drenaje', `${c.red.meta?.nLineas ?? c.red.fc.features?.length ?? 0} cauces`, () => this.map.showRedDrenaje(c.red.fc)));
    }
    const nEst = c.estaciones?.cercanas?.length || 0;
    if (nEst || c.estaciones?.seleccion?.ctrl || c.estaciones?.seleccion?.pluvio) {
      const sel = [c.estaciones.seleccion?.ctrl?.nombre, c.estaciones.seleccion?.pluvio?.nombre].filter(Boolean).length;
      out.push(this._assetLeaf(ico('station'), 'Estaciones DGA', `${nEst} cerca${sel ? ` - ${sel} sel.` : ''}`, () => this.map.showStations(c.estaciones.cercanas || [])));
    }
    if (c.referencias?.length) out.push(this._assetLeaf(ico('label'), 'Referencias', String(c.referencias.length)));
    if (c.importados?.length) out.push(this._assetLeaf(ico('folder'), 'Importados', String(c.importados.length)));
    const nRes = Object.keys(c.resultados || {}).length;
    if (nRes) out.push(this._assetLeaf(ico('open'), 'Resultados', String(nRes)));
    if (!p.cuenca) out.push(this._assetLeaf(ico('basin'), 'Cuenca delineada', 'pendiente', () => openTool('cuenca-delinear'), 'cap-pending'));
    if (!c.red?.fc) out.push(this._assetLeaf(ico('wave'), 'Red de drenaje', 'pendiente', () => openTool('afluentes-punto'), 'cap-pending'));
    if (!nEst && !c.estaciones?.seleccion?.ctrl && !c.estaciones?.seleccion?.pluvio) out.push(this._assetLeaf(ico('station'), 'Estaciones DGA', 'sin buscar', () => openTool('estaciones-dga'), 'cap-pending'));
    if (!c.referencias?.length) out.push(this._assetLeaf(ico('label'), 'Referencias', '0', null, 'cap-pending'));
    if (!c.importados?.length) out.push(this._assetLeaf(ico('folder'), 'Importados', '0', null, 'cap-pending'));
    if (!nRes) out.push(this._assetLeaf(ico('open'), 'Resultados', '0', null, 'cap-pending'));
    out.push(this._assetLeaf(ico('save'), 'Exportar punto', 'JSON', () => descargarJSON(`punto_${(p.nombre || p.id).replace(/[^\w.-]+/g, '_')}.json`, serializePoint(p))));
    return out;
  }

  _pointLeaf(p) {
    const li = el('li', 'cap-leaf cap-point-node');
    li.title = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    li.dataset.objTipo = 'punto'; li.dataset.objId = p.id;
    li.innerHTML = `<span class="cap-ico" style="color:${infoTipo('punto').color}">${ico('point')}</span><span class="cap-lbl">${p.nombre}</span>
      <span class="cap-act" data-gopt="${p.id}" title="Ir">${ico('locate')}</span><span class="cap-act" data-delpt="${p.id}" title="Borrar punto">${ico('trash')}</span>
      <span class="cap-meta">${p.cuenca ? p.cuenca.morfometria.A + 'km²' : p.lat.toFixed(3) + ',' + p.lon.toFixed(3)}</span>`;
    li.querySelector('[data-gopt]').addEventListener('click', (e) => { e.stopPropagation(); this.hydro?.irAPunto?.(p.id); });
    li.querySelector('[data-delpt]').addEventListener('click', (e) => { e.stopPropagation(); this.hydro?.borrarPunto?.(p.id); this.render(); });
    li.addEventListener('click', (e) => { e.stopPropagation(); this.hydro?.irAPunto?.(p.id); });
    const assets = this._pointAssets(p);
    if (assets.length) {
      const ul = el('ul', 'cap-children cap-point-assets');
      for (const a of assets) ul.appendChild(a);
      li.appendChild(ul);
    }
    return li;
  }

  render() {
    this.tree.innerHTML = '';
    const puntosPorTramo = this._puntosPorTramo();
    // Proyecto → tramos (clic = seleccionar, relieve, borrar)
    const tramos = (this.project?.tramos || []).map((t) => {
      const has = !!(t.dem || t.demGrid) && !t.relieveOff;
      const li = el('li', 'cap-leaf');
      li.dataset.name = t.name;
      li.dataset.objTipo = 'tramo'; li.dataset.objId = t.name;
      const editando = this._editTramo === t.name;
      li.innerHTML = `<span class="cap-ico" style="color:${infoTipo('tramo').color}">${ico('wave')}</span><span class="cap-lbl">${t.name}</span>
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
      const pts = puntosPorTramo.get(t.name) || [];
      const pointLeaves = pts.map((p) => this._pointLeaf(p));
      li.classList.add('cap-has-children');
      const ul = el('ul', 'cap-children cap-tramo-puntos');
      ul.appendChild(this._folderLeaf(ico('point'), 'Puntos de análisis', String(pointLeaves.length), pointLeaves, 'cap-points-folder'));
      li.appendChild(ul);
      return li;
    });
    const tramosChildren = tramos.length ? tramos : [this._folderLeaf(ico('point'), 'Puntos de análisis', '0', [], 'cap-points-folder')];
    const tramosFolder = [this._folderLeaf(ico('wave'), 'Tramos', String(tramos.length), tramosChildren, 'cap-tramos-folder')];
    this.tree.appendChild(this._grupo('tramos', ico('project'), this.project?.name || 'Proyecto', tramosFolder));

    // Puntos de análisis (lista, ir/borrar)
    const puntosSinTramo = (puntosPorTramo.get('') || []).map((p) => this._pointLeaf(p));
    if (puntosSinTramo.length) this.tree.appendChild(this._grupo('puntos', ico('point'), `Puntos sin tramo (${puntosSinTramo.length})`, puntosSinTramo));
    /*
      const li = el('li', 'cap-leaf');
      li.title = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
      li.dataset.objTipo = 'punto'; li.dataset.objId = p.id;
      li.innerHTML = `<span class="cap-ico" style="color:${infoTipo('punto').color}">${ico('point')}</span><span class="cap-lbl">${p.nombre}</span>
        <span class="cap-act" data-gopt="${p.id}" title="Ir">${ico('locate')}</span><span class="cap-act" data-delpt="${p.id}" title="Borrar punto">${ico('trash')}</span>
        <span class="cap-meta">${p.cuenca ? p.cuenca.morfometria.A + 'km²' : p.lat.toFixed(3) + ',' + p.lon.toFixed(3)}</span>`;
      li.querySelector('[data-gopt]').addEventListener('click', (e) => { e.stopPropagation(); this.hydro?.irAPunto?.(p.id); });
      li.querySelector('[data-delpt]').addEventListener('click', (e) => { e.stopPropagation(); this.hydro?.borrarPunto?.(p.id); this.render(); });
      li.addEventListener('click', () => this.hydro?.irAPunto?.(p.id));   // clic en la hoja = seleccionar
      return li;
    });
    this.tree.appendChild(this._grupo('puntos', ico('point'), `Puntos de análisis (${puntos.length})`, puntos));
    */

    // Cuencas delineadas (puntos con cuenca)
    const cuencas = (this.map?.getPoints?.() || []).filter((p) => p.cuenca).map((p) => {
      const li = el('li', 'cap-leaf');
      li.dataset.objTipo = 'cuenca'; li.dataset.objId = p.id;
      li.innerHTML = `<span class="cap-ico" style="color:${infoTipo('cuenca').color}">${ico('basin')}</span><span class="cap-lbl">${p.nombre}</span>
        <span class="cap-act" data-gocu="${p.id}" title="Encuadrar">${ico('locate')}</span>
        <span class="cap-act" data-recu="${p.id}" title="Recalcular cuenca">↻</span>
        <span class="cap-act" data-delcu="${p.id}" title="Borrar cuenca">${ico('trash')}</span>
        <span class="cap-meta">${p.cuenca.morfometria.A}km²</span>`;
      const irCuenca = () => { this.hydro?.irAPunto?.(p.id); this.map.showCuenca(p.id, p.cuenca.polygonSuave || p.cuenca.polygon); };
      li.querySelector('[data-gocu]').addEventListener('click', (e) => { e.stopPropagation(); irCuenca(); });
      li.querySelector('[data-recu]').addEventListener('click', (e) => { e.stopPropagation(); this.hydro?.recalcularCuenca?.(p); });
      li.querySelector('[data-delcu]').addEventListener('click', (e) => { e.stopPropagation(); this.map.clearCuenca(p.id); p.cuenca = null; this.render(); });
      li.addEventListener('click', irCuenca);   // clic en la hoja = seleccionar
      return li;
    });
    // Cuencas, red de drenaje y estaciones se muestran como hijos de cada punto de analisis.

    // Referencias (etiquetas río/ciudad/camino)
    const labelsGlobales = this.labels.filter((lb) => !lb.pointId);
    const labels = labelsGlobales.map((lb) => {
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

    // Resultados calculados (chips desde koi.reg) — clic reabre su HUD.
    const reg = window.__koi?.reg || {};
    const claves = Object.keys(reg).filter((k) => REG_INFO[k]);
    if (claves.length) {
      const chips = claves.map((k) => {
        const [accion, label] = REG_INFO[k];
        const li = el('li', 'cap-leaf chip');
        li.innerHTML = `<span class="cap-ico cap-chip"><span class="cap-ok">✓</span></span><span class="cap-lbl">${label}</span><span class="cap-act" title="Abrir resultado">${ico('open')}</span>`;
        li.addEventListener('click', () => bus.emit('abrir:analisis', accion));
        return li;
      });
      const grpR = el('div', 'cap-grp');
      grpR.appendChild(el('div', 'cap-node', `<span class="cap-caret empty"></span><span class="cap-ico">${ico('wave')}</span> Resultados calculados <span class="cap-meta">${chips.length}</span>`));
      const ulR = el('ul', 'cap-children'); for (const li of chips) ulR.appendChild(li); grpR.appendChild(ulR);
      this.tree.appendChild(grpR);
    }

    // Importados
    const grp = el('div', 'cap-grp');
    const importsGlobales = this.imports.filter((im) => !im.pointId);
    grp.appendChild(el('div', 'cap-node', `<span class="cap-caret empty"></span><span class="cap-ico">${ico('folder')}</span> Importados <span class="cap-meta">${importsGlobales.length}</span>`));
    const ul = el('ul', 'cap-children'); grp.appendChild(ul);
    for (const im of importsGlobales) {
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
    this._marcarActivo(getActivo());   // conserva el resaltado del activo tras reconstruir el árbol
  }

  // ── Barra de herramientas ────────────────────────────────────────────────────
  _agregarPunto() {
    const on = !this.map.pickMode;
    this.map.setPickMode(on);
    document.getElementById('btn-pick')?.classList.toggle('active', on);
    this.cont.querySelector('#cap-pt')?.classList.toggle('active', on);
  }
  // Dibuja un tramo/cauce a mano (clic = vértice, doble-clic/Esc termina) → tramo de
  // primera clase, igual que un cauce importado (seleccionable, con relieve/eje/hidrología).
  _dibujarTramo() {
    const btn = this.cont.querySelector('#cap-tramo');
    if (this.map.enDibujo?.()) { this.map.cancelarDibujo?.(); btn?.classList.remove('active'); return; }
    btn?.classList.add('active');
    this.map.dibujar('line', '#e23b5a', (pts) => {
      btn?.classList.remove('active');
      if (!pts || pts.length < 2) return;
      const n = (this.project?.tramos || []).length + 1;
      const base = prompt('Nombre del tramo / cauce:', `Cauce ${n}`);
      if (base == null) return;
      const nombre = this._nombreTramoUnico((base || `Cauce ${n}`).trim());
      const feature = { type: 'Feature', properties: { name: nombre }, geometry: { type: 'LineString', coordinates: pts } };
      const tramo = { name: nombre, feature, npts: pts.length, dem: null };
      this.project = this.project || { id: 'nuevo', name: 'Proyecto', tramos: [] };
      (this.project.tramos = this.project.tramos || []).push(tramo);
      this.map.addTramo(feature, { zoom: false });
      this.render();
      this._selTramo(nombre);
      this.onSelectTramo?.(tramo);
      toast(`Tramo "${nombre}" creado (${pts.length} vértices). Queda seleccionado para analizarlo.`, 'ok');
    });
  }
  _colocarEtiqueta() {
    const tipo = this.cont.querySelector('#cap-lbl-tipo')?.value || 'rio';
    this.map.pickOnce((lon, lat) => {
      const name = prompt(`Nombre (${tipo}):`, '');
      if (name == null) return;
      const p = this._puntoActivo();
      const lb = { name: name || tipo, tipo, lon, lat, pointId: p?.id || null };
      const id = this.map.addLabel(lb);
      this.labels.push({ id, ...lb });
      if (p) ensurePointContext(p).referencias.push(pointRefLite(lb));
      this.render();
    }, `Clic para colocar la etiqueta (${tipo})`);
  }

  // ── Gestión de proyectos ─────────────────────────────────────────────────────
  _renderProyectos(menu) {
    const saved = listProjects().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    menu.innerHTML = `
      <button class="cap-proj-item" id="pm-new">${ico('file')} Nuevo proyecto (vacío)</button>
      ${saved.length ? '<div class="cap-proj-hd">Guardados</div>' : '<div class="cap-proj-hd">Sin proyectos guardados</div>'}
      ${saved.map((p) => `<div class="cap-proj-row">
        <button class="cap-proj-open" data-open="${p.id}" title="Abrir">${ico('open')}<span>${p.name}</span></button>
        <span class="cap-act" data-delproj="${p.id}" title="Borrar proyecto">${ico('trash')}</span></div>`).join('')}`;
    menu.querySelector('#pm-new').addEventListener('click', () => this._nuevoProyecto());
    menu.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => this._abrirProyecto(b.dataset.open)));
    menu.querySelectorAll('[data-delproj]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.delproj;
      if (!confirm('¿Borrar el proyecto guardado? Esta acción no se puede deshacer.')) return;
      removeProject(id); this._renderProyectos(menu);
    }));
  }
  _renombrarProyecto() {
    const cur = this.project?.name || '';
    const name = prompt('Nombre del proyecto:', cur);
    if (name == null || !name.trim()) return;
    let id = this.project?.id;
    if (!id || id === 'nuevo') id = newProjectId();
    const state = { id, name: name.trim(), ...this._estadoActual() };
    saveProject(state); setOpen(id);
    if (this.project) { this.project.id = id; this.project.name = name.trim(); }
    const nm = this.cont.querySelector('.cap-proj-name'); if (nm) nm.textContent = name.trim();
  }
  _borrarProyectoActual() {
    const id = this.project?.id;
    if (!id || id === 'nuevo') { if (confirm('¿Vaciar el proyecto actual (sin guardar)?')) { setOpen(null); location.reload(); } return; }
    if (!confirm(`¿Borrar el proyecto "${this.project?.name}"? Esta acción no se puede deshacer.`)) return;
    removeProject(id);
    setOpen(null); location.reload();
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
    if (!ly) { toast('Este tramo no tiene geometría editable en el mapa.', 'warn'); return; }
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
    if (!on) toast('Esta capa no tiene líneas/polígonos editables (¿solo puntos?).', 'warn');
    this._editImp = on ? id : null; this.render();
  }

  _quitarTramo(name) {
    if (!confirm(`¿Quitar el tramo "${name}" del proyecto?`)) return;
    this.map.removeTramo?.(name);
    if (this.project?.tramos) this.project.tramos = this.project.tramos.filter((t) => t.name !== name);
    for (const p of this.map?.getPoints?.() || []) if (p.tramo === name) p.tramo = null;
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
    let primerTramo = null, nLineas = 0, nRef = 0;
    for (const f of files || []) {
      try {
        const gj = await leerKMLoKMZ(f);
        const base = (f.name || 'importado').replace(/\.(kmz|kml)$/i, '');
        // Las LÍNEAS del KMZ se promueven a tramos de primera clase (cauces
        // seleccionables, con hidrología/eje/relieve); puntos y polígonos quedan
        // como capa de referencia importada.
        const lineas = (gj.features || []).filter((ft) => ft.geometry?.type === 'LineString' && ft.geometry.coordinates?.length >= 2);
        const resto = (gj.features || []).filter((ft) => !(ft.geometry?.type === 'LineString' && ft.geometry.coordinates?.length >= 2));
        this.project = this.project || { id: 'nuevo', name: 'Proyecto', tramos: [] };

        lineas.forEach((ft, i) => {
          const nombre = this._nombreTramoUnico(ft.properties?.name || (lineas.length > 1 ? `${base} (${i + 1})` : base));
          const feature = { type: 'Feature', properties: { name: nombre }, geometry: ft.geometry };
          const tramo = { name: nombre, feature, npts: ft.geometry.coordinates.length, dem: null };
          (this.project.tramos = this.project.tramos || []).push(tramo);
          this.map.addTramo(feature, { zoom: !primerTramo });
          if (!primerTramo) primerTramo = tramo;
          nLineas++;
        });

        if (resto.length) {
          const p = this._puntoActivo();
          const geojson = { type: 'FeatureCollection', features: resto };
          const id = this.map.addImport(f.name, geojson);
          const im = { id, name: f.name, pointId: p?.id || null };
          this.imports.push(im);
          if (p) ensurePointContext(p).importados.push(pointImportLite({ name: f.name, geojson }));
          if (!lineas.length) this.map.zoomImport(id);
          nRef += resto.length;
        }
      } catch (e) { toast('No se pudo importar ' + f.name + ': ' + e.message, 'error'); }
    }
    this.render();
    if (nLineas) {
      toast(`Importado: ${nLineas} cauce(s) como tramo${nRef ? ` y ${nRef} referencia(s)` : ''}. Selecciónalo en el árbol para analizarlo.`, 'ok');
      if (primerTramo) { this._selTramo(primerTramo.name); this.onSelectTramo?.(primerTramo); }
    } else if (nRef) {
      toast(`Importadas ${nRef} referencia(s) (puntos/polígonos).`, 'ok');
    }
  }

  // Nombre de tramo único dentro del proyecto (evita choques al importar varios).
  _nombreTramoUnico(base) {
    const usados = new Set((this.project?.tramos || []).map((t) => t.name));
    if (!usados.has(base)) return base;
    let i = 2; while (usados.has(`${base} (${i})`)) i++;
    return `${base} (${i})`;
  }

  // ── Guardar / abrir proyecto (localStorage + archivo) ───────────────────────
  _estadoActual() {
    const puntos = (this.map.getPoints() || []).map(serializePoint);
    const porTramo = new Map();
    for (const p of puntos) {
      const k = p.tramo || '';
      if (!porTramo.has(k)) porTramo.set(k, []);
      porTramo.get(k).push(p);
    }
    const importados = [...this.map.importLayers.entries()].filter(([id]) => !this.imports.find((im) => im.id === id)?.pointId).map(([id, it]) => {
      let gj = null; try { gj = it.group.toGeoJSON(); } catch {}
      return { name: it.name, geojson: gj };
    });
    const etiquetas = this.labels.filter((lb) => !lb.pointId).map(({ name, tipo, lon, lat }) => ({ name, tipo, lon, lat }));
    const tramos = (this.project?.tramos || []).map((t) => ({ name: t.name, feature: t.feature, dem: t.dem || null, puntos: porTramo.get(t.name) || [] }));
    // resultados/geometría de batimetría-hidráulica (para que persistan si se guarda)
    const es = window.__koi?.estr?.estructuras || [];
    const estructuras = es.map((e) => ({ id: e.id, tipo: e.tipo, nombre: e.nombre, forma: e.forma, solido: e.solido, center: e.center, planta: e.planta, params: { ...e.params }, dz: e.dz || 0, zBase: e.zBase ?? null }));
    const bati = window.__koi?.bati;
    const presas = (window.__koi?.presas || []).map((p) => ({ ...p }));   // vaso/curva son serializables
    return { puntos, importados, etiquetas, tramos, estructuras, presas, eje: bati?.eje || null, dominio: bati?.dominio || null };
  }

  // Proyecto COMPLETO para el archivo .koi: el estado ligero (geometría) + los
  // resultados (koi.reg) + los datos PESADOS que existan (DEM por tramo, malla y
  // campos del 2D). Los TypedArrays los guarda koi_file.js como binario comprimido.
  _proyectoKoi(id, name) {
    const st = this._estadoActual();
    const src = this.project?.tramos || [];
    st.tramos = st.tramos.map((t) => { const o = src.find((x) => x.name === t.name); return o?.demGrid ? { ...t, demGrid: o.demGrid } : t; });
    const bati = window.__koi?.bati;
    const bati2d = bati ? {
      demM: bati.demM || null, mesh2d: bati.mesh2d || null, eje: bati.eje || null, dominio: bati.dominio || null,
      result2d: bati.result2d || null, resultMom2d: bati.resultMom2d || null, resultMorfo2d: bati.resultMorfo2d || null,
    } : null;
    return { app: 'koi-flow', formato: 1, proyecto: id, name, ...st, reg: window.__koi?.reg || {}, bati2d };
  }

  async guardarProyecto() {
    const cur = this.project?.name;
    const name = prompt('Nombre del proyecto:', (cur && cur !== 'Proyecto nuevo') ? cur : '');
    if (name == null) return;
    let id = this.project?.id;
    if (!id || id === 'nuevo') id = newProjectId();
    const st = this._estadoActual();
    // Índice ligero en localStorage (reapertura rápida; SIN los datos pesados).
    saveProject({ id, name: name || id, ...st }); setOpen(id);
    if (this.project) { this.project.id = id; this.project.name = name || id; }
    const nm = this.cont.querySelector('.cap-proj-name'); if (nm) nm.textContent = name || id;
    // Archivo .koi (binario, con DEM/mallas/resultados si los hay).
    try {
      const bytes = await escribirKoi(this._proyectoKoi(id, name || id), { name: name || id });
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `${(name || id).replace(/[^\w.-]+/g, '_')}.koi`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`Proyecto guardado: ${name || id} (${(bytes.length / 1e6).toFixed(2)} MB .koi)`, 'ok');
    } catch (e) { toast('No se pudo escribir el .koi: ' + e.message, 'error'); }
  }

  // Aplica un estado (puntos/cuencas/importados/etiquetas) sobre el mapa. Usado al
  // abrir un archivo y al cargar un proyecto guardado en el arranque.
  aplicarEstado(data) {
    if (!data) return;
    for (const im of data.importados || []) { if (im.geojson) { const id = this.map.addImport(im.name, im.geojson); this.imports.push({ id, name: im.name, pointId: null }); } }
    for (const p of migrateProjectPoints(data)) {
      const pt = this.map.restorePoint(p.lon, p.lat, p.nombre, p.cuenca, {
        id: p.id, tramo: p.tramo || null, contexto: p.contexto || null, cuencaHB: p.cuencaHB || null, snapMeters: p.snapMeters ?? null,
      });
      ensurePointContext(pt);
      if (pt && p.crecida) pt.crecida = p.crecida;   // restaura el hidrograma del objeto
      if (p.cuenca) this.map.showCuenca(pt.id, p.cuenca.polygonSuave || p.cuenca.polygon);
      for (const ref of pt.contexto?.referencias || []) {
        const id = this.map.addLabel(ref);
        this.labels.push({ id, ...ref, pointId: pt.id });
      }
      for (const im of pt.contexto?.importados || []) {
        if (!im.geojson) continue;
        const id = this.map.addImport(im.name, im.geojson);
        this.imports.push({ id, name: im.name, pointId: pt.id });
      }
    }
    for (const lb of data.etiquetas || []) { const id = this.map.addLabel(lb); this.labels.push({ id, ...lb, pointId: null }); }
    // presas / depósitos (con su vaso desde el DEM ya calculado)
    if (data.presas?.length && window.__koi) {
      window.__koi.presas = data.presas.map((p) => ({ ...p }));
      for (const p of window.__koi.presas) this.map.showPresa?.(p, { onClick: () => bus.emit('seleccion:cambio', { tipo: 'presa', id: p.id, nombre: p.nombre, meta: `vaso ${(p.volumen / 1e6).toFixed(2)} Mm³` }) });
    }
    // estructuras
    const estrP = window.__koi?.estr;
    if (estrP && data.estructuras?.length) { estrP.estructuras = data.estructuras.map((e) => ({ ...e, params: { ...e.params } })); estrP._render?.(); estrP._draw?.(); }
    // eje / dominio de batimetría
    const bati = window.__koi?.bati;
    if (bati) {
      if (data.eje) { bati.eje = data.eje; bati._dibujarEje?.(); }
      if (data.dominio) { bati.dominio = data.dominio; this.map.showMalla2D?.({ dominio: data.dominio, cauce: data.eje }); }
    }
    // panel derecho: muestra la cuenca del primer punto restaurado
    const pts = this.map.getPoints();
    if (pts.length && this.hydro) { this.hydro.setPuntos?.(pts); this.hydro._renderCuenca?.(pts.find((p) => p.cuenca) || pts[0]); }
    this.render();
  }

  async _abrir(file) {
    if (!file) return;
    const esKoi = /\.koi$/i.test(file.name) && !/\.koi\.json$/i.test(file.name);
    let data;
    try {
      if (esKoi) { const r = await leerKoi(await file.arrayBuffer()); data = r.proyecto; }
      else data = JSON.parse(await file.text());
    } catch (e) { return toast('Archivo de proyecto inválido: ' + e.message, 'error'); }
    if (!data || data.app !== 'koi-flow') return toast('No es un proyecto koi-flow.', 'error');
    this.aplicarEstado(data);
    this._restaurarPesados(data);
    toast(`Proyecto cargado: ${data.puntos?.length || 0} puntos, ${data.importados?.length || 0} capas, ${data.etiquetas?.length || 0} referencias${data.bati2d?.mesh2d ? ' + malla 2D' : ''}.`, 'ok');
  }

  // Restaura los datos PESADOS de un .koi: resultados (koi.reg → chips/informe), los
  // DEM por tramo, y la malla + campos + mancha del 2D si venían en el archivo.
  _restaurarPesados(data) {
    if (data.reg && window.__koi) { window.__koi.reg = { ...(window.__koi.reg || {}), ...data.reg }; bus.emit('reg:actualizado', { modulo: 'proyecto' }); }
    // tramos: los que no estén ya en el proyecto se agregan y se dibujan.
    this.project = this.project || { tramos: [] }; this.project.tramos = this.project.tramos || [];
    for (const t of data.tramos || []) {
      const dst = this.project.tramos.find((x) => x.name === t.name);
      if (dst) { if (t.demGrid) dst.demGrid = t.demGrid; }
      else if (t.feature) {
        this.project.tramos.push({ name: t.name, feature: t.feature, npts: t.feature.geometry?.coordinates?.length || 0, dem: t.dem || null, demGrid: t.demGrid || null });
        this.map.addTramo?.(t.feature);
      }
    }
    const bati = window.__koi?.bati, b = data.bati2d;
    if (bati && b) {
      if (b.demM) bati.demM = b.demM;
      if (b.mesh2d) bati.mesh2d = b.mesh2d;
      if (b.result2d) bati.result2d = b.result2d;
      if (b.resultMom2d) bati.resultMom2d = b.resultMom2d;
      if (b.resultMorfo2d) bati.resultMorfo2d = b.resultMorfo2d;
      const r = b.resultMom2d || b.result2d;
      try {
        if (b.mesh2d && r?.h) this.map.showInundacion?.(b.mesh2d, r.h, { cauce: b.eje });
        else if (b.dominio) this.map.showMalla2D?.({ dominio: b.dominio, cauce: b.eje });
      } catch {}
    }
    this.render();
  }
}
