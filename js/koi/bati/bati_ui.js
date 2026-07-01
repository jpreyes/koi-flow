// ─────────────────────────────────────────────────────────────────────────────
// bati_ui.js — panel de Batimetría / CAD (koi-flow, Fase 4).
// Flujo: Importar DXF → elegir capas de terreno → construir DEM → COLOCAR sobre el
// mapa (arrastrar + auto-elevar sobre el relieve, sin pelear con el huso/datum) →
// ver en 3D → trazar secciones → eje hidráulico (Manning) + socavación → exportar
// a HEC-RAS (.sdf / .asc / .prj / CSV). Reutiliza los módulos bati/* e hidraulica/*.
// ─────────────────────────────────────────────────────────────────────────────
import { leerDXF, sugerirCapas } from './dxf.js?v=2';
import { construirDEMmetrico } from './interp.js?v=2';
import { demMetricoAGrid, footprint, elevAtMetrico, metricoDesdeLonLat, autoElevar, anclaInicial } from './place.js?v=2';
import { fusionar } from './fusion.js?v=2';
import { detectarSistema } from './proj.js?v=2';
import { nivelNormal } from '../hidraulica/manning.js?v=2';
import { evaluarSocavacion } from '../hidraulica/socavacion.js?v=2';
import { ejeRemanso, ejeMixto } from '../hidraulica/remanso.js?v=2';
import { analisisCompleto, salidaCSV } from '../hidraulica/salida.js?v=2';
import { wktUTM, demArcASCII, sdfGeometria, csvSecciones } from './hecras.js?v=2';
import { exportarDXF } from './dxf_export.js?v=2';
import { fetchDEM } from '../cuenca/dem_tiles.js?v=2';
import { elevAt } from '../hidraulica/secciones.js?v=2';
import { zipStore, descargar } from '../cuenca/exportar.js?v=2';
import { construirMalla2D } from '../hidraulica/malla2d.js?v=2';
import { resolver2D } from '../hidraulica/solver2d.js?v=2';
import { getConfig } from '../config.js?v=2';
import { stampTerreno, pilaEnSeccion, puntoEnPoligono } from '../estructuras/estructuras.js?v=2';

const f2 = (v) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)));

export class BatiPanel {
  constructor() {
    this.state = 'import';        // import | build | placed
    this.cauces = [{ nombre: 'Cauce 1', secciones: [] }];
    this.iCauce = 0;
    this.secciones = this.cauces[0].secciones;   // siempre apunta al cauce activo
    this._draw = null;
    this.motor = '1d';            // '1d' (Manning/remanso) | '2d' (onda difusiva) — lienzo unificado
    this.eje = null;              // polilínea del EJE del cauce (lonlat), geometría compartida 1D/2D
    this.dominio = null;          // polígono del dominio inundable (para el motor 2D)
    this.mesh2d = null;           // malla 2D generada (construirMalla2D)
    this.result2d = null;         // resultado del solver 2D (h, V, H por nodo)
    this.modo = 'cad';            // 'cad' (DXF/curvas) | 'dem' (DEM base Terrarium, sin CAD)
    this.baseDEM = null;          // grilla DEM base (fetchDEM) para trabajar sin CAD
    this._flujoInvert = false;    // inversión manual de la dirección del flujo
  }

  _selCauce(i) { this.iCauce = i; this.secciones = this.cauces[i].secciones; this._render(); this._dibujarSecciones(); }
  _nuevoCauce() {
    this.cauces.push({ nombre: 'Cauce ' + (this.cauces.length + 1), secciones: [] });
    this._selCauce(this.cauces.length - 1);
  }

  // Vive dentro del Dock (pestaña 📐 Batimetría).
  setDock(dock) { this.dock = dock; this.body = dock.hosts.bati; this._render(); }
  setMap(m) { this.map = m; }
  setScene(s) { this.scene = s; }
  setTramo(t) { this.tramo = t; }
  onVer3D(fn) { this._ver3D = fn; }

  toggle() { if (this.dock?.isOpen() && this.dock.active === 'bati') this.dock.close(); else this.dock?.show('bati'); }
  open() { this.dock?.show('bati'); }
  close() { this.dock?.close(); }

  // ── Render principal según estado ────────────────────────────────────────────
  _render() {
    let h = '';
    const cfg = getConfig();
    // 1) Importar
    h += `<section class="hp-sec"><h4 class="hp-sec-h">1 · Importar CAD (DXF)</h4>
      <input type="file" id="bp-file" accept=".dxf" class="bp-file">
      <p class="hp-note">Exporta tu DWG a <b>DXF</b> (SAVEAS/DXFOUT en AutoCAD/CivilCAD). Se leen curvas de nivel (LWPOLYLINE/3D), malla TIN (3DFACE), puntos y cotas.</p>
      ${this.res ? this._resumenDXF() : ''}</section>`;

    // Alternativa SIN CAD: trabajar sobre el DEM base (Terrarium) — cauces secos (Tarapacá)
    h += `<section class="hp-sec"><h4 class="hp-sec-h">…o sin CAD: DEM del terreno</h4>
      <button class="hp-run" id="bp-usardem">🗺️ Usar DEM base ${this.tramo ? 'del tramo' : 'de la vista'}</button>
      <span class="hp-dl-status" id="bp-demst"></span>
      ${this.baseDEM ? `<div class="hp-kv"><div><span>DEM base</span><b>${this.baseDEM.nx}×${this.baseDEM.ny} · z${this.baseDEM.zoom ?? '?'}</b></div><div><span>Cotas</span><b>${f2(this.baseDEM.zmin)} – ${f2(this.baseDEM.zmax)} m</b></div></div>` : ''}
      <p class="hp-note">Para cauces secos o sin levantamiento: baja el relieve del terreno y traza el eje y las secciones directamente sobre él (sin DXF ni curvas).</p></section>`;

    if (this.res) {
      // 2) Capas de terreno
      h += `<section class="hp-sec"><h4 class="hp-sec-h">2 · Capas de terreno</h4>
        <div class="bp-capas">${this._capasHTML()}</div></section>`;
      // 3) Construir DEM
      h += `<section class="hp-sec"><h4 class="hp-sec-h">3 · Construir DEM</h4>
        <div class="bp-form">
          <label>Método <select id="bp-metodo">
            <option value="auto">Auto (TIN si existe)</option>
            <option value="tin">Malla TIN</option>
            <option value="curvas">Curvas + puntos</option></select></label>
          <label>Paso [m] <input id="bp-paso" type="number" step="0.5" placeholder="auto"></label>
        </div>
        <button class="hp-run" id="bp-build">🗺️ Construir DEM</button>
        ${this.demM ? this._resumenDEM() : ''}</section>`;
    }

    if (this.demM || this.baseDEM) {
      // 4) Colocar (solo con CAD)
      if (this.demM) h += `<section class="hp-sec"><h4 class="hp-sec-h">4 · Colocar sobre el terreno</h4>
        <p class="hp-note">Arrastra el marcador ✛ en el mapa hasta el punto real. Se coloca a escala (metros exactos), sin depender del huso.</p>
        <div class="bp-btns">
          <button class="bp-b" id="bp-center">🎯 Centrar en tramo</button>
          <button class="bp-b" id="bp-eleva">⛰️ Auto-elevar</button>
          <button class="bp-b" id="bp-fit">🔍 Encuadrar</button>
        </div>
        <div class="hp-kv">
          <div><span>Ancla</span><b>${this.anchor ? this.anchor.lat.toFixed(5) + ', ' + this.anchor.lon.toFixed(5) : '—'}</b></div>
          <div><span>Desfase vertical (dz)</span><b>${f2(this.dz)} m</b></div>
          <div><span>Cotas colocadas</span><b>${this.grid ? f2(this.grid.zmin) + ' – ' + f2(this.grid.zmax) + ' m' : '—'}</b></div>
        </div>
        <div class="bp-btns" style="margin-top:10px">
          <button class="bp-b" id="bp-3d">🏔️ Ver batimetría 3D</button>
          <button class="bp-b" id="bp-fus3d">🗻 Fusionar con relieve + 3D</button>
        </div>
        <span class="hp-dl-status" id="bp-fus-st"></span></section>`;

      // 5) Lienzo hidráulico: motor 1D/2D · geometría compartida · secciones · socavación
      const m2d = this.motor === '2d';
      h += `<section class="hp-sec"><h4 class="hp-sec-h">5 · Hidráulica (secciones · eje · socavación)</h4>
        <div class="bp-motor">
          <span class="bp-motor-lbl">Motor de cálculo</span>
          <div class="seg bp-seg">
            <button class="seg-btn${!m2d ? ' active' : ''}" data-motor="1d" type="button">1D · Manning/remanso</button>
            <button class="seg-btn${m2d ? ' active' : ''}" data-motor="2d" type="button">2D · onda difusiva</button>
          </div>
        </div>
        <div class="bp-geom">
          <div class="hp-mini">Geometría del cauce (se dibuja una vez · compartida 1D↔2D)</div>
          <div class="bp-btns">
            <button class="bp-b" id="bp-eje">${this.eje ? '✓ Eje (' + this.eje.length + ') — redibujar' : '〰 Dibujar eje del cauce'}</button>
            ${this.eje ? '<button class="bp-b" id="bp-eje-clr">✖ Quitar eje</button>' : ''}
            ${m2d ? `<button class="bp-b" id="bp-dom">${this.dominio ? '✓ Dominio (' + this.dominio.length + ') — redibujar' : '▱ Dibujar dominio 2D'}</button>` : ''}
            ${m2d && this.dominio ? '<button class="bp-b" id="bp-dom-clr">✖ Quitar dominio</button>' : ''}
          </div>
          <p class="hp-note">El <b>eje</b> fija la dirección del flujo y ordena las secciones (station a lo largo del cauce).${m2d ? ' En 2D define además dónde se refina la malla; el <b>dominio</b> es el área inundable.' : ' Si no lo dibujas, la dirección se deduce del descenso del lecho.'}</p>
        </div>
        <div class="bp-btns">
          <label style="flex:1">Cauce <select id="bp-cauce-sel">${this.cauces.map((c, i) => `<option value="${i}"${i === this.iCauce ? ' selected' : ''}>${c.nombre} (${c.secciones.length} sec)</option>`).join('')}</select></label>
          <button class="bp-b" id="bp-cauce-new">＋ Nuevo cauce</button>
        </div>
        <div class="bp-form">
          <label>Q [m³/s] <input id="bp-q" type="number" value="${cfg.Q}"></label>
          <label>n Manning <input id="bp-n" type="number" step="0.005" value="${cfg.n}"></label>
          <label>J [m/m] <input id="bp-j" type="number" step="0.001" value="${cfg.J}"></label>
          <label>D50 [mm] <input id="bp-d50" type="number" value="${cfg.D50}"></label>
          <label>D84 [mm] <input id="bp-d84" type="number" placeholder="—"></label>
          <label>Dens. rel. s <input id="bp-sg" type="number" step="0.05" value="${cfg.sg}"></label>
          <label>T [años] <input id="bp-t" type="number" value="${cfg.T}"></label>
          <label>Pila a [m] <input id="bp-pila" type="number" step="0.1" ${cfg.pila > 0 ? `value="${cfg.pila}"` : 'placeholder="s/pila"'}></label>
          <label>Roca [m] bajo lecho <input id="bp-roca" type="number" step="0.5" placeholder="∞"></label>
          <label>Estratos D50:esp <input id="bp-strata" placeholder="ej 5:2, 80:3"></label>
        </div>
        <p class="hp-note"><b>Estratos</b> = macrogranulometría por capas (D50 mm : espesor m, arriba→abajo); <b>Roca</b> = profundidad donde ya no hay socavación. La socavación se calcula POR FRANJAS (la velocidad varía en la sección).</p>
        <p class="hp-note">⬆ Ingresa el <b>caudal Q</b> ANTES de trazar (o usa "Recalcular"). Las secciones deben trazarse <b>sobre el DEM colocado</b> (si no, la profundidad sale falsa). WSE = cota absoluta del agua; la profundidad es WSE − lecho.</p>
        <div class="bp-btns">
          <button class="hp-run" id="bp-draw" style="flex:2">✏️ Trazar sección (clics: extremos + bordes cauce · doble-clic termina)</button>
          ${this.secciones.length ? '<button class="bp-b" id="bp-recalc">↻ Recalcular (Q/n/J)</button>' : ''}
        </div>
        ${this._flujoHTML()}
        <div class="bp-secs">${this._seccionesHTML()}</div>
        ${!m2d ? `<div class="bp-remanso">
          <div class="hp-mini">Eje hidráulico por remanso (todas las secciones · standard step)</div>
          <div class="bp-form">
            <label>Régimen <select id="bp-reg"><option value="auto">Auto</option><option value="sub">Subcrítico</option><option value="super">Supercrítico</option><option value="mixto">Mixto (resalto)</option></select></label>
            <label>WSE borde [m] <input id="bp-wse" type="number" placeholder="normal"></label>
            <label>Cc contracción <input id="bp-cc" type="number" step="0.05" value="${cfg.Cc}"></label>
            <label>Ce expansión <input id="bp-ce" type="number" step="0.05" value="${cfg.Ce}"></label>
          </div>
          <button class="hp-run" id="bp-remanso">🌊 Calcular eje por remanso</button>
          <div id="bp-remanso-out"></div>
        </div>` : this._motor2DHTML()}</section>`;

      // 6) Exportar
      h += `<section class="hp-sec"><h4 class="hp-sec-h">6 · Exportar a HEC-RAS</h4>
        <div class="bp-form">
          <label>Huso <select id="bp-zona"><option value="19">19S</option><option value="18">18S</option></select></label>
          <label>Río <input id="bp-rio" value="Rio" ></label>
          <label>Tramo <input id="bp-reach" value="Tramo"></label>
        </div>
        <div class="bp-btns">
          <button class="bp-b" id="bp-exp-terr">🗺️ Terreno .asc + .prj</button>
          <button class="bp-b" id="bp-exp-sdf">📑 Secciones .sdf</button>
          <button class="bp-b" id="bp-exp-csv">📄 Secciones CSV</button>
          <button class="bp-b" id="bp-exp-dxf">📐 DXF (todo)</button>
        </div>
        <p class="hp-note">El .asc/.sdf salen en UTM con su .prj autoconsistente → HEC-RAS los toma georreferenciados.</p></section>`;
    }

    this.body.innerHTML = h;
    this._wire();
  }

  _resumenDXF() {
    const b = this.res.bbox;
    return `<div class="hp-kv">
      <div><span>Entidades</span><b>${this.res.entidades.length}</b></div>
      <div><span>Capas</span><b>${Object.keys(this.res.capas).length}</b></div>
      <div><span>Extensión</span><b>${f2(b.maxx - b.minx)} × ${f2(b.maxy - b.miny)} m</b></div>
      <div><span>Cotas</span><b>${f2(b.minz)} – ${f2(b.maxz)} m</b></div>
      <div><span>Detección</span><b>${this._det?.motivo?.slice(0, 40) || '—'}</b></div></div>`;
  }
  _capasHTML() {
    const sel = new Set(this.capasSel || []);
    return Object.values(this.res.capas).sort((a, b) => b.n - a.n).map((c) => {
      const tipos = Object.entries(c.tipos).map(([k, v]) => `${v} ${k}`).join(', ');
      const zinfo = c.conZ ? `Z ${f2(c.minZ)}–${f2(c.maxZ)}` : (c.esCota ? 'cotas texto' : 'sin Z');
      return `<label class="bp-capa"><input type="checkbox" data-capa="${c.nombre}" ${sel.has(c.nombre) ? 'checked' : ''}>
        <span class="bp-capa-n">${c.nombre}</span><span class="bp-capa-m">${tipos} · ${zinfo}</span></label>`;
    }).join('');
  }
  _resumenDEM() {
    const d = this.demM;
    return `<div class="hp-kv">
      <div><span>Grilla</span><b>${d.nx} × ${d.ny} (${f2(d.paso)} m)</b></div>
      <div><span>Método</span><b>${d.metodo}${d.nCaras ? ' · ' + d.nCaras + ' caras' : ''}</b></div>
      <div><span>Cotas DEM</span><b>${f2(d.zmin)} – ${f2(d.zmax)} m</b></div></div>`;
  }
  _flujoHTML() {
    const f = this._flujo;
    if (!f || !f.Jmedia) return this.secciones.length ? '<p class="hp-note">Dibuja ≥2 secciones para determinar la dirección del flujo y la pendiente.</p>' : '';
    return `<div class="hp-kv" style="margin:6px 0">
      <div><span>Dirección del flujo (${f.invertido ? 'invertida' : (f.viaEje ? 'según eje' : 'desde el terreno')})</span><b>${f.arriba.nombre} → ${f.abajo.nombre}</b></div>
      <div><span>Lecho arriba → abajo</span><b>${f2(f.arriba._thalweg)} → ${f2(f.abajo._thalweg)} m</b></div>
      <div><span>Pendiente media J</span><b>${(f.Jmedia * 100).toFixed(2)} % (${f.Jmedia.toFixed(4)})</b></div></div>
      <button class="bp-b" id="bp-inv-flujo" style="width:100%">⇄ Invertir dirección del flujo</button>
      <p class="hp-note">La flecha grande (coral) en el mapa marca la dirección; clic en ella o en este botón para invertirla. J = caída/longitud (puedes sobrescribirlo arriba).</p>`;
  }
  _seccionesHTML() {
    if (!this.secciones.length) return '<p class="hp-note">Sin secciones. Traza una con el botón de arriba.</p>';
    return this.secciones.map((s, i) => `<div class="bp-sec-card" data-sec="${i}">
      <div class="bp-sec-h"><b>${s.nombre}</b>
        <label style="font-size:11px;color:var(--text2)">K local <input type="number" step="0.1" value="${s.kLoc || 0}" data-kloc="${i}" style="width:52px"></label>
        <button class="bp-sec-del" data-del="${i}">🗑</button></div>
      ${s.fuera > 0.15 ? `<p class="hp-note" style="color:var(--red)">⚠ ${Math.round(s.fuera * 100)}% de la sección cae FUERA del DEM colocado → profundidad no confiable. Vuelve a trazarla sobre el DEM.</p>` : ''}
      ${this._svgSeccion(s)}
      <div class="hp-kv">
        <div><span>Profundidad máx</span><b class="bp-hot">${f2(s.res.profMax)} m</b></div>
        <div><span>WSE (cota abs.) · Ancho</span><b>${f2(s.res.WSE)} m · ${f2(s.res.B)} m</b></div>
        <div><span>V · Fr</span><b>${f2(s.res.V)} m/s · ${f2(s.res.Fr)} (${s.res.regimen})</b></div>
        <div><span>Por franjas · LL · Neill</span><b>${f2(s.soc.franjas?.socavMaxLL)} · ${f2(s.soc.franjas?.socavMaxNeill)} m</b></div>
        <div><span>Vel. media (sección) · LL · Neill</span><b>${f2(s.soc.general.socavMax)} · ${f2(s.soc.generalNeill?.socav)} m</b></div>
        <div><span>Franja más crítica (v máx ${f2(s.soc.franjas?.vMax)} m/s · ${s.soc.franjas?.fuenteV === '2D' ? '🌐 campo 2D' : '1D conveyance'})</span><b>en s=${f2(s.soc.franjas?.sLoc)} m${s.soc.franjas?.roca ? ' · roca ' + f2(s.soc.franjas.roca) + ' m' : ''}</b></div>
        <div><span>General adoptada (máx)</span><b>${f2(s.soc.generalAdoptada)} m</b></div>
        <div><span>Socav. total (gen + local adopt.)</span><b class="bp-hot">${f2(s.soc.socavTotal)} m</b></div>
        <div><span>Neill</span><b>${s.soc.neill.lechoVivo ? 'lecho vivo' : 'agua clara'} (Vc ${f2(s.soc.neill.Vc)})</b></div>
      </div>
      ${s.obstr ? `<div class="hp-kv"><div><span>🌉 Angostado por pilas (Σ ${f2(s.obstr.bPila)} m)</span><b class="bp-hot">B ${f2(s.res.B)}→${f2(s.obstr.Bef)} m · V→${f2(s.obstr.Vobs)} m/s</b></div></div>` : ''}
      ${s.obstrTablero ? `<p class="hp-note"${s.obstrTablero.sumergido ? ' style="color:var(--red)"' : ''}>🌉 Tablero: cota inferior ${f2(s.obstrTablero.zSoffit)} m — ${s.obstrTablero.sumergido ? 'la WSE la SUPERA → flujo a presión / inefectivo arriba' : 'agua por debajo del tablero (flujo libre)'}</p>` : ''}
      ${s.pilaAuto ? '<p class="hp-note">Ancho de pila tomado de una estructura que cruza la sección.</p>' : ''}
      ${s.soc.metodosPila ? this._metodosPilaHTML(s.soc.metodosPila) : '<p class="hp-note">Ingresa el ancho de pila (arriba) o coloca una pila que cruce la sección para la socavación local (varios métodos del MC).</p>'}
      </div>`).join('');
  }
  // Tabla comparativa de socavación LOCAL en pila (varios métodos del MC).
  _metodosPilaHTML(m) {
    const row = (n, v) => `<tr${v === m.max ? ' style="color:var(--red);font-weight:700"' : ''}><td>${n}</td><td>${f2(v)} m</td></tr>`;
    return `<div class="hp-mini">Socavación local en pila · métodos MC</div>
      <table class="hp-tbl"><tbody>
        ${row('HEC-18 / CSU', m.csu)}${row('Froehlich', m.froehlich)}${row('Laursen-Toch', m.laursenToch)}${row('Breusers', m.breusers)}${row('Larras', m.larras)}
        <tr><td><b>Adoptada (envolvente)</b></td><td><b>${f2(m.max)} m</b></td></tr>
        <tr><td>Promedio</td><td>${f2(m.prom)} m</td></tr>
      </tbody></table>`;
  }

  // ── Wiring de eventos ────────────────────────────────────────────────────────
  _wire() {
    const $ = (id) => this.body.querySelector(id);
    $('#bp-file')?.addEventListener('change', (e) => this._onFile(e.target.files[0]));
    this.body.querySelectorAll('[data-capa]').forEach((cb) => cb.addEventListener('change', () => {
      this.capasSel = [...this.body.querySelectorAll('[data-capa]:checked')].map((x) => x.dataset.capa);
    }));
    $('#bp-build')?.addEventListener('click', () => this._construir());
    $('#bp-usardem')?.addEventListener('click', () => this._usarDEMbase());
    $('#bp-center')?.addEventListener('click', () => this._centrar());
    $('#bp-eleva')?.addEventListener('click', () => this._autoElevar());
    $('#bp-fit')?.addEventListener('click', () => this.map?.fitBati());
    $('#bp-3d')?.addEventListener('click', () => this._ver3Dclick());
    $('#bp-fus3d')?.addEventListener('click', () => this._verFusion3D());
    $('#bp-draw')?.addEventListener('click', () => this._toggleDraw());
    $('#bp-j')?.addEventListener('input', () => { this._jManual = true; });
    $('#bp-recalc')?.addEventListener('click', () => this._recalcularSecciones());
    $('#bp-inv-flujo')?.addEventListener('click', () => this._invertirFlujo());
    $('#bp-remanso')?.addEventListener('click', () => this._runRemanso());
    $('#bp-cauce-sel')?.addEventListener('change', (e) => this._selCauce(+e.target.value));
    $('#bp-cauce-new')?.addEventListener('click', () => this._nuevoCauce());
    this.body.querySelectorAll('[data-motor]').forEach((b) => b.addEventListener('click', () => {
      if (this.motor === b.dataset.motor) return;
      this.motor = b.dataset.motor; this._render(); this._dibujarSecciones();
    }));
    $('#bp-eje')?.addEventListener('click', () => this._dibujarEjeDraw());
    $('#bp-eje-clr')?.addEventListener('click', () => { this.eje = null; this._quitarEjeLayer(); this._actualizarFlujo(); this._render(); this._dibujarSecciones(); });
    $('#bp-dom')?.addEventListener('click', () => this._dibujarDominioDraw());
    $('#bp-dom-clr')?.addEventListener('click', () => { this.dominio = null; this.mesh2d = null; this.result2d = null; this.map?.clearMalla2D?.(); this._render(); this._dibujarSecciones(); });
    $('#bp-2d-gen')?.addEventListener('click', () => this._generar2D());
    $('#bp-2d-sim')?.addEventListener('click', () => this._simular2D());
    $('#bp-2d-samp')?.addEventListener('click', () => this._muestrear2DenSecciones());
    $('#bp-exp-terr')?.addEventListener('click', () => this._expTerreno());
    $('#bp-exp-sdf')?.addEventListener('click', () => this._expSDF());
    $('#bp-exp-csv')?.addEventListener('click', () => this._expCSV());
    $('#bp-exp-dxf')?.addEventListener('click', () => { try { descargar(`${this.nombre || 'koi-flow'}_estudio.dxf`, exportarDXF(this), 'application/dxf'); } catch (e) { alert(e.message); } });
    this.body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      this.secciones.splice(+b.dataset.del, 1); this._refreshSecciones(); this._dibujarSecciones();
    }));
    this.body.querySelectorAll('[data-kloc]').forEach((inp) => inp.addEventListener('change', () => {
      const i = +inp.dataset.kloc; if (this.secciones[i]) this.secciones[i].kLoc = parseFloat(inp.value) || 0;
    }));
  }

  async _onFile(file) {
    if (!file) return;
    this.body.querySelector('.hp-sec').insertAdjacentHTML('beforeend', '<p class="hp-note" id="bp-ld">Leyendo DXF…</p>');
    try {
      this.res = await leerDXF(file);
      this.nombre = file.name.replace(/\.dxf$/i, '');
      const sug = sugerirCapas(this.res);
      this.capasSel = sug.terreno;
      // detección de sistema (para pista de huso)
      const pts = []; for (const e of this.res.entidades) for (const p of e.puntos) pts.push(p);
      this._det = detectarSistema(pts.slice(0, 30000));
      this.demM = this.grid = null;
      this.eje = null; this.dominio = null; this.mesh2d = null; this.result2d = null; this._quitarEjeLayer();
      this.cauces = [{ nombre: 'Cauce 1', secciones: [] }]; this.iCauce = 0; this.secciones = this.cauces[0].secciones;
      this._render();
    } catch (err) { alert('No se pudo leer el DXF: ' + err.message); }
  }

  _construir() {
    if (!this.capasSel?.length) { alert('Elige al menos una capa de terreno.'); return; }
    const metodo = this.body.querySelector('#bp-metodo').value;
    const paso = parseFloat(this.body.querySelector('#bp-paso').value) || undefined;
    try {
      this.demM = construirDEMmetrico(this.res, this.capasSel, { metodo, paso, usarCotasTexto: true });
      this.modo = 'cad';
    } catch (err) { alert(err.message); return; }
    // ancla inicial: centro del tramo activo, o centro del mapa
    const c = this.tramo ? this._centroTramo(this.tramo) : this._centroMapa();
    this.anchor = anclaInicial(c);
    this.dz = 0;
    this._recolocar();
    this.map?.fitBati();
    this._render();
    this.open();
    this._syncCapas();
  }

  _recolocar() {
    if (!this.demM || !this.anchor) return;
    this.grid = demMetricoAGrid(this.demM, this.anchor, this.dz);
    const fp = footprint(this.demM, this.anchor);
    const overlay = this._overlay();
    if (!this._batiShown) {
      this.map?.showBati({ footprint: fp, anchor: this.anchor, overlay }, (a, dragging) => this._onMove(a, dragging));
      this._batiShown = true;
    } else {
      this.map?.updateBati({ footprint: fp, overlay });
    }
    this._dibujarSecciones();
  }

  _onMove(anchor, dragging) {
    this.anchor = anchor;
    this.grid = demMetricoAGrid(this.demM, this.anchor, this.dz);
    this.map?.updateBati({ footprint: footprint(this.demM, this.anchor), overlay: this._overlay() });
    if (!dragging) { this._dibujarSecciones(); this._render(); }
  }

  _centrar() {
    const c = this.tramo ? this._centroTramo(this.tramo) : this._centroMapa();
    this.anchor = anclaInicial(c);
    this.map?.showBati({ footprint: footprint(this.demM, this.anchor), anchor: this.anchor, overlay: this._overlay() },
      (a, d) => this._onMove(a, d));
    this._recolocar(); this.map?.fitBati(); this._render();
  }

  async _autoElevar() {
    if (!this.anchor) return;
    const btn = this.body.querySelector('#bp-eleva'); if (btn) { btn.disabled = true; btn.textContent = '⛰️ …'; }
    try {
      const m = 0.004;
      const bbox = { west: this.anchor.lon - m, east: this.anchor.lon + m, south: this.anchor.lat - m, north: this.anchor.lat + m };
      const base = await fetchDEM(bbox, { maxDim: 128 });
      this.dz = autoElevar(this.demM, this.anchor, (lon, lat) => elevAt(base, lon, lat));
      this._recolocar(); this._render();
    } catch (err) { alert('No se pudo bajar el relieve base para auto-elevar: ' + err.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '⛰️ Auto-elevar'; } }
  }

  _ver3Dclick() {
    if (!this.grid) return;
    this.scene?.loadSectorGrid(this.grid, this.tramo?.feature);
    this._ver3D?.();   // boot cambia a modo 3D
  }

  // Fusiona la batimetría con el relieve base (Terrarium) y la muestra en 3D:
  // el cauce/topografía CAD queda embebido en los cerros del entorno.
  async _verFusion3D() {
    if (!this.demM || !this.anchor) return;
    const st = this.body.querySelector('#bp-fus-st');
    if (st) st.textContent = ' bajando relieve base…';
    try {
      // bbox del footprint + margen (para bajar el DEM base que lo rodea)
      const fp = footprint(this.demM, this.anchor);
      let w = 180, s = 90, e = -180, n = -90;
      for (const [lon, lat] of fp) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
      const mLon = (e - w) * 0.8, mLat = (n - s) * 0.8;
      const base = await fetchDEM({ west: w - mLon, east: e + mLon, south: s - mLat, north: n + mLat }, { maxDim: 400 });
      if (st) st.textContent = ' fusionando…';
      this.fused = fusionar(base, this.demM, this.anchor, this.dz, { margen: 0.6, feather: 20, maxDim: 700 });
      this.scene?.loadSectorGrid(this.fused, this.tramo?.feature);
      this._ver3D?.();
      if (st) st.textContent = ` ✓ fusionado (${this.fused.nx}×${this.fused.ny}, ${(this.fused.zmax - this.fused.zmin).toFixed(0)} m de relieve)`;
    } catch (err) { if (st) st.textContent = ' ✗ ' + err.message; console.error(err); }
  }

  // ── Colormap + hillshade → imageOverlay ──────────────────────────────────────
  _overlay() {
    if (!this.demM) return null;
    const { nx, ny, data, dx, dy } = this.demM;
    const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(nx, ny);
    const zmin = this.demM.zmin, zmax = this.demM.zmax, rng = (zmax - zmin) || 1;
    for (let r = 0; r < ny; r++) {
      const rr = ny - 1 - r;                         // fila 0 = norte en el canvas
      for (let c = 0; c < nx; c++) {
        const i = rr * nx + c, o = (r * nx + c) * 4;
        const t = (data[i] - zmin) / rng;
        const [R, G, B] = this._ramp(t);
        // hillshade simple
        const zl = data[rr * nx + Math.max(0, c - 1)], zr = data[rr * nx + Math.min(nx - 1, c + 1)];
        const zu = data[Math.min(ny - 1, rr + 1) * nx + c], zd = data[Math.max(0, rr - 1) * nx + c];
        const sx = (zl - zr) / (2 * dx), sy = (zd - zu) / (2 * dy);
        const sh = Math.max(0.35, Math.min(1.2, 0.75 + 0.9 * (sx + sy)));
        img.data[o] = Math.min(255, R * sh); img.data[o + 1] = Math.min(255, G * sh);
        img.data[o + 2] = Math.min(255, B * sh); img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const b = this.grid.bbox;
    return { url: cv.toDataURL(), bounds: [[b.south, b.west], [b.north, b.east]], opacity: 0.78 };
  }
  _ramp(t) {   // terreno: azul→verde→amarillo→marrón
    t = Math.max(0, Math.min(1, t));
    const stops = [[0, [40, 90, 160]], [0.25, [70, 150, 90]], [0.5, [180, 190, 90]], [0.75, [150, 110, 60]], [1, [235, 235, 235]]];
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], u = (t - a) / (b - a);
      return ca.map((v, k) => v + u * (cb[k] - v));
    }
    return stops[stops.length - 1][1];
  }

  // ── Eje del cauce + dominio 2D (geometría compartida del lienzo) ─────────────
  _dibujarEjeDraw() {
    if (this.map.enDibujo()) { this.map.cancelarDibujo(); this._render(); return; }
    this.map.dibujar('line', '#a855f7', (pts) => {
      if (!pts || pts.length < 2) { this._render(); return; }
      this.eje = pts; this._dibujarEje(); this._actualizarFlujo(); this._render(); this._dibujarSecciones(); this._syncCapas();
    });
    this._render();
  }
  _dibujarDominioDraw() {
    if (this.map.enDibujo()) { this.map.cancelarDibujo(); this._render(); return; }
    this.map.dibujar('poly', '#22c55e', (pts) => {
      if (!pts || pts.length < 3) { this._render(); return; }
      this.dominio = pts; this.map.showMalla2D?.({ dominio: this.dominio, cauce: this.eje }); this._render(); this._dibujarSecciones(); this._syncCapas();
    });
    this._render();
  }
  // Inserta un vértice [lon,lat] en el segmento más cercano de arr; devuelve su índice.
  _insertarVertice(arr, latlng) {
    const p = [latlng.lng, latlng.lat]; if (arr.length < 2) { arr.push(p); return arr.length - 1; }
    const mx = 111320 * Math.cos(latlng.lat * Math.PI / 180), my = 110540, px = p[0] * mx, py = p[1] * my;
    let best = Infinity, bi = 1;
    for (let i = 0; i < arr.length - 1; i++) {
      const ax = arr[i][0] * mx, ay = arr[i][1] * my, dx = arr[i + 1][0] * mx - ax, dy = arr[i + 1][1] * my - ay, L2 = dx * dx + dy * dy || 1;
      let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); if (d < best) { best = d; bi = i + 1; }
    }
    arr.splice(bi, 0, p); return bi;
  }

  _dibujarEje() {
    const L = window.L; if (!L || !this.map?.map) return;
    this._quitarEjeLayer();
    if (!this.eje || this.eje.length < 2) return;
    this._ejeGroup = L.layerGroup().addTo(this.map.map);
    this._ejePoly = L.polyline(this.eje.map(([lo, la]) => [la, lo]), { color: '#a855f7', weight: 3, dashArray: '7 5' })
      .bindTooltip('Eje · doble-clic = agregar vértice; clic-derecho en un vértice = borrar', { sticky: true });
    // doble-clic sobre el eje → agrega un vértice
    this._ejePoly.on('dblclick', (e) => { window.L.DomEvent.stop(e); this._insertarVertice(this.eje, e.latlng); this._actualizarFlujo(); this._render(); this._dibujarSecciones(); this._syncCapas(); });
    this._ejeGroup.addLayer(this._ejePoly);
    this.eje.forEach((pt, v) => {
      const icon = L.divIcon({ className: 'koi-sec-vtx', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
      const mk = L.marker([pt[1], pt[0]], { icon, draggable: true, zIndexOffset: 650 }).bindTooltip(`Eje · vértice ${v + 1} (arrastra · clic-derecho borra)`, { direction: 'top' });
      mk.on('drag', () => { const ll = mk.getLatLng(); this.eje[v] = [ll.lng, ll.lat]; this._ejePoly.setLatLngs(this.eje.map(([lo, la]) => [la, lo])); });
      mk.on('dragend', () => { const ll = mk.getLatLng(); this.eje[v] = [ll.lng, ll.lat]; this._actualizarFlujo(); this._render(); this._dibujarSecciones(); this._syncCapas(); });
      mk.on('contextmenu', (e) => { window.L.DomEvent.stop(e); if (this.eje.length > 2) { this.eje.splice(v, 1); this._actualizarFlujo(); this._render(); this._dibujarSecciones(); this._syncCapas(); } });
      this._ejeGroup.addLayer(mk);
    });
  }
  _quitarEjeLayer() {
    if (this._ejeGroup) { this._ejeGroup.remove(); this._ejeGroup = null; }
    if (this._ejeLayer) { this._ejeLayer.remove(); this._ejeLayer = null; }
  }

  // Invierte la dirección del flujo (aguas arriba ↔ abajo).
  _invertirFlujo() {
    this._flujoInvert = !this._flujoInvert;
    this._actualizarFlujo();
    this._render(); this._dibujarSecciones();
  }

  // Flecha grande (coral) que marca la dirección del flujo; clic = invertir.
  _dibujarFlecha() {
    const L = window.L; if (!L || !this.map?.map) return;
    if (this._flechaLayer) { this._flechaLayer.remove(); this._flechaLayer = null; }
    const fl = this._flujo; if (!fl || !fl.arriba || !fl.abajo || fl.arriba === fl.abajo || !fl.arriba.linea) return;
    const midLL = (s) => { const a = s.linea[0], b = s.linea[s.linea.length - 1]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    const from = midLL(fl.arriba), to = midLL(fl.abajo);
    const la = (from[1] + to[1]) / 2, mx = 111320 * Math.cos(la * Math.PI / 180), my = 110540;
    const dx = (to[0] - from[0]) * mx, dy = (to[1] - from[1]) * my, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const hs = Math.min(len * 0.22, 80), px = -uy, py = ux;
    const b1 = [to[0] - (ux * hs - px * hs * 0.55) / mx, to[1] - (uy * hs - py * hs * 0.55) / my];
    const b2 = [to[0] - (ux * hs + px * hs * 0.55) / mx, to[1] - (uy * hs + py * hs * 0.55) / my];
    const g = L.layerGroup().addTo(this.map.map);
    const shaft = L.polyline([[from[1], from[0]], [to[1], to[0]]], { color: '#ef6c5a', weight: 6, opacity: 0.92 });
    const head = L.polygon([[to[1], to[0]], [b1[1], b1[0]], [b2[1], b2[0]]], { color: '#ef6c5a', weight: 1, fillColor: '#ef6c5a', fillOpacity: 0.95 });
    const tip = 'Dirección del flujo (clic para invertir)';
    shaft.bindTooltip(tip, { sticky: true }); head.bindTooltip(tip, { sticky: true });
    const inv = (e) => { window.L.DomEvent.stop(e); this._invertirFlujo(); };
    shaft.on('click', inv); head.on('click', inv);
    g.addLayer(shaft); g.addLayer(head);
    this._flechaLayer = g;
  }

  // Vértices arrastrables del DOMINIO 2D (el contorno lo dibuja showMalla2D).
  _dibujarDominioEdit() {
    const L = window.L; if (!L || !this.map?.map) return;
    if (this._domGroup) { this._domGroup.remove(); this._domGroup = null; }
    if (this.motor !== '2d' || !this.dominio || this.dominio.length < 3) return;
    this._domGroup = L.layerGroup().addTo(this.map.map);
    this.dominio.forEach((pt, v) => {
      const icon = L.divIcon({ className: 'koi-sec-vtx dom', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
      const mk = L.marker([pt[1], pt[0]], { icon, draggable: true, zIndexOffset: 640 }).bindTooltip(`Dominio · vértice ${v + 1} (arrastra)`, { direction: 'top' });
      mk.on('drag', () => { const ll = mk.getLatLng(); this.dominio[v] = [ll.lng, ll.lat]; this.map.showMalla2D?.({ dominio: this.dominio, cauce: this.eje }); });
      mk.on('dragend', () => { const ll = mk.getLatLng(); this.dominio[v] = [ll.lng, ll.lat]; this.mesh2d = null; this.result2d = null; this.map.showMalla2D?.({ dominio: this.dominio, cauce: this.eje }); this._render(); this._dibujarSecciones(); this._syncCapas(); });
      this._domGroup.addLayer(mk);
    });
  }

  // Sincroniza la barra izquierda (capas) cuando cambia la geometría/GIS creado.
  _syncCapas() { window.__koi?.capas?.render?.(); }

  // ── Borrado de GIS creado (desde la barra izquierda o el panel) ───────────────
  borrarDEM() { this.demM = null; this.grid = null; this.fused = null; this._batiShown = false; this.map?.clearBati?.(); this._quitarEjeLayer(); this._render(); this._syncCapas(); }
  borrarEje() {
    this.eje = null; this._quitarEjeLayer();
    // el cauce también se dibuja en la capa 2D (showMalla2D) → refréscala sin cauce
    if (this.dominio || this.mesh2d) this.map?.showMalla2D?.({ dominio: this.dominio, cauce: null, mesh: this.mesh2d });
    if (this.secciones?.length) this._actualizarFlujo();
    this._render(); this._dibujarSecciones(); this._syncCapas();
  }
  borrarDominio() { this.dominio = null; this.mesh2d = null; this.result2d = null; if (this._domGroup) { this._domGroup.remove(); this._domGroup = null; } this.map?.clearMalla2D?.(); this._render(); this._dibujarSecciones(); this._syncCapas(); }
  borrarMalla() { this.mesh2d = null; this.result2d = null; this.map?.clearMalla2D?.(); if (this.dominio) this.map?.showMalla2D?.({ dominio: this.dominio, cauce: this.eje }); this._render(); this._syncCapas(); }

  // ── Motor 2D (onda difusiva) integrado en el lienzo ──────────────────────────
  _motor2DHTML() {
    const m = this.mesh2d, r = this.result2d, cfg = getConfig();
    return `<div class="bp-2d">
      <div class="hp-mini">Malla y simulación 2D (onda difusiva · usa el eje como cauce)</div>
      ${this.dominio ? '' : '<p class="hp-note" style="color:var(--red)">Dibuja el <b>dominio 2D</b> (arriba) para poder mallar.</p>'}
      <p class="hp-note">Para mejor batimetría del cauce, primero <b>🗻 Fusionar con relieve</b> (paso 4); si no, se usa el relieve base de la zona.</p>
      <div class="bp-form">
        <label>h cauce [m] <input id="f2-hc" type="number" value="${cfg.hCauce}"></label>
        <label>h planicie [m] <input id="f2-hp" type="number" value="${cfg.hPlanicie}"></label>
        <label>Ancho cauce [m] <input id="f2-ac" type="number" value="${cfg.anchoCauce}"></label>
        <label>n cauce <input id="f2-nc" type="number" step="0.005" value="${cfg.n}"></label>
        <label>n planicie <input id="f2-np" type="number" step="0.005" value="${cfg.nPlanicie}"></label>
      </div>
      <button class="hp-run" id="bp-2d-gen">🌐 Generar malla 2D</button>
      <span class="hp-dl-status" id="bp-2d-st"></span>
      ${m ? this._stats2DHTML(m) : ''}
      ${m ? `<div class="bp-form" style="margin-top:8px">
        <label>WSE salida [m] <input id="f2-so" type="number" placeholder="auto"></label>
        <label>Δt [s] <input id="f2-dt" type="number" value="60"></label>
        <label>Pasos máx <input id="f2-steps" type="number" value="300"></label>
      </div>
      <button class="hp-run" id="bp-2d-sim">▶ Simular 2D (Q del formulario)</button>
      <span class="hp-dl-status" id="bp-2d-simst"></span>
      <div id="bp-2d-res"></div>` : ''}
      ${r ? `<button class="hp-run" id="bp-2d-samp" style="margin-top:8px">📥 Muestrear v en las secciones → socavación</button>
      <p class="hp-note">Toma la profundidad y la velocidad del campo 2D a lo largo de cada sección y recalcula la socavación por franjas con la <b>velocidad real</b> (no el reparto 1D).</p>` : ''}
    </div>`;
  }
  _stats2DHTML(m) {
    return `<div class="hp-kv" style="margin-top:10px">
      <div><span>Nodos · triángulos</span><b>${m.meta.nNodos} · ${m.meta.nTri}</b></div>
      <div><span>Área dominio</span><b>${(m.meta.area_m2 / 1e4).toFixed(2)} ha</b></div>
      <div><span>Cotas malla</span><b>${f2(m._zmin)} – ${f2(m._zmax)} m</b></div>
      <div><span>Resolución (cauce/plan.)</span><b>${m.meta.hCauce} / ${m.meta.hPlanicie} m</b></div></div>`;
  }

  async _generar2D() {
    const st = this.body.querySelector('#bp-2d-st');
    if (!this.dominio) { if (st) st.textContent = ' dibuja el dominio 2D primero'; return; }
    const opts = {
      hCauce: +this.body.querySelector('#f2-hc').value || 8,
      hPlanicie: +this.body.querySelector('#f2-hp').value || 40,
      anchoCauce: +this.body.querySelector('#f2-ac').value || 30,
      nCauce: +this.body.querySelector('#f2-nc').value || 0.035,
      nPlanicie: +this.body.querySelector('#f2-np').value || 0.06,
    };
    if (st) st.textContent = ' obteniendo DEM…';
    try {
      let w = 180, s = 90, e = -180, n = -90;
      for (const [lo, la] of this.dominio) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
      const mLon = (e - w) * 0.15, mLat = (n - s) * 0.15;
      let dem = this.fused || this.baseDEM || await fetchDEM({ west: w - mLon, east: e + mLon, south: s - mLat, north: n + mLat }, { maxDim: 400 });
      // Estructuras sólidas → se "queman" en el DEM (Higher value) antes de mallar,
      // igual que la modificación de terreno de HEC-RAS: el flujo las rodea.
      const estrs = window.__koi?.estr?.estructuras || [];
      const nSol = estrs.filter((e) => e.solido).length;
      if (nSol) { dem = stampTerreno(dem, estrs); if (st) st.textContent = ` estampando ${nSol} estructura(s)…`; }
      if (st) st.textContent = ' mallando…';
      const mesh = construirMalla2D(this.dominio, this.eje, dem, opts);
      let zmin = Infinity, zmax = -Infinity;
      for (const nd of mesh.nodes) { if (nd.z < zmin) zmin = nd.z; if (nd.z > zmax) zmax = nd.z; }
      mesh._zmin = zmin; mesh._zmax = zmax;
      this.mesh2d = mesh; this.result2d = null;
      this.map?.showMalla2D?.({ dominio: this.dominio, cauce: this.eje, mesh });
      if (st) st.textContent = '';
      this._render(); this._syncCapas();
    } catch (err) { if (st) st.textContent = ' ✗ ' + err.message; console.error(err); }
  }

  // entrada/salida = nodos de borde cerca de los extremos del EJE.
  _bordes2D(mesh) {
    const c = mesh.cauceXY, R = Math.max(mesh.meta.anchoCauce, 50);
    if (!c || c.length < 2) return { entrada: [], salida: [] };
    const near = (px, py) => mesh.nodes.filter((nd) => nd.borde && Math.hypot(nd.x - px, nd.y - py) <= R).map((nd) => nd.i);
    return { entrada: near(c[0][0], c[0][1]), salida: near(c[c.length - 1][0], c[c.length - 1][1]) };
  }

  async _simular2D() {
    const st = this.body.querySelector('#bp-2d-simst');
    if (!this.mesh2d) { if (st) st.textContent = ' genera la malla primero'; return; }
    if (!this.eje || this.eje.length < 2) { if (st) st.textContent = ' dibuja el eje (define entrada/salida)'; return; }
    const { entrada, salida } = this._bordes2D(this.mesh2d);
    if (!entrada.length || !salida.length) { if (st) st.textContent = ' el eje debe tocar el borde del dominio (entrada/salida)'; return; }
    const Q = +this.body.querySelector('#bp-q').value || 100;
    const so = parseFloat(this.body.querySelector('#f2-so').value);
    const dt = +this.body.querySelector('#f2-dt').value || 60;
    const nPasos = +this.body.querySelector('#f2-steps').value || 300;
    if (st) st.textContent = ' resolviendo…';
    await new Promise((r) => setTimeout(r, 20));
    try {
      const r = resolver2D(this.mesh2d, { Q, entrada, salida, stageSalida: isFinite(so) ? so : undefined, dt, nPasos, onProgress: (p, N, d) => { if (st) st.textContent = ` paso ${p}/${N} (Δ=${d.toExponential(1)})`; } });
      r.mesh = this.mesh2d; this.result2d = r;
      this.map?.showInundacion?.(this.mesh2d, r.h, { cauce: this.eje });
      if (st) st.textContent = r.convergio ? ` ✓ permanente en ${r.pasos} pasos` : ` ${r.pasos} pasos (Δ=${r.cambio.toExponential(1)})`;
      const res = this.body.querySelector('#bp-2d-res');
      if (res) res.innerHTML = `<div class="hp-kv" style="margin-top:8px">
        <div><span>Calado máximo</span><b>${f2(r.hmax)} m</b></div>
        <div><span>Velocidad máxima</span><b>${f2(r.Vmax)} m/s</b></div>
        <div><span>Nodos mojados</span><b>${r.nMojados} / ${this.mesh2d.nodes.length}</b></div></div>`;
      this._render();
    } catch (e) { if (st) st.textContent = ' ✗ ' + e.message; console.error(e); }
  }

  // Muestrea (h, |V|) del campo 2D a lo largo de cada sección y recalcula la
  // socavación por franjas con la VELOCIDAD REAL (acople 2D→socavación).
  _muestrear2DenSecciones() {
    const R = this.result2d; if (!R || !this.secciones.length) return;
    let nOk = 0;
    for (const s of this.secciones) {
      const prof = this._perfilVelocidad2D(s, R);
      if (prof && prof.some((p) => p.v > 0)) { s._v2d = prof.map((p) => ({ s: p.s, v: p.v })); nOk++; }
      else s._v2d = null;
      // WSE del campo 2D = máx superficie de agua entre los puntos mojados de la sección
      const wet = (prof || []).filter((p) => p.h > 0.02 && isFinite(p.H));
      s._wse2d = wet.length ? Math.max(...wet.map((p) => p.H)) : null;
      this._calcSeccionEje(s);
    }
    const st = this.body.querySelector('#bp-2d-simst');
    if (st) st.textContent = ` ✓ ${nOk}/${this.secciones.length} secciones con velocidad 2D`;
    this._render(); this._dibujarSecciones();
  }

  // Perfil de velocidad/calado del campo 2D a lo largo de la sección s → [{s,v,h}].
  _perfilVelocidad2D(s, R) {
    const mesh = R.mesh, nodes = mesh.nodes, tris = mesh.tris, Vn = R.V, hn = R.h, Hn = R.H;
    const { lon0, lat0, mLon, mLat } = mesh.origin;
    const sample = (lon, lat) => {
      const x = (lon - lon0) * mLon, y = (lat - lat0) * mLat;
      for (const t of tris) {
        const a = nodes[t[0]], b = nodes[t[1]], c = nodes[t[2]];
        const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        if (Math.abs(det) < 1e-9) continue;
        const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
        const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 >= -1e-3 && l2 >= -1e-3 && l3 >= -1e-3) {
          return { v: l1 * Vn[t[0]] + l2 * Vn[t[1]] + l3 * Vn[t[2]], h: l1 * hn[t[0]] + l2 * hn[t[1]] + l3 * hn[t[2]], H: Hn ? l1 * Hn[t[0]] + l2 * Hn[t[1]] + l3 * Hn[t[2]] : null };
        }
      }
      return null;
    };
    // recorre la polilínea de la sección (lonlat) en las mismas estaciones que s.pts
    const line = s.linea; if (!line || line.length < 2) return null;
    const midlat = line[0][1], mx = 111320 * Math.cos(midlat * Math.PI / 180), my = 110540;
    const P = line.map(([lo, la]) => [lo * mx, la * my]);
    const cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = cum[cum.length - 1] || 1;
    const llAt = (frac) => {
      const d = frac * total; let j = 1; while (j < cum.length - 1 && cum[j] < d) j++;
      const t = (d - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
      return [line[j - 1][0] + t * (line[j][0] - line[j - 1][0]), line[j - 1][1] + t * (line[j][1] - line[j - 1][1])];
    };
    const sMax = s.pts[s.pts.length - 1].s || 1;
    return s.pts.map((p) => { const [lo, la] = llAt(p.s / sMax); const f = sample(lo, la); return { s: p.s, v: f ? Math.max(0, f.v) : 0, h: f ? f.h : 0, H: f ? f.H : null }; });
  }

  // Propiedades hidráulicas de la sección para una WSE dada (integración trapezoidal).
  _propsWSE(pts, WSE) {
    let A = 0, B = 0, pmax = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const x1 = pts[i].s, z1 = pts[i].z, x2 = pts[i + 1].s, z2 = pts[i + 1].z;
      const d1 = WSE - z1, d2 = WSE - z2; if (d1 <= 0 && d2 <= 0) continue;
      let xa = x1, xb = x2, ha = Math.max(0, d1), hb = Math.max(0, d2);
      if (d1 < 0) { const t = d1 / (d1 - d2); xa = x1 + t * (x2 - x1); ha = 0; }
      if (d2 < 0) { const t = d1 / (d1 - d2); xb = x1 + t * (x2 - x1); hb = 0; }
      A += (ha + hb) / 2 * (xb - xa); B += (xb - xa); pmax = Math.max(pmax, ha, hb);
    }
    return { A, B, profMax: pmax };
  }

  // ── Trazado de secciones sobre el mapa ───────────────────────────────────────
  _toggleDraw() {
    if (this.map.enDibujo()) { this.map.cancelarDibujo(); this._render(); return; }
    // N puntos: extremos (bancas) + los bordes del cauce; doble-clic/Esc para terminar.
    // 4 clics (extremos + 2 bordes del cauce) → termina solo y persiste la sección.
    this.map.dibujar('line', '#22d3ee', (pts) => { this._crearSeccion(pts); this._render(); }, { maxPts: 4 });
    this._render();
  }

  // Muestrea el perfil a lo largo de la polilínea de N puntos (extremos + bordes de cauce).
  _muestrearSeccion(s) {
    const d = this.demM;
    const V = s.linea.map(([lo, la]) => metricoDesdeLonLat(d, this.anchor, lo, la));
    const seg = [0];
    for (let i = 1; i < V.length; i++) seg.push(seg[i - 1] + Math.hypot(V[i].x - V[i - 1].x, V[i].y - V[i - 1].y));
    const largo = seg[seg.length - 1] || 1;
    const N = Math.max(60, Math.min(400, Math.round(largo / 1.5)));   // ~1.5 m de paso
    const pts = [], surfXYZ = [];
    for (let k = 0; k < N; k++) {
      const sd = (k / (N - 1)) * largo;
      let j = 1; while (j < seg.length - 1 && seg[j] < sd) j++;
      const t = (sd - seg[j - 1]) / ((seg[j] - seg[j - 1]) || 1);
      const x = V[j - 1].x + t * (V[j].x - V[j - 1].x), y = V[j - 1].y + t * (V[j].y - V[j - 1].y);
      pts.push({ s: sd, z: elevAtMetrico(d, x, y, 0) });
      surfXYZ.push({ x, y, z: elevAtMetrico(d, x, y, 0) });
    }
    const x1 = d.x0 + d.ancho, y1 = d.y0 + d.alto;
    let fuera = 0; for (const p of surfXYZ) if (p.x < d.x0 || p.x > x1 || p.y < d.y0 || p.y > y1) fuera++;
    s.pts = pts; s.surface = pts; s.surfXYZ = surfXYZ;
    s.cutXY = V.map((v) => ({ x: v.x, y: v.y }));       // vértices (cut line HEC-RAS)
    s.fuera = fuera / surfXYZ.length;
  }

  // Muestrea la sección según el modo: CAD (demM métrico) o DEM base (lon/lat).
  _muestrear(s) { if (this.modo === 'dem' && this.baseDEM) this._muestrearSeccionDEM(s); else this._muestrear(s); }

  // Muestrea el perfil sobre el DEM base (lon/lat) — sin CAD. Métrica local equirect.
  _muestrearSeccionDEM(s) {
    const g = this.baseDEM, line = s.linea;
    const lo0 = line[0][0], la0 = line[0][1], mx = 111320 * Math.cos(la0 * Math.PI / 180), my = 110540;
    const V = line.map(([lo, la]) => ({ x: (lo - lo0) * mx, y: (la - la0) * my }));
    const seg = [0];
    for (let i = 1; i < V.length; i++) seg.push(seg[i - 1] + Math.hypot(V[i].x - V[i - 1].x, V[i].y - V[i - 1].y));
    const largo = seg[seg.length - 1] || 1;
    const N = Math.max(60, Math.min(400, Math.round(largo / 1.5)));
    const pts = [], surfXYZ = [];
    for (let k = 0; k < N; k++) {
      const sd = (k / (N - 1)) * largo; let j = 1; while (j < seg.length - 1 && seg[j] < sd) j++;
      const t = (sd - seg[j - 1]) / ((seg[j] - seg[j - 1]) || 1);
      const x = V[j - 1].x + t * (V[j].x - V[j - 1].x), y = V[j - 1].y + t * (V[j].y - V[j - 1].y);
      const z = elevAt(g, lo0 + x / mx, la0 + y / my);
      pts.push({ s: sd, z }); surfXYZ.push({ x, y, z });
    }
    const b = g.bbox; let fuera = 0;
    for (const [lo, la] of line) if (lo < b.west || lo > b.east || la < b.south || la > b.north) fuera++;
    s.pts = pts; s.surface = pts; s.surfXYZ = surfXYZ;
    s.cutXY = V.map((v) => ({ x: v.x, y: v.y }));
    s.fuera = fuera / line.length;
  }

  async _usarDEMbase() {
    const st = this.body.querySelector('#bp-demst'); if (st) st.textContent = ' bajando relieve…';
    try {
      let bbox;
      if (this.tramo) {
        const cs = this.tramo.feature.geometry.coordinates;
        let w = 180, s = 90, e = -180, n = -90;
        for (const [lo, la] of cs) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
        const mLon = Math.max((e - w) * 0.3, 0.006), mLat = Math.max((n - s) * 0.3, 0.006);
        bbox = { west: w - mLon, east: e + mLon, south: s - mLat, north: n + mLat };
      } else { const b = this.map.map.getBounds(); bbox = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() }; }
      this.baseDEM = await fetchDEM(bbox, { maxDim: 512 });
      if (this.baseDEM.zmin == null) { let mn = Infinity, mx = -Infinity; for (const v of this.baseDEM.data) { if (v < mn) mn = v; if (v > mx) mx = v; } this.baseDEM.zmin = mn; this.baseDEM.zmax = mx; }
      this.modo = 'dem';
      if (st) st.textContent = '';
      this.map?.map.fitBounds([[bbox.south, bbox.west], [bbox.north, bbox.east]]);
      this._render(); this.open(); this._syncCapas();
    } catch (err) { if (st) st.textContent = ' ✗ ' + err.message; console.error(err); }
  }

  _crearSeccion(lineaLonLat) {
    const s = { nombre: `Sección ${this.secciones.length + 1}`, linea: lineaLonLat };
    this._muestrear(s);
    this.secciones.push(s);
    this._actualizarFlujo();            // dirección del flujo + pendiente media desde el terreno
    this._calcSeccionEje(s);
    this._dibujarSecciones();
  }

  // Determina la DIRECCIÓN del flujo y la PENDIENTE MEDIA desde el terreno: ordena las
  // secciones por cota de lecho (thalweg) de mayor (aguas arriba) a menor (aguas abajo),
  // asigna la station acumulada a lo largo del cauce y J = caída del lecho / longitud.
  _actualizarFlujo() {
    const secs = this.secciones;
    if (secs.length < 1) return null;
    for (const s of secs) s._thalweg = Math.min(...s.pts.map((p) => p.z));
    const midOf = (s) => ({ x: (s.cutXY[0].x + s.cutXY[1].x) / 2, y: (s.cutXY[0].y + s.cutXY[1].y) / 2 });
    let ord, viaEje = false;
    // Si hay EJE dibujado, ordena y estaciona las secciones por su proyección a lo largo
    // del eje (más robusto que el thalweg); si no, cae al orden por descenso del lecho.
    if (this.eje && this.eje.length >= 2 && this.demM && this.anchor) {
      const E = this.eje.map(([lo, la]) => metricoDesdeLonLat(this.demM, this.anchor, lo, la));
      const cum = [0];
      for (let i = 1; i < E.length; i++) cum.push(cum[i - 1] + Math.hypot(E[i].x - E[i - 1].x, E[i].y - E[i - 1].y));
      const proj = (mx, my) => {
        let best = Infinity, bestS = 0;
        for (let i = 0; i < E.length - 1; i++) {
          const ax = E[i].x, ay = E[i].y, dx = E[i + 1].x - ax, dy = E[i + 1].y - ay;
          const L2 = dx * dx + dy * dy || 1;
          let t = ((mx - ax) * dx + (my - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
          const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(mx - px, my - py);
          if (d < best) { best = d; bestS = cum[i] + t * Math.sqrt(L2); }
        }
        return bestS;
      };
      for (const s of secs) { const m = midOf(s); s._ejeS = proj(m.x, m.y); }
      ord = [...secs].sort((a, b) => a._ejeS - b._ejeS);
      // el usuario puede dibujar el eje al revés: si el "primero" tiene lecho más bajo, invierte
      if (ord.length > 1 && ord[0]._thalweg < ord[ord.length - 1]._thalweg) ord.reverse();
      const s0 = ord[0]._ejeS;
      for (const s of ord) s.station = Math.abs(s._ejeS - s0);
      viaEje = true;
    } else {
      ord = [...secs].sort((a, b) => b._thalweg - a._thalweg);   // arriba→abajo por lecho
      let acc = 0;
      for (let i = 0; i < ord.length; i++) {
        if (i > 0) { const a = midOf(ord[i - 1]), b = midOf(ord[i]); acc += Math.hypot(b.x - a.x, b.y - a.y); }
        ord[i].station = acc;                          // station a lo largo del flujo
      }
    }
    if (this._flujoInvert) ord.reverse();   // inversión manual de la dirección del flujo
    let accS = 0;   // station acumulada a lo largo del flujo (consistente pre/post inversión)
    for (let i = 0; i < ord.length; i++) { if (i > 0) { const a = midOf(ord[i - 1]), b = midOf(ord[i]); accS += Math.hypot(b.x - a.x, b.y - a.y); } ord[i].station = accS; }
    const L = accS || 1;
    const Jmedia = ord.length > 1 ? Math.max(1e-4, Math.abs(ord[0]._thalweg - ord[ord.length - 1]._thalweg) / L) : null;
    this._flujo = { Jmedia, arriba: ord[0], abajo: ord[ord.length - 1], L, n: ord.length, viaEje, invertido: this._flujoInvert };
    // autocompleta J del formulario con la pendiente media del terreno (si el usuario no lo tocó)
    const jIn = this.body.querySelector('#bp-j');
    if (jIn && Jmedia && !this._jManual) jIn.value = Jmedia.toFixed(4);
    return this._flujo;
  }

  // (Re)calcula el eje (Manning) + socavación de una sección con los valores del form.
  _calcSeccionEje(s) {
    const Q = +this.body.querySelector('#bp-q').value || 100;
    const n = +this.body.querySelector('#bp-n').value || 0.035;
    const J = +this.body.querySelector('#bp-j').value || 0.005;
    const D50mm = +this.body.querySelector('#bp-d50').value || 20;
    const sg = +this.body.querySelector('#bp-sg').value || 2.65;
    const T = +this.body.querySelector('#bp-t').value || 100;
    let aPila = parseFloat(this.body.querySelector('#bp-pila').value);
    let formaPila = 'circular';
    // Interferencia de estructuras en la sección (1D, tipo HEC-RAS): pilas que la
    // cruzan la ANGOSTAN (suma de anchos) y aportan el ancho de pila; un tablero que
    // la cruza fija la cota inferior (soffit) como tope de WSE / flujo inefectivo.
    let bPila = 0, zSoffit = Infinity, wmax = 0, forma = 'circular';
    if (s.linea) {
      for (const e of (window.__koi?.estr?.estructuras || [])) {
        const w = pilaEnSeccion(e, s.linea);
        if (w > 0) { bPila += w; if (w > wmax) { wmax = w; forma = e.tipo === 'pila_rect' ? 'rectangular' : 'circular'; } }
        if (e.tipo === 'tablero' && e.planta && s.linea.some(([lo, la]) => puntoEnPoligono(lo, la, e.planta))) {
          zSoffit = Math.min(zSoffit, (e.zBase ?? 0) + (e.dz || 0) + (e.params.luzLibre || 0));
        }
      }
    }
    if (!(aPila > 0) && wmax > 0) { aPila = wmax; formaPila = forma; s.pilaAuto = true; } else s.pilaAuto = false;
    s._bPila = bPila; s._zSoffit = zSoffit;
    const roca = parseFloat(this.body.querySelector('#bp-roca')?.value);
    const strata = this._parseStrata(this.body.querySelector('#bp-strata')?.value);
    s.res = nivelNormal(s.pts, { Q, n, J });
    // Interferencia 1D: angostamiento por pilas (área/ancho) y tope por tablero.
    s.obstr = null; s.obstrTablero = null;
    if (bPila > 0 && s.res.B > 0) {
      const Bef = Math.max(0.2 * s.res.B, s.res.B - bPila);
      const Aef = s.res.A * (Bef / s.res.B);
      s.obstr = { bPila: +bPila.toFixed(2), Bef: +Bef.toFixed(1), Vobs: +(Q / Math.max(Aef, 1e-3)).toFixed(2) };
    }
    if (isFinite(zSoffit)) s.obstrTablero = { zSoffit: +zSoffit.toFixed(2), sumergido: s.res.WSE > zSoffit };
    // Motor 2D: si hay superficie de agua muestreada, la WSE/calado de la sección vienen
    // del CAMPO 2D (no del calado normal 1D) → recomputa A/B/prof y V media del campo.
    if (this.motor === '2d' && s._wse2d != null) {
      const p = this._propsWSE(s.pts, s._wse2d);
      if (p.A > 0) {
        s.res.WSE = s._wse2d; s.res.A = p.A; s.res.B = p.B; s.res.profMax = p.profMax;
        const vs = (s._v2d || []).map((o) => o.v).filter((v) => v > 0);
        if (vs.length) s.res.V = vs.reduce((a, b) => a + b, 0) / vs.length;
        s.res.Fr = s.res.V / Math.sqrt(9.81 * (s.res.A / (s.res.B || 1)));
        s.res.regimen = s.res.Fr >= 1 ? 'supercrítico' : 'subcrítico';
        s.res.fuente2D = true;
      }
    }
    // Si el motor es 2D y esta sección tiene velocidad muestreada del campo, la
    // socavación por franjas usa esa velocidad REAL (opts.vProfile) en vez del reparto 1D.
    const vProfile = (this.motor === '2d' && s._v2d) ? s._v2d : undefined;
    s.soc = evaluarSocavacion(s.res, s.pts, { Q, n, J, D50mm, s: sg, T, strata, roca: isFinite(roca) ? roca : Infinity, vProfile, pila: aPila > 0 ? { a: aPila, forma: formaPila } : undefined });
    s.socFuenteV = s.soc.franjas?.fuenteV;
    s.D50mm = D50mm; s.T = T;
  }
  // "5:2, 80:3" → [{D50mm:5,espesor:2},{D50mm:80,espesor:3}] (macrogranulometría por capas)
  _parseStrata(txt) {
    if (!txt) return [];
    return txt.split(',').map((p) => { const [d, e] = p.split(':').map((x) => parseFloat(x)); return (isFinite(d) && isFinite(e)) ? { D50mm: d, espesor: e } : null; }).filter(Boolean);
  }
  // Recalcula TODAS las secciones (al cambiar Q/n/J/D50…) y refresca.
  _recalcularSecciones() { this._actualizarFlujo(); for (const s of this.secciones) this._calcSeccionEje(s); this._render(); this._dibujarSecciones(); }

  _dibujarSecciones() {
    if (!this.map) return;
    // footprint + overlay + ancla del DEM CAD (en modo DEM base no hay footprint que mostrar)
    if (this.demM && this.anchor) this.map.showBati({ footprint: footprint(this.demM, this.anchor), anchor: this.anchor, overlay: this._overlay() }, (a, d) => this._onMove(a, d));
    this._dibujarEje();
    this._dibujarDominioEdit();
    this._dibujarSeccionesEdit();
    this._dibujarFlecha();
  }

  // Dibuja las secciones con VÉRTICES ARRASTRABLES (extremos + bordes del cauce).
  _dibujarSeccionesEdit() {
    const L = window.L;
    if (this._secGroup) this._secGroup.clearLayers(); else this._secGroup = L.layerGroup().addTo(this.map.map);
    this._secPolys = [];
    this.secciones.forEach((s, i) => {
      const poly = L.polyline(s.linea.map(([lo, la]) => [la, lo]), { color: '#22d3ee', weight: 3 })
        .bindTooltip(s.nombre + (s.fuera > 0.15 ? ' ⚠ fuera del DEM' : '') + ' · doble-clic agrega vértice', { sticky: true })
        .on('click', (e) => { window.L.DomEvent.stop(e); this._scrollSec(i); });
      // doble-clic sobre la sección → agrega un vértice (p.ej. un borde intermedio)
      poly.on('dblclick', (e) => { window.L.DomEvent.stop(e); this._insertarVertice(s.linea, e.latlng); this._muestrear(s); this._actualizarFlujo(); this._calcSeccionEje(s); this._render(); this._dibujarSecciones(); });
      this._secGroup.addLayer(poly); this._secPolys[i] = poly;
      s.linea.forEach((pt, v) => {
        const icon = L.divIcon({ className: 'koi-sec-vtx', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
        const mk = L.marker([pt[1], pt[0]], { icon, draggable: true, zIndexOffset: 600 })
          .bindTooltip(`${s.nombre} · vértice ${v + 1} (arrastra · clic-derecho borra)`, { direction: 'top' });
        mk.on('drag', () => { const ll = mk.getLatLng(); s.linea[v] = [ll.lng, ll.lat]; this._redibujarLinea(i); });
        mk.on('dragend', () => { const ll = mk.getLatLng(); s.linea[v] = [ll.lng, ll.lat]; this._muestrear(s); this._actualizarFlujo(); this._calcSeccionEje(s); this._render(); this._dibujarSecciones(); });
        mk.on('contextmenu', (e) => { window.L.DomEvent.stop(e); if (s.linea.length > 2) { s.linea.splice(v, 1); this._muestrear(s); this._actualizarFlujo(); this._calcSeccionEje(s); this._render(); this._dibujarSecciones(); } });
        this._secGroup.addLayer(mk);
      });
    });
  }
  _redibujarLinea(i) {   // durante el arrastre, actualiza solo la polilínea (rápido)
    this._secPolys?.[i]?.setLatLngs(this.secciones[i].linea.map(([lo, la]) => [la, lo]));
  }
  _refreshSecciones() { this._render(); }
  _scrollSec(i) { this.body.querySelector(`[data-sec="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  // Eje hidráulico por remanso sobre TODAS las secciones dibujadas.
  _runRemanso() {
    const out = this.body.querySelector('#bp-remanso-out');
    if (this.secciones.length < 2) { out.innerHTML = '<p class="hp-note">Traza al menos 2 secciones (ordenadas a lo largo del cauce).</p>'; return; }
    const Q = +this.body.querySelector('#bp-q').value || 100;
    const n = +this.body.querySelector('#bp-n').value || 0.035;
    const Cc = +this.body.querySelector('#bp-cc').value || 0.1;
    const Ce = +this.body.querySelector('#bp-ce').value || 0.3;
    const regimen = this.body.querySelector('#bp-reg').value;
    const wse = parseFloat(this.body.querySelector('#bp-wse').value);
    const secs = this.secciones.map((s) => ({ pts: s.pts, station: s.station, nombre: s.nombre, kLoc: s.kLoc || 0 }));
    try {
      const bc = { wseAguasAbajo: isFinite(wse) ? wse : undefined, wseAguasArriba: isFinite(wse) ? wse : undefined };
      const r = regimen === 'mixto'
        ? ejeMixto(secs, { Q, n, Cc, Ce, ...bc })
        : ejeRemanso(secs, { Q, n, Cc, Ce, regimen, ...bc });
      this._remanso = r;
      const rows = r.perfil.map((p) => {
        const pl = p.perdidas;
        const perd = pl ? `${f2(pl.hf)} / ${f2(pl.he)}${p.kLoc ? ' / ' + f2(pl.hloc) : ''}` : (p.rama || '—');
        return `<tr${p.Fr >= 1 ? ' style="color:var(--accent)"' : ''}><td>${p.nombre || (p.station.toFixed(0) + ' m')}</td><td>${f2(p.WSE)}</td><td>${f2(p.profMax)}</td><td>${f2(p.A)}</td><td>${f2(p.V)}</td><td>${f2(p.Fr)}</td><td>${f2(p.E)}</td><td>${perd}</td></tr>`;
      }).join('');
      const resaltoKV = r.resalto ? `<div class="bp-resalto"><b>💥 Resalto hidráulico</b> en est. ${r.resalto.station.toFixed(0)} m (entre ${r.resalto.entre.join(' y ')})
          <div class="hp-kv">
            <div><span>Tirante antes / después (conjugados)</span><b>${f2(r.resalto.y1)} → ${f2(r.resalto.y2)} m</b></div>
            <div><span>Fr₁ · altura del resalto</span><b>${f2(r.resalto.Fr1)} · ${f2(r.resalto.altura)} m</b></div>
            <div><span>Pérdida de energía</span><b>${f2(r.resalto.perdidaEnergia)} m</b></div></div></div>` : '';
      out.innerHTML = `<div class="hp-kv">
          <div><span>Régimen</span><b>${r.mixto ? 'mixto (con resalto)' : r.regimen}</b></div>
          <div><span>Pendiente media</span><b>${(r.pendienteMedia * 100).toFixed(2)} %</b></div>
          <div><span>Contracción / Expansión</span><b>${r.Cc} / ${r.Ce}</b></div></div>`
        + resaltoKV
        + this._svgPerfilLong(r, r.resalto?.station)
        + `<table class="hp-tbl"><thead><tr><th>Sección</th><th>WSE</th><th>Prof</th><th>A</th><th>V</th><th>Fr</th><th>E</th><th>hf/he/hloc</th></tr></thead><tbody>${rows}</tbody></table>`
        + `<p class="hp-note">Filas en azul = supercrítico (Fr≥1). hf fricción · he contr/exp · hloc local. E = energía total. En mixto la última col indica la rama (super/sub).</p>`
        + this._salidaCompletaHTML(r);
      this._wireSalida();
    } catch (e) { out.innerHTML = `<p class="hp-note" style="color:var(--red)">${e.message}</p>`; }
  }

  // Salida completa por sección (HEC-RAS-like): hidráulica + sedimentos + socavación.
  _salidaCompletaHTML(r) {
    const Q = +this.body.querySelector('#bp-q').value || 100;
    const n = +this.body.querySelector('#bp-n').value || 0.035;
    const D50mm = +this.body.querySelector('#bp-d50').value || 20;
    const D84mm = parseFloat(this.body.querySelector('#bp-d84')?.value);
    const sg = parseFloat(this.body.querySelector('#bp-sg')?.value) || 2.65;
    const T = +this.body.querySelector('#bp-t').value || 100;
    const aPila = parseFloat(this.body.querySelector('#bp-pila').value);
    const secs = this.secciones.map((s) => ({ pts: s.pts, station: s.station, nombre: s.nombre }));
    const filas = analisisCompleto(r.perfil, secs, { Q, D50mm, D84mm, s: sg, T, pila: aPila > 0 ? { a: aPila, forma: 'circular' } : null });
    this._salida = { filas, meta: { Q, n, D50mm, T } };
    const rows = filas.map((f) => `<tr${f.Fr >= 1 ? ' style="color:var(--accent)"' : ''}>
      <td>${f.nombre || f.station.toFixed(0)}</td><td>${f2(f.V)}</td><td>${f2(f.Fr)}</td><td>${f2(f.tau0)}</td>
      <td>${f2(f.Vcritica)}</td><td>${f.arrastra ? '✓' : '—'}</td><td>${(f.sedModo || '').slice(0, 4)}</td>
      <td>${f2(f.socavGeneral)}</td><td>${f2(f.socavLocal)}</td><td><b>${f2(f.socavTotal)}</b></td></tr>`).join('');
    return `<div class="hp-mini" style="margin-top:10px">Salida completa · sedimentos + socavación (D50 ${D50mm} mm, T ${T} a${aPila > 0 ? ', pila ' + aPila + ' m' : ''})</div>
      <table class="hp-tbl"><thead><tr><th>Sec</th><th>V</th><th>Fr</th><th>τ</th><th>Vc</th><th>arr</th><th>modo</th><th>S.gen</th><th>S.loc</th><th>S.tot</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="hp-note">τ = esfuerzo de corte [N/m²] · Vc = vel. crítica de arrastre · arr = ¿arrastra? · modo = transporte (fondo/susp) · S = socavación [m] (general LL, local pila HEC-18, total).</p>
      <button class="bp-b" id="bp-csv-salida" style="margin-top:6px">⬇ CSV salida completa (HEC-RAS)</button>`;
  }
  _wireSalida() {
    const b = this.body.querySelector('#bp-csv-salida');
    if (b) b.addEventListener('click', () => { if (this._salida) descargar(`${this.nombre || 'eje'}_salida.csv`, salidaCSV(this._salida.filas, this._salida.meta), 'text/csv'); });
  }

  // Perfil LONGITUDINAL: lecho (mín z por sección) + línea de energía/agua vs estación.
  _svgPerfilLong(r, jumpStation) {
    const W = 380, H = 150, pad = 26;
    const secs = r.perfil.map((p, i) => ({ st: p.station, wse: p.WSE, bed: p.WSE - p.profMax, e: p.E }));
    secs.sort((a, b) => a.st - b.st);
    const st0 = secs[0].st, st1 = secs[secs.length - 1].st, dS = (st1 - st0) || 1;
    let zLo = Infinity, zHi = -Infinity;
    for (const s of secs) { zLo = Math.min(zLo, s.bed); zHi = Math.max(zHi, s.e, s.wse); }
    const zR = (zHi - zLo) || 1;
    const X = (st) => pad + ((st - st0) / dS) * (W - 2 * pad);
    const Y = (z) => H - pad - ((z - zLo) / zR) * (H - 2 * pad);
    const bed = secs.map((s) => `${X(s.st).toFixed(1)},${Y(s.bed).toFixed(1)}`).join(' ');
    const wse = secs.map((s) => `${X(s.st).toFixed(1)},${Y(s.wse).toFixed(1)}`).join(' ');
    const ene = secs.map((s) => `${X(s.st).toFixed(1)},${Y(s.e).toFixed(1)}`).join(' ');
    const agua = secs.map((s) => `${X(s.st).toFixed(1)},${Y(s.wse).toFixed(1)}`).join(' ') + ' ' +
      secs.slice().reverse().map((s) => `${X(s.st).toFixed(1)},${Y(s.bed).toFixed(1)}`).join(' ');
    const jump = (jumpStation != null && jumpStation >= st0 && jumpStation <= st1)
      ? `<line x1="${X(jumpStation).toFixed(1)}" y1="${pad}" x2="${X(jumpStation).toFixed(1)}" y2="${H - pad}" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="2 2"/><text x="${X(jumpStation).toFixed(1)}" y="${pad - 2}" text-anchor="middle" font-size="8" fill="#a855f7">resalto</text>` : '';
    return `<svg class="hp-sec-svg" viewBox="0 0 ${W} ${H}">
      <polygon points="${agua}" fill="#38bdf8" fill-opacity="0.45"/>
      <polyline points="${ene}" fill="none" stroke="#ef4444" stroke-width="1" stroke-dasharray="3 2"/>
      <polyline points="${wse}" fill="none" stroke="#0284c7" stroke-width="1.6"/>
      <polyline points="${bed}" fill="none" stroke="#a3805a" stroke-width="2"/>
      ${jump}
      <text x="${pad}" y="12" font-size="9" fill="#a3805a">lecho</text>
      <text x="${W - pad}" y="12" text-anchor="end" font-size="9" fill="#0284c7">— WSE  <tspan fill="#ef4444">-- energía</tspan></text>
      <text x="${pad}" y="${H - 6}" font-size="8" fill="var(--text2)">aguas arriba</text>
      <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">aguas abajo →</text>
    </svg>`;
  }

  // SVG de la sección: terreno + lámina de agua + línea de socavación.
  _svgSeccion(s) {
    const W = 380, H = 150, pad = 24;
    const xs = s.pts.map((p) => p.s), zs = s.pts.map((p) => p.z);
    const sMax = Math.max(...xs) || 1, sMin = Math.min(...xs);
    // línea de socavación POR FRANJAS (la profundidad varía con la velocidad de cada franja)
    const fr = s.soc.franjas?.franjas || [];
    const socZ = fr.length ? fr.map((p) => p.zFondo) : (s.soc.general.perfil || []).map((p) => p.zFondo);
    // rango vertical que incluye TODO lo dibujado (terreno, WSE y socavación) → sin recortes
    const allZ = [...zs, s.res.WSE, ...socZ].filter((v) => isFinite(v));
    const zLo = Math.min(...allZ) - 0.3, zHi = Math.max(...allZ) + 0.3, zR = (zHi - zLo) || 1, sR = (sMax - sMin) || 1;
    const X = (v) => pad + ((v - sMin) / sR) * (W - 2 * pad);
    const Y = (v) => H - pad - ((v - zLo) / zR) * (H - 2 * pad);
    const terreno = s.pts.map((p) => `${X(p.s).toFixed(1)},${Y(p.z).toFixed(1)}`).join(' ');
    // agua: donde z<WSE
    let agua = '';
    const wpts = [];
    for (const p of s.pts) if (p.z <= s.res.WSE) wpts.push(p);
    if (wpts.length > 1) {
      const top = `${X(wpts[0].s).toFixed(1)},${Y(s.res.WSE).toFixed(1)} ${X(wpts[wpts.length - 1].s).toFixed(1)},${Y(s.res.WSE).toFixed(1)}`;
      const bot = wpts.map((p) => `${X(p.s).toFixed(1)},${Y(p.z).toFixed(1)}`).reverse().join(' ');
      agua = `<polygon points="${top} ${bot}" fill="#38bdf8" fill-opacity="0.5"/>`;
    }
    const socLine = fr.length ? fr.map((p) => `${X(p.s).toFixed(1)},${Y(p.zFondo).toFixed(1)}`).join(' ')
      : s.soc.general.perfil.map((p) => `${X(p.s).toFixed(1)},${Y(p.zFondo).toFixed(1)}`).join(' ');
    return `<svg class="hp-sec-svg" viewBox="0 0 ${W} ${H}">
      ${agua}
      <polyline points="${terreno}" fill="none" stroke="#a3805a" stroke-width="2"/>
      ${socLine ? `<polyline points="${socLine}" fill="none" stroke="#ef4444" stroke-width="1.6" stroke-dasharray="4 3"/>` : ''}
      <line x1="${X(0)}" y1="${Y(s.res.WSE)}" x2="${X(sMax)}" y2="${Y(s.res.WSE)}" stroke="#0284c7" stroke-width="1" stroke-dasharray="2 2"/>
      <text x="${W - pad}" y="${Y(s.res.WSE) - 3}" text-anchor="end" font-size="9" fill="#0284c7">WSE ${f2(s.res.WSE)}</text>
      <text x="${pad}" y="14" font-size="9" fill="#ef4444">— socavación</text>
    </svg>`;
  }

  // ── Exportación HEC-RAS ──────────────────────────────────────────────────────
  _zonaSel() { return { zona: +this.body.querySelector('#bp-zona').value, sur: true }; }
  _expTerreno() {
    if (!this.demM) return;
    const { zona, sur } = this._zonaSel();
    const asc = demArcASCII(this.demM);
    const prj = wktUTM(zona, sur);
    const blob = zipStore([
      { name: `${this.nombre}_terreno.asc`, data: asc },
      { name: `${this.nombre}_terreno.prj`, data: prj },
    ]);
    descargar(`${this.nombre}_terreno_HECRAS.zip`, blob);
  }
  _expSDF() {
    if (!this.secciones.length) { alert('Traza al menos una sección.'); return; }
    const { zona, sur } = this._zonaSel();
    const rio = this.body.querySelector('#bp-rio').value || 'Rio';
    const reach = this.body.querySelector('#bp-reach').value || 'Tramo';
    const sdf = sdfGeometria(this.secciones, { rio, reach });
    const blob = zipStore([
      { name: `${this.nombre}.sdf`, data: sdf },
      { name: `${this.nombre}.prj`, data: wktUTM(zona, sur) },
    ]);
    descargar(`${this.nombre}_geometria_HECRAS.zip`, blob);
  }
  _expCSV() {
    if (!this.secciones.length) { alert('Traza al menos una sección.'); return; }
    descargar(`${this.nombre}_secciones.csv`, csvSecciones(this.secciones), 'text/csv');
  }

  // ── utilidades ──────────────────────────────────────────────────────────────
  _centroTramo(t) {
    const cs = t.feature.geometry.coordinates;
    let w = 180, s = 90, e = -180, n = -90;
    for (const [lon, lat] of cs) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
    return [(w + e) / 2, (s + n) / 2];
  }
  _centroMapa() { const c = this.map?.map?.getCenter(); return c ? [c.lng, c.lat] : [-69.11, -19.98]; }
}
