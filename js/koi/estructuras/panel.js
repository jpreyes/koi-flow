// ─────────────────────────────────────────────────────────────────────────────
// panel.js — pestaña "Estructuras" del dock (koi-flow). Agregar piezas (tablero,
// viga, pilas circular/rectangular, estribo, defensa, alcantarilla), colocarlas en
// planta (2D), editar sus parámetros NUMÉRICOS, elevarlas al terreno y verlas en 3D.
// Las piezas sólidas se integran al análisis: 2D (stamp del DEM) y 1D (ancho de pila).
// ─────────────────────────────────────────────────────────────────────────────
import { TIPOS, crearEstructura, plantaDe, elevarAlTerreno } from './estructuras.js?v=2';
import { fetchDEM } from '../cuenca/dem_tiles.js?v=2';
import { elevAt } from '../hidraulica/secciones.js?v=2';

const f2 = (v) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)));
const ETIQ = { largo: 'Largo [m]', ancho: 'Ancho [m]', espesor: 'Espesor [m]', luzLibre: 'Luz libre [m]', alto: 'Alto [m]', diametro: 'Diámetro [m]', rot: 'Rotación [°]' };

export class EstructurasPanel {
  constructor() { this.estructuras = []; this.sel = null; }
  setDock(dock) { this.dock = dock; this.host = dock.hosts.estructuras; this._render(); }
  setMap(m) { this.map = m; }
  setScene(s) {
    this.scene = s;
    if (s) s.onEstrMove = (id, lon, lat) => {
      const e = this._get(id); if (!e) return;
      e.center = [lon, lat]; e.planta = plantaDe(e);
      this._draw(); this._render(); this._syncCapas();
      s.loadEstructuras(this.estructuras);
    };
  }
  onVer3D(fn) { this._ver3D = fn; }
  toggle() { if (this.dock?.isOpen() && this.dock.active === 'estructuras') this.dock.close(); else this.dock?.show('estructuras'); }

  _render() {
    if (!this.host) return;
    const opts = Object.entries(TIPOS).map(([k, d]) => `<option value="${k}">${d.label}</option>`).join('');
    this.host.innerHTML = `
      <section class="hp-sec"><h4 class="hp-sec-h">Agregar estructura</h4>
        <div class="bp-btns">
          <select id="es-tipo" class="cap-sel" style="flex:2">${opts}</select>
          <button class="hp-run" id="es-add" style="flex:1">＋ Colocar</button>
        </div>
        <p class="hp-note">Elige el tipo y haz clic en el mapa para ubicarlo (la defensa se dibuja como línea). Luego edita sus dimensiones y elévalo al terreno. Piezas <b style="color:#a855f7">sólidas</b> = pila/estribo/defensa/alcantarilla (bloquean el flujo); <b style="color:#f59e0b">tablero/viga</b> pasan por encima.</p>
      </section>
      <section class="hp-sec"><h4 class="hp-sec-h">Estructuras (${this.estructuras.length})</h4>
        ${this.estructuras.length ? this.estructuras.map((e) => this._card(e)).join('') : '<p class="hp-note">Sin estructuras. Agrega una arriba.</p>'}
      </section>
      <section class="hp-sec">
        <button class="bp-b" id="es-3d" style="width:100%">🏔️ Ver estructuras en 3D</button>
        <p class="hp-note">Integración: en <b>2D</b> las piezas sólidas se "queman" en el DEM al generar la malla (el flujo las rodea, como HEC-RAS). En <b>1D</b> una pila que cruza una sección aporta el ancho de pila a la socavación local.</p>
      </section>`;
    this._wire();
  }

  _card(e) {
    const keys = Object.keys(e.params);
    return `<div class="bp-sec-card${e.id === this.sel ? ' sel' : ''}" data-es="${e.id}">
      <div class="bp-sec-h"><b>${e.nombre}</b>
        <span style="font-size:11px;color:var(--text2)">${e.solido ? '🟪 sólida' : '🟧 pasa encima'}</span>
        <button class="bp-sec-del" data-esdel="${e.id}" title="Borrar">🗑</button></div>
      <div class="bp-form">
        ${keys.map((k) => `<label>${ETIQ[k] || k}<input type="number" step="${k === 'rot' ? 5 : 0.1}" data-esp="${e.id}:${k}" value="${e.params[k]}"></label>`).join('')}
        <label>Elevación extra dz [m]<input type="number" step="0.5" data-esp="${e.id}:dz" value="${e.dz || 0}"></label>
      </div>
      <div class="hp-kv"><div><span>Cota base terreno</span><b>${e.zBase != null ? f2(e.zBase) + ' m' : '— (elevar)'}</b></div></div>
      <div class="bp-btns">
        <button class="bp-b" data-eselev="${e.id}">⛰️ Elevar al terreno</button>
        <button class="bp-b" data-esmove="${e.id}">🎯 Recolocar</button>
      </div></div>`;
  }

  _wire() {
    const $ = (s) => this.host.querySelector(s);
    $('#es-add')?.addEventListener('click', () => this._agregar($('#es-tipo').value));
    $('#es-3d')?.addEventListener('click', () => this._ver3Dclick());
    this.host.querySelectorAll('[data-esdel]').forEach((b) => b.addEventListener('click', () => { this.estructuras = this.estructuras.filter((x) => x.id !== +b.dataset.esdel); this._render(); this._draw(); this._syncCapas(); }));
    this.host.querySelectorAll('[data-eselev]').forEach((b) => b.addEventListener('click', () => this._elevar(+b.dataset.eselev)));
    this.host.querySelectorAll('[data-esmove]').forEach((b) => b.addEventListener('click', () => this._recolocar(+b.dataset.esmove)));
    this.host.querySelectorAll('[data-esp]').forEach((inp) => inp.addEventListener('change', () => {
      const [id, k] = inp.dataset.esp.split(':'); const e = this._get(+id); if (!e) return;
      const v = parseFloat(inp.value); if (!isFinite(v)) return;
      if (k === 'dz') e.dz = v; else e.params[k] = v;
      if (e.forma !== 'linea') e.planta = plantaDe(e);
      this._draw();
    }));
    this.host.querySelectorAll('[data-es]').forEach((c) => c.addEventListener('click', (ev) => { if (!ev.target.closest('button,input')) { this.sel = +c.dataset.es; this._draw(); } }));
  }

  _get(id) { return this.estructuras.find((e) => e.id === id); }
  _syncCapas() { window.__koi?.capas?.render?.(); }

  _agregar(tipo) {
    if (!this.map) return;
    if (TIPOS[tipo].forma === 'linea') {
      this.map.dibujar('line', '#a855f7', (pts) => { if (!pts || pts.length < 2) return; const e = crearEstructura(tipo); e.planta = pts; this.estructuras.push(e); this.sel = e.id; this._render(); this._draw(); });
      return;
    }
    this.map.pickOnce((lon, lat) => {
      const e = crearEstructura(tipo, [lon, lat]);
      this.estructuras.push(e); this.sel = e.id; this._render(); this._draw(); this._syncCapas();
    }, `Clic para ubicar: ${TIPOS[tipo].label}`);
  }
  _recolocar(id) {
    const e = this._get(id); if (!e || !this.map) return;
    this.map.pickOnce((lon, lat) => { e.center = [lon, lat]; e.planta = plantaDe(e); this._draw(); this._render(); }, `Nuevo centro: ${e.nombre}`);
  }

  async _elevar(id) {
    const e = this._get(id); if (!e) return;
    const poly = e.forma === 'linea' ? e.planta : plantaDe(e);
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    // DEM: usa la batimetría fusionada/colocada si existe, si no baja el relieve base
    let grid = window.__koi?.bati?.fused || window.__koi?.bati?.grid;
    try {
      if (!grid) { const m = 0.003; grid = await fetchDEM({ west: cx - m, east: cx + m, south: cy - m, north: cy + m }, { maxDim: 128 }); }
      elevarAlTerreno(e, grid, elevAt);
      this._render(); this._draw();
    } catch (err) { alert('No se pudo bajar el relieve para elevar: ' + err.message); }
  }

  _draw() {
    this.map?.showEstructuras?.(this.estructuras, { sel: this.sel, onPick: (id) => { this.sel = id; this._render(); this._draw(); } });
    this._drawHandles();
  }
  // Marcadores arrastrables en el centro de cada pieza (mover en 2D).
  _drawHandles() {
    const L = window.L; if (!L || !this.map?.map) return;
    if (this._hGroup) this._hGroup.clearLayers(); else this._hGroup = L.layerGroup().addTo(this.map.map);
    for (const e of this.estructuras) {
      if (e.forma === 'linea' || !e.center) continue;
      const icon = L.divIcon({ className: 'koi-sec-vtx', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
      const mk = L.marker([e.center[1], e.center[0]], { icon, draggable: true, zIndexOffset: 700 }).bindTooltip(`${e.nombre} (arrastra para mover)`, { direction: 'top' });
      mk.on('drag', () => { const ll = mk.getLatLng(); e.center = [ll.lng, ll.lat]; e.planta = plantaDe(e); this.map.showEstructuras(this.estructuras, { sel: this.sel }); });
      mk.on('dragend', () => { const ll = mk.getLatLng(); e.center = [ll.lng, ll.lat]; e.planta = plantaDe(e); this._draw(); this._syncCapas(); });
      this._hGroup.addLayer(mk);
    }
  }

  _ver3Dclick() {
    if (this.scene?.loadEstructuras) this.scene.loadEstructuras(this.estructuras);
    this._ver3D?.();
  }
}
