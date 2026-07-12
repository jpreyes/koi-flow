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
      <div class="cap-toolbar" style="display:none">
        <button class="cap-tool" id="cap-pt" title="Agregar punto de análisis (clic en el mapa)">${ico('point')}<span>Punto</span></button>
        <button class="cap-tool" id="cap-tramo" title="Dibujar un tramo/cauce (clic = vértices · doble-clic / clic-derecho / Esc = terminar)">${ico('wave')}<span>Tramo</span></button>
        <button class="cap-tool" id="cap-lbl" title="Agregar etiqueta referencial (río / ciudad / camino)">${ico('label')}<span>Etiqueta</span></button>
        <button class="cap-tool" id="cap-import" title="Importar KMZ/KML">${ico('folder')}<span>Importar</span></button>
      </div>
      <div class="cap-toolbar" style="display:none">
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

  // ── Árbol drill-in (miga de pan) ─────────────────────────────────────────────
  // El árbol se navega "entrando" a los objetos, mostrando UN nivel a la vez, en
  // vez de anidar <ul> que a 3-4 niveles se salían del ancho del panel. `_nav` es
  // la ruta (claves) desde la raíz; render() la resuelve y pinta solo ese nivel.

  // Una fila del nivel actual a partir de un nodo del modelo.
  _row(node) {
    const drill = !!(node.children && node.children.length);
    const li = el('li', 'cap-leaf' + (node.cls ? ' ' + node.cls : '') + (drill ? ' cap-drillable' : ''));
    if (node.tipo) { li.dataset.objTipo = node.tipo; li.dataset.objId = node.id; }
    if (node.name) li.dataset.name = node.name;   // _selTramo / setRelieveCargando
    if (node.title) li.title = node.title;

    let h = '';
    if (node.check) h += `<label class="cap-vis"><input type="checkbox" ${node.check.checked === false ? '' : 'checked'}></label>`;
    h += `<span class="cap-ico"${node.iconColor ? ` style="color:${node.iconColor}"` : ''}>${node.icon || ''}</span>`;
    h += `<span class="cap-lbl">${node.label}</span>`;
    (node.actions || []).forEach((a, i) => { h += `<span class="cap-act ${a.cls || ''}" data-act="${i}" title="${a.title || ''}">${a.icon}</span>`; });
    if (node.meta != null && node.meta !== '') h += `<span class="cap-meta">${node.meta}</span>`;
    if (drill) h += `<span class="cap-drill" data-drill="1" title="Ver contenido">${node.children.length}<span class="cap-chev">›</span></span>`;
    li.innerHTML = h;

    if (node.check) li.querySelector('.cap-vis input').addEventListener('change', (e) => { e.stopPropagation(); node.check.onToggle(e.target.checked); });
    (node.actions || []).forEach((a, i) => {
      const b = li.querySelector(`[data-act="${i}"]`);
      if (b) b.addEventListener('click', (e) => { e.stopPropagation(); a.fn(); });
    });
    if (drill) li.querySelector('[data-drill]').addEventListener('click', (e) => { e.stopPropagation(); this._nav.push(node.key); this.render(); });

    li.addEventListener('click', (e) => {
      if (e.target.closest('.cap-vis') || e.target.closest('.cap-act') || e.target.closest('.cap-drill')) return;
      if (node.onClick) node.onClick();
      else if (drill) { this._nav.push(node.key); this.render(); }
    });
    return li;
  }

  render() {
    if (!this._nav) this._nav = [];
    this.tree.innerHTML = '';

    // Modelo de datos → resolver la ruta actual (descartando claves obsoletas).
    const root = this._nodoRaiz();
    const path = [root];
    let cur = root;
    for (const key of this._nav) {
      const nxt = (cur.children || []).find((c) => c.key === key);
      if (!nxt) break;
      cur = nxt; path.push(cur);
    }
    this._nav = path.slice(1).map((n) => n.key);

    // Miga de pan + encabezado del nivel (solo si entraste a algo).
    if (path.length > 1) {
      const bc = el('div', 'cap-crumbs');
      const back = el('button', 'cap-crumb-back', '‹');
      back.title = 'Volver'; back.addEventListener('click', () => { this._nav.pop(); this.render(); });
      bc.appendChild(back);
      path.forEach((n, i) => {
        const seg = el('button', 'cap-crumb' + (i === path.length - 1 ? ' cur' : ''), i === 0 ? 'Inicio' : n.label);
        seg.title = n.label;
        seg.addEventListener('click', () => { this._nav = path.slice(1, i + 1).map((x) => x.key); this.render(); });
        bc.appendChild(seg);
        if (i < path.length - 1) bc.appendChild(el('span', 'cap-crumb-sep', '›'));
      });
      this.tree.appendChild(bc);

      const hd = el('div', 'cap-level-hd');
      hd.innerHTML = `<span class="cap-ico"${cur.iconColor ? ` style="color:${cur.iconColor}"` : ''}>${cur.icon || ''}</span><span class="cap-lbl">${cur.label}</span>${cur.meta ? `<span class="cap-meta">${cur.meta}</span>` : ''}`;
      this.tree.appendChild(hd);
    }

    // Filas del nivel actual.
    const ul = el('ul', 'cap-children cap-level');
    const kids = cur.children || [];
    if (!kids.length) ul.appendChild(el('li', 'cap-empty', 'Nada aquí todavía.'));
    for (const n of kids) ul.appendChild(this._row(n));
    this.tree.appendChild(ul);

    this._marcarActivo(getActivo());   // conserva el resaltado del activo tras reconstruir el árbol
  }

  // Nodo raíz del árbol (grupos de primer nivel).
  _nodoRaiz() {
    const ppt = this._puntosPorTramo();
    const pts = this.map?.getPoints?.() || [];
    const children = [];

    // Tramos / cauces → cada uno entra a sus puntos (cuenca/red/estaciones dentro).
    const tramos = (this.project?.tramos || []).map((t) => this._tramoNodo(t, ppt));
    children.push({ key: 'g:tramos', check: { onToggle: (v) => this.map.setLayerVisible('tramos', v) }, icon: ico('wave'), label: 'Tramos / cauces', meta: String(tramos.length), children: tramos });

    // Puntos sin tramo (sueltos).
    const sueltos = ppt.get('') || [];
    if (sueltos.length) children.push({ key: 'g:sueltos', check: { onToggle: (v) => this.map.setLayerVisible('puntos', v) }, icon: ico('point'), label: 'Puntos sin tramo', meta: String(sueltos.length), children: sueltos.map((p) => this._puntoNodo(p)) });

    // Cuencas delineadas.
    const conCuenca = pts.filter((p) => p.cuenca);
    children.push({ key: 'g:cuencas', icon: ico('basin'), label: 'Cuencas delineadas', meta: String(conCuenca.length), children: conCuenca.map((p) => this._cuencaNodo(p)) });

    // Referencias (etiquetas globales).
    const labs = this.labels.filter((lb) => !lb.pointId);
    children.push({ key: 'g:labels', check: { onToggle: (v) => this.map.setLayerVisible('labels', v) }, icon: ico('label'), label: 'Referencias', meta: String(labs.length), children: labs.map((lb) => this._labelNodo(lb)) });

    // GIS creado (bati/estructuras) — solo si hay algo.
    const gis = this._gisNodos();
    if (gis.length) children.push({ key: 'g:gis', icon: ico('project'), label: 'GIS creado', meta: String(gis.length), children: gis });

    // Resultados calculados (chips desde koi.reg).
    const res = this._resultadoNodos();
    if (res.length) children.push({ key: 'g:res', icon: ico('wave'), label: 'Resultados calculados', meta: String(res.length), children: res });

    // Importados globales.
    const imps = this.imports.filter((im) => !im.pointId).map((im) => this._importNodo(im));
    children.push({ key: 'g:imports', icon: ico('folder'), label: 'Importados', meta: String(imps.length), children: imps });

    return { key: 'root', icon: ico('project'), label: this.project?.name || 'Proyecto', children };
  }

  _tramoNodo(t, ppt) {
    const has = !!(t.dem || t.demGrid) && !t.relieveOff;
    const pts = ppt.get(t.name) || [];
    return {
      key: `tramo:${t.name}`, tipo: 'tramo', id: t.name, name: t.name,
      icon: ico('wave'), iconColor: infoTipo('tramo').color, label: t.name, meta: `${t.npts}p`,
      onClick: () => { this._selTramo(t.name); this.onSelectTramo?.(t); },
      actions: [
        { icon: ico('mountain'), title: has ? 'Relieve activo — clic para desactivar' : 'Activar/descargar relieve', cls: 'cap-relieve' + (has ? ' on' : ''), fn: () => this.onRelieve?.(t) },
        { icon: ico('pencil'), title: 'Editar vértices (arrastra · Esc termina)', cls: this._editTramo === t.name ? 'on' : '', fn: () => this._editarTramo(t.name) },
        { icon: ico('trash'), title: 'Quitar tramo', fn: () => this._quitarTramo(t.name) },
      ],
      children: pts.map((p) => this._puntoNodo(p)),
    };
  }

  _puntoNodo(p) {
    return {
      key: `punto:${p.id}`, tipo: 'punto', id: p.id,
      icon: ico('point'), iconColor: infoTipo('punto').color, label: p.nombre,
      title: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`,
      meta: p.cuenca ? p.cuenca.morfometria.A + 'km²' : p.lat.toFixed(3) + ',' + p.lon.toFixed(3),
      onClick: () => this.hydro?.irAPunto?.(p.id),
      actions: [
        { icon: ico('locate'), title: 'Ir', fn: () => this.hydro?.irAPunto?.(p.id) },
        { icon: ico('trash'), title: 'Borrar punto', fn: () => { this.hydro?.borrarPunto?.(p.id); this.render(); } },
      ],
      children: this._pointAssetNodos(p),
    };
  }

  // Activos de un punto (cuenca / red / estaciones / referencias / resultados…).
  _pointAssetNodos(p) {
    const c = ensurePointContext(p);
    const sel = () => this.hydro?.irAPunto?.(p.id);
    const tool = (accion) => { sel(); bus.emit('abrir:analisis', accion); };
    const A = (icon, label, meta, onClick, cls) => ({ key: `a:${p.id}:${label}`, icon, label, meta, onClick, cls });
    const out = [];
    if (p.cuenca) out.push(A(ico('basin'), 'Cuenca', `${p.cuenca.morfometria?.A ?? '?'}km²`, () => this.map.showCuenca(p.id, p.cuenca.polygonSuave || p.cuenca.polygon)));
    else out.push(A(ico('basin'), 'Cuenca delineada', 'pendiente', () => tool('cuenca-delinear'), 'cap-pending'));
    if (c.red?.fc) out.push(A(ico('wave'), 'Red de drenaje', `${c.red.meta?.nLineas ?? c.red.fc.features?.length ?? 0} cauces`, () => this.map.showRedDrenaje(c.red.fc)));
    else out.push(A(ico('wave'), 'Red de drenaje', 'pendiente', () => tool('afluentes-punto'), 'cap-pending'));
    const nEst = c.estaciones?.cercanas?.length || 0;
    if (nEst || c.estaciones?.seleccion?.ctrl || c.estaciones?.seleccion?.pluvio) {
      const s = [c.estaciones.seleccion?.ctrl?.nombre, c.estaciones.seleccion?.pluvio?.nombre].filter(Boolean).length;
      out.push(A(ico('station'), 'Estaciones DGA', `${nEst} cerca${s ? ` · ${s} sel.` : ''}`, () => this.map.showStations(c.estaciones.cercanas || [])));
    } else out.push(A(ico('station'), 'Estaciones DGA', 'sin buscar', () => tool('estaciones-dga'), 'cap-pending'));
    out.push(A(ico('label'), 'Referencias', String(c.referencias?.length || 0), null, c.referencias?.length ? '' : 'cap-pending'));
    out.push(A(ico('folder'), 'Importados', String(c.importados?.length || 0), null, c.importados?.length ? '' : 'cap-pending'));
    const nRes = Object.keys(c.resultados || {}).length;
    out.push(A(ico('open'), 'Resultados', String(nRes), null, nRes ? '' : 'cap-pending'));
    out.push(A(ico('save'), 'Exportar punto', 'JSON', () => descargarJSON(`punto_${(p.nombre || p.id).replace(/[^\w.-]+/g, '_')}.json`, serializePoint(p))));
    return out;
  }

  _cuencaNodo(p) {
    const ir = () => { this.hydro?.irAPunto?.(p.id); this.map.showCuenca(p.id, p.cuenca.polygonSuave || p.cuenca.polygon); };
    return {
      key: `cuenca:${p.id}`, tipo: 'cuenca', id: p.id,
      icon: ico('basin'), iconColor: infoTipo('cuenca').color, label: p.nombre, meta: `${p.cuenca.morfometria.A}km²`,
      onClick: ir,
      actions: [
        { icon: ico('locate'), title: 'Encuadrar', fn: ir },
        { icon: '↻', title: 'Recalcular cuenca', fn: () => this.hydro?.recalcularCuenca?.(p) },
        { icon: ico('trash'), title: 'Borrar cuenca', fn: () => { this.map.clearCuenca(p.id); p.cuenca = null; this.render(); } },
      ],
    };
  }

  _labelNodo(lb) {
    return {
      key: `lbl:${lb.id}`, icon: ico(lb.tipo), label: lb.name, meta: lb.tipo,
      title: `${lb.tipo} · ${lb.lat.toFixed(5)}, ${lb.lon.toFixed(5)}`,
      onClick: () => this.map.zoomLabel(lb.id),
      actions: [
        { icon: ico('locate'), title: 'Centrar', fn: () => this.map.zoomLabel(lb.id) },
        { icon: ico('trash'), title: 'Borrar', fn: () => { this.map.removeLabel(lb.id); this.labels = this.labels.filter((x) => x.id !== lb.id); this.render(); } },
      ],
    };
  }

  _gisNodos() {
    const bati = window.__koi?.bati, estrP = window.__koi?.estr;
    const out = [];
    const push = (ic, label, meta, zoom, del) => out.push({
      key: `gis:${label}`, icon: ico(ic), label, meta, onClick: zoom || null,
      actions: [...(zoom ? [{ icon: ico('locate'), title: 'Encuadrar', fn: zoom }] : []), ...(del ? [{ icon: ico('trash'), title: 'Borrar', fn: del }] : [])],
    });
    if (bati?.demM) push('mountain', 'DEM colocado', `${bati.demM.nx}×${bati.demM.ny}`, () => bati.map?.fitBati?.(), () => bati.borrarDEM());
    if (bati?.fused) push('mountain', 'DEM fusionado', '', null, () => { bati.fused = null; this.render(); });
    if (bati?.eje) push('wave', 'Eje del cauce', `${bati.eje.length} pt`, null, () => bati.borrarEje());
    if (bati?.dominio) push('basin', 'Dominio 2D', `${bati.dominio.length} pt`, null, () => bati.borrarDominio());
    if (bati?.mesh2d) push('basin', 'Malla / sim 2D', `${bati.mesh2d.meta.nNodos} nodos`, null, () => bati.borrarMalla());
    for (const e of (estrP?.estructuras || [])) {
      const go = () => { if (e.center) this.map.map.panTo([e.center[1], e.center[0]]); };
      out.push({
        key: `estr:${e.id}`, icon: ico('project'), label: e.nombre, meta: e.solido ? 'sólida' : 'pasa', onClick: go,
        actions: [
          { icon: ico('locate'), title: 'Centrar', fn: go },
          { icon: ico('trash'), title: 'Borrar', fn: () => { estrP.estructuras = estrP.estructuras.filter((x) => x.id !== e.id); estrP._render?.(); estrP._draw?.(); this.render(); } },
        ],
      });
    }
    return out;
  }

  _resultadoNodos() {
    const reg = window.__koi?.reg || {};
    return Object.keys(reg).filter((k) => REG_INFO[k]).map((k) => {
      const [accion, label] = REG_INFO[k];
      return {
        key: `res:${k}`, cls: 'chip', icon: `<span class="cap-chip"><span class="cap-ok">✓</span></span>`, label,
        onClick: () => bus.emit('abrir:analisis', accion),
        actions: [{ icon: ico('open'), title: 'Abrir resultado', fn: () => bus.emit('abrir:analisis', accion) }],
      };
    });
  }

  _importNodo(im) {
    const ed = this._editImp === im.id;
    return {
      key: `imp:${im.id}`, icon: ico('file'), label: im.name,
      check: { onToggle: (v) => this.map.toggleImport(im.id, v) },
      onClick: () => this.map.zoomImport(im.id),
      actions: [
        { icon: ico('locate'), title: 'Centrar', fn: () => this.map.zoomImport(im.id) },
        { icon: ico('pencil'), title: 'Editar vértices (arrastra · Esc termina)', cls: ed ? 'on' : '', fn: () => this._editarImport(im.id) },
        { icon: ico('trash'), title: 'Quitar', fn: () => { if (this._editImp === im.id) { this.map.editarVertices([]); this._editImp = null; } this.map.removeImport(im.id); this.imports = this.imports.filter((x) => x.id !== im.id); this.render(); } },
      ],
    };
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
      <button class="cap-proj-item" id="pm-save-nube">☁ Guardar en la nube</button>
      <div class="cap-proj-hd">☁ Nube (tu organización)</div>
      <div id="pm-nube"><div class="cap-proj-empty">Cargando…</div></div>
      ${saved.length ? '<div class="cap-proj-hd">En este equipo</div>' : ''}
      ${saved.map((p) => `<div class="cap-proj-row">
        <button class="cap-proj-open" data-open="${p.id}" title="Abrir">${ico('open')}<span>${p.name}</span></button>
        <span class="cap-act" data-delproj="${p.id}" title="Borrar proyecto">${ico('trash')}</span></div>`).join('')}`;
    menu.querySelector('#pm-new').addEventListener('click', () => this._nuevoProyecto());
    menu.querySelector('#pm-save-nube').addEventListener('click', () => this.guardarEnNube());
    menu.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => this._abrirProyecto(b.dataset.open)));
    menu.querySelectorAll('[data-delproj]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.delproj;
      if (!confirm('¿Borrar el proyecto guardado? Esta acción no se puede deshacer.')) return;
      removeProject(id); this._renderProyectos(menu);
    }));
    this._pintarNube(menu);
  }

  // Lista los proyectos de la nube (RLS: solo los de tu organización) dentro del menú.
  async _pintarNube(menu) {
    const cont = menu.querySelector('#pm-nube'); if (!cont) return;
    try {
      const { listarNube, borrarNube } = await import('../auth/proyectos_nube.js?v=13');
      const rows = await listarNube();
      if (!rows.length) { cont.innerHTML = '<div class="cap-proj-empty">Sin proyectos en la nube todavía.</div>'; return; }
      cont.innerHTML = rows.map((p) => `<div class="cap-proj-row">
        <button class="cap-proj-open" data-opennube="${p.id}" title="Abrir de la nube">${ico('open')}<span>${p.nombre}</span></button>
        <span class="cap-act" data-delnube="${p.id}" title="Borrar de la nube">${ico('trash')}</span></div>`).join('');
      cont.querySelectorAll('[data-opennube]').forEach((b) => b.addEventListener('click', () => this.abrirDeNube(rows.find((r) => r.id === b.dataset.opennube))));
      cont.querySelectorAll('[data-delnube]').forEach((b) => b.addEventListener('click', async () => {
        const p = rows.find((r) => r.id === b.dataset.delnube);
        if (!confirm(`¿Borrar "${p.nombre}" de la nube? No se puede deshacer.`)) return;
        try { await borrarNube(p); this._pintarNube(menu); toast('Proyecto borrado de la nube.', 'ok'); }
        catch (e) { toast(e.message, 'error'); }
      }));
    } catch (e) { cont.innerHTML = `<div class="cap-proj-empty">Nube no disponible: ${e.message}</div>`; }
  }

  // Guarda el proyecto actual en la nube (Storage + tabla), reusando el mismo .koi binario.
  async guardarEnNube() {
    try {
      const cur = this.project?.name;
      const name = prompt('Nombre del proyecto (nube):', (cur && cur !== 'Proyecto nuevo') ? cur : '');
      if (name == null || !name.trim()) return;
      const bytes = await escribirKoi(this._proyectoKoi(this.project?.id || 'nube', name.trim()), { name: name.trim() });
      const { guardarNube } = await import('../auth/proyectos_nube.js?v=13');
      const r = await guardarNube(name.trim(), bytes, this.project?.nubeId || null);
      if (this.project) { this.project.nubeId = r.id; this.project.name = name.trim(); }
      const nm = this.cont.querySelector('.cap-proj-name'); if (nm) nm.textContent = name.trim();
      toast(`Guardado en la nube: ${name.trim()} (${(bytes.length / 1e6).toFixed(2)} MB).`, 'ok');
    } catch (e) { toast('No se pudo guardar en la nube: ' + e.message, 'error'); }
  }

  // Abre un proyecto desde la nube: descarga el .koi y lo restaura como al abrir un archivo.
  async abrirDeNube(project) {
    if (!project) return;
    try {
      const { abrirNube } = await import('../auth/proyectos_nube.js?v=13');
      const bytes = await abrirNube(project);
      const r = await leerKoi(bytes); const data = r.proyecto;
      if (!data || data.app !== 'koi-flow') return toast('El archivo en la nube no es un proyecto válido.', 'error');
      this.aplicarEstado(data); this._restaurarPesados(data);
      if (this.project) { this.project.nubeId = project.id; this.project.name = project.nombre; }
      const nm = this.cont.querySelector('.cap-proj-name'); if (nm) nm.textContent = project.nombre;
      const menu = document.getElementById('cap-proj-menu'); if (menu) menu.hidden = true;
      toast(`Proyecto abierto de la nube: ${project.nombre}.`, 'ok');
    } catch (e) { toast('No se pudo abrir de la nube: ' + e.message, 'error'); }
  }

  // Diálogo "Abrir de la nube" (para el menú Archivo): lista los proyectos cloud y abre el elegido.
  async abrirNubeDialog() {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)';
    ov.innerHTML = `<div style="width:min(440px,92vw);max-height:80vh;overflow:auto;background:var(--panel,#171b22);color:var(--fg,#e6e9ef);border:1px solid var(--border,#2a2f3a);border-radius:12px;padding:18px 20px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <b>☁ Abrir de la nube</b><button class="koi-nd-x" title="Cerrar" style="background:0;border:0;color:inherit;font-size:22px;line-height:1;cursor:pointer">×</button></div>
      <div class="koi-nd-list" style="font-size:14px">Cargando…</div></div>`;
    document.body.appendChild(ov);
    const cerrar = () => ov.remove();
    ov.querySelector('.koi-nd-x').addEventListener('click', cerrar);
    ov.addEventListener('click', (e) => { if (e.target === ov) cerrar(); });
    const list = ov.querySelector('.koi-nd-list');
    try {
      const { listarNube } = await import('../auth/proyectos_nube.js?v=13');
      const rows = await listarNube();
      if (!rows.length) { list.innerHTML = '<div style="color:var(--muted,#8b93a3);padding:8px 0">Sin proyectos en la nube todavía. Usa «Guardar en la nube» primero.</div>'; return; }
      list.innerHTML = rows.map((p) => `<div class="koi-nd-row" data-id="${p.id}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--border,#2a2f3a);border-radius:8px;margin-bottom:6px;cursor:pointer">
        <span>${p.nombre}</span><span style="color:var(--muted,#8b93a3);font-size:12px">${(p.actualizado || '').slice(0, 10)}</span></div>`).join('');
      list.querySelectorAll('.koi-nd-row').forEach((r) => r.addEventListener('click', () => { cerrar(); this.abrirDeNube(rows.find((x) => x.id === r.dataset.id)); }));
    } catch (e) { list.innerHTML = `<div style="color:#f4859b;padding:8px 0">Nube no disponible: ${e.message}</div>`; }
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
