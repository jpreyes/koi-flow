// ─────────────────────────────────────────────────────────────────────────────
// panel2d.js — pestaña "2D" del dock (koi-flow, Fase 5A). Flujo:
//   1) Dibujar el POLÍGONO del dominio inundable en el mapa.
//   2) Dibujar la POLILÍNEA del cauce (para refinar la malla ahí y separar la
//      rugosidad cauce/planicie) — el usuario lo dibuja, no se detecta.
//   3) Generar la MALLA triangular (portico-core) con z del DEM y n por zona.
// El solver difusivo (Fase B) y los resultados (Fase C) se montan sobre esto.
// ─────────────────────────────────────────────────────────────────────────────
import { construirMalla2D } from './malla2d.js?v=2';
import { resolver2D } from './solver2d.js?v=2';
import { ensureKoiWasm, makeSolverWasm, makePersistentSolverWasm } from '../../lib/portico/wasm_solve.js?v=2';
import { fetchDEM } from '../cuenca/dem_tiles.js?v=2';

const f1 = (v) => (v == null || !isFinite(v) ? '—' : Math.abs(v) < 10 ? (+v).toFixed(2) : (+v).toFixed(0));

export class Flujo2D {
  constructor() { this.dominio = null; this.cauce = null; this.mesh = null; }
  // La 2D se fusionó en la pestaña "Hidráulica" (bati_ui). Este panel queda como
  // reserva: si el dock ya no tiene host 'flujo2d', no renderiza nada (guarda).
  setDock(dock) { this.dock = dock; this.host = dock.hosts.flujo2d; if (this.host) this._render(); }
  setMap(m) { this.map = m; }
  setScene(s) { this.scene = s; }
  setTramo(t) { this.tramo = t; }
  toggle() { if (!this.host) return; if (this.dock?.isOpen() && this.dock.active === 'flujo2d') this.dock.close(); else this.dock?.show('flujo2d'); }

  _render() {
    const d = this.dominio, c = this.cauce, m = this.mesh;
    this.host.innerHTML = `
      <section class="hp-sec"><h4 class="hp-sec-h">1 · Dominio y cauce</h4>
        <p class="hp-note">Dibuja el polígono del área inundable y la polilínea del cauce (doble-clic o Esc para terminar). El cauce se dibuja: refina la malla ahí y separa la rugosidad cauce/planicie.</p>
        <div class="bp-btns">
          <button class="bp-b" id="f2-dom">${d ? '✓ Dominio (' + d.length + ') — redibujar' : '▱ Dibujar dominio'}</button>
          <button class="bp-b" id="f2-cau">${c ? '✓ Cauce (' + c.length + ') — redibujar' : '〰 Dibujar cauce'}</button>
          <button class="bp-b" id="f2-clr">✖ Limpiar</button>
        </div></section>
      <section class="hp-sec"><h4 class="hp-sec-h">2 · Malla</h4>
        <div class="bp-form">
          <label>h cauce [m] <input id="f2-hc" type="number" value="8"></label>
          <label>h planicie [m] <input id="f2-hp" type="number" value="40"></label>
          <label>Ancho cauce [m] <input id="f2-ac" type="number" value="30"></label>
          <label>n cauce <input id="f2-nc" type="number" step="0.005" value="0.035"></label>
          <label>n planicie <input id="f2-np" type="number" step="0.005" value="0.06"></label>
        </div>
        <button class="hp-run" id="f2-gen">🌐 Generar malla 2D</button>
        <span class="hp-dl-status" id="f2-st"></span>
        ${m ? this._statsHTML(m) : ''}
      </section>
      ${m ? `<section class="hp-sec"><h4 class="hp-sec-h">3 · Simular (onda difusiva)</h4>
        <div class="bp-form">
          <label>Caudal Q [m³/s] <input id="f2-q" type="number" value="50"></label>
          <label>WSE salida [m] <input id="f2-so" type="number" placeholder="auto"></label>
          <label>Δt [s] <input id="f2-dt" type="number" value="60"></label>
          <label>Pasos máx <input id="f2-steps" type="number" value="300"></label>
          <label>Solver lineal <select id="f2-solver">
            <option value="banda">Cholesky banda (directo)</option>
            <option value="pcg">PCG IC0 (JS)</option>
            <option value="wasm">PCG IC0 (WASM · C++)</option>
          </select></label>
          <label style="display:flex;align-items:center;gap:6px"><input id="f2-bg" type="checkbox"> <span>En segundo plano (no congela)</span></label>
        </div>
        <button class="hp-run" id="f2-sim">▶ Simular 2D</button>
        <span class="hp-dl-status" id="f2-simst"></span>
        <div id="f2-res"></div></section>` : ''}`;
    this._wire();
  }

  _statsHTML(m) {
    return `<div class="hp-kv" style="margin-top:10px">
      <div><span>Nodos · triángulos</span><b>${m.meta.nNodos} · ${m.meta.nTri}</b></div>
      <div><span>Área dominio</span><b>${(m.meta.area_m2 / 1e4).toFixed(2)} ha</b></div>
      <div><span>Área cauce</span><b>${(m.meta.areaCauce_m2 / 1e4).toFixed(2)} ha</b></div>
      <div><span>Cotas malla</span><b>${f1(m._zmin)} – ${f1(m._zmax)} m</b></div>
      <div><span>Resolución (cauce/plan.)</span><b>${m.meta.hCauce} / ${m.meta.hPlanicie} m</b></div></div>
      <p class="hp-note">Malla lista para el solver difusivo (Fase B): z por nodo del DEM y n por zona. El caudal de entrada vendrá del pipeline hidrológico.</p>`;
  }

  _wire() {
    const $ = (id) => this.host.querySelector(id);
    $('#f2-dom')?.addEventListener('click', () => this.map.dibujar('poly', '#22c55e', (pts) => { this.dominio = pts; this._preview(); this._render(); }));
    $('#f2-cau')?.addEventListener('click', () => this.map.dibujar('line', '#38bdf8', (pts) => { this.cauce = pts; this._preview(); this._render(); }));
    $('#f2-clr')?.addEventListener('click', () => { this.dominio = this.cauce = this.mesh = null; this.map.clearMalla2D(); this._render(); });
    $('#f2-gen')?.addEventListener('click', () => this._generar());
    $('#f2-sim')?.addEventListener('click', () => this._simular());
  }

  // entrada/salida = nodos de borde cerca de los extremos del cauce dibujado.
  _bordesCauce(mesh) {
    const c = mesh.cauceXY;
    const R = Math.max(mesh.meta.anchoCauce, 50);
    const near = (px, py) => mesh.nodes.filter((nd) => nd.borde && Math.hypot(nd.x - px, nd.y - py) <= R).map((nd) => nd.i);
    if (!c || c.length < 2) return { entrada: [], salida: [] };
    return { entrada: near(c[0][0], c[0][1]), salida: near(c[c.length - 1][0], c[c.length - 1][1]) };
  }

  async _simular() {
    const st = this.host.querySelector('#f2-simst');
    if (!this.mesh) { st.textContent = ' genera la malla primero'; return; }
    const { entrada, salida } = this._bordesCauce(this.mesh);
    if (!entrada.length || !salida.length) { st.textContent = ' dibuja el cauce (define entrada/salida)'; return; }
    const Q = +this.host.querySelector('#f2-q').value || 50;
    const so = parseFloat(this.host.querySelector('#f2-so').value);
    const dt = +this.host.querySelector('#f2-dt').value || 60;
    const nPasos = +this.host.querySelector('#f2-steps').value || 300;
    let solver = this.host.querySelector('#f2-solver')?.value || 'banda';
    const bg = this.host.querySelector('#f2-bg')?.checked;
    const stage = isFinite(so) ? so : undefined;
    st.textContent = ' resolviendo…';
    await new Promise((r) => setTimeout(r, 20));

    // Segundo plano: la difusiva corre en un Web Worker (no congela la UI). El worker
    // soporta los tres solvers, incl. WASM single-thread (loader worker-safe).
    if (bg) {
      try {
        const t0 = performance.now();
        const worker = new Worker(new URL('./solver2d_worker.js', import.meta.url), { type: 'module' });
        const r = await new Promise((resolve, reject) => {
          worker.onmessage = (ev) => {
            const m = ev.data;
            if (m.tipo === 'progreso') st.textContent = ` (2° plano) paso ${m.p}/${m.N} (Δ=${m.d.toExponential(1)})`;
            else if (m.tipo === 'aviso') st.textContent = ' ' + m.mensaje;
            else if (m.tipo === 'listo') resolve(m.r);
            else if (m.tipo === 'error') reject(new Error(m.mensaje));
          };
          worker.onerror = (e) => reject(new Error(e.message || 'worker'));
          worker.postMessage({ mesh: this.mesh, opts: { Q, entrada, salida, stageSalida: stage, dt, nPasos, solver } });
        });
        worker.terminate();
        r._tTotalMs = performance.now() - t0;
        this._mostrarResultado2D(r, entrada, salida, st);
      } catch (e) { st.textContent = ' ✗ ' + e.message; console.error(e); }
      return;
    }

    // Hilo principal (permite el camino WASM, que congela brevemente durante el solve).
    try {
      let wasmSolve, wasmPersist;
      if (solver === 'wasm') {
        st.textContent = ' cargando WASM…';
        try { await ensureKoiWasm(); wasmSolve = makeSolverWasm; wasmPersist = makePersistentSolverWasm; }
        catch (e) { st.textContent = ' ✗ WASM: ' + e.message + ' (usando JS)'; }
      }
      const t0 = performance.now();
      const r = resolver2D(this.mesh, { Q, entrada, salida, stageSalida: stage, dt, nPasos, solver, wasmSolve, wasmPersist, onProgress: (p, N, d) => { st.textContent = ` paso ${p}/${N} (Δ=${d.toExponential(1)})`; } });
      r._tTotalMs = performance.now() - t0;
      this._mostrarResultado2D(r, entrada, salida, st);
    } catch (e) { st.textContent = ' ✗ ' + e.message; console.error(e); }
  }

  // Pinta la mancha + la tabla de resultados/métricas (común a hilo principal y worker).
  _mostrarResultado2D(r, entrada, salida, st) {
    this.result = r;
    this.map.showInundacion(this.mesh, r.h, { cauce: this.cauce });
    st.textContent = r.convergio ? ` ✓ permanente en ${r.pasos} pasos` : ` ${r.pasos} pasos (Δ=${r.cambio.toExponential(1)})`;
    const solverTxt = { banda: 'Cholesky banda', pcg: 'PCG IC0 (JS)', wasm: 'PCG IC0 (WASM)', 'wasm-mt': 'PCG IC0 (WASM · multihilo)' }[r.solver] || r.solver;
    const fondo = r._tTotalMs != null && this.host.querySelector('#f2-bg')?.checked ? ' · 2° plano' : '';
    this.host.querySelector('#f2-res').innerHTML = `<div class="hp-kv" style="margin-top:8px">
        <div><span>Entrada / salida (nodos)</span><b>${entrada.length} / ${salida.length}</b></div>
        <div><span>Calado máximo</span><b>${r.hmax.toFixed(2)} m</b></div>
        <div><span>Velocidad máxima</span><b>${r.Vmax.toFixed(2)} m/s</b></div>
        <div><span>Nodos mojados</span><b>${r.nMojados} / ${this.mesh.nodes.length}</b></div>
        <div><span>Solver lineal</span><b>${solverTxt}${fondo}</b></div>
        <div><span>Tiempo total</span><b>${r._tTotalMs != null ? r._tTotalMs.toFixed(0) : (r.tTotalMs || 0).toFixed(0)} ms</b></div>
        <div><span>Ensamblaje</span><b>${(r.tAssemblyMs || 0).toFixed(0)} ms</b></div>
        <div><span>Tiempo solver (${r.nSolves} solves)</span><b>${r.tSolveMs.toFixed(0)} ms · ${r.tSolvePromMs.toFixed(1)} ms/solve</b></div></div>
        <p class="hp-note">Mancha de inundación por profundidad (azul = calado). Onda difusiva permanente. El “tiempo solver” es el gasto en resolver el sistema lineal; con «segundo plano» corre en un worker sin congelar la UI (solver JS).</p>`;
  }

  _preview() { this.map.showMalla2D({ dominio: this.dominio, cauce: this.cauce }); }

  async _generar() {
    const st = this.host.querySelector('#f2-st');
    if (!this.dominio) { st.textContent = ' dibuja el dominio primero'; return; }
    const opts = {
      hCauce: +this.host.querySelector('#f2-hc').value || 8,
      hPlanicie: +this.host.querySelector('#f2-hp').value || 40,
      anchoCauce: +this.host.querySelector('#f2-ac').value || 30,
      nCauce: +this.host.querySelector('#f2-nc').value || 0.035,
      nPlanicie: +this.host.querySelector('#f2-np').value || 0.06,
    };
    st.textContent = ' bajando DEM del dominio…';
    try {
      let w = 180, s = 90, e = -180, n = -90;
      for (const [lo, la] of this.dominio) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
      const mLon = (e - w) * 0.15, mLat = (n - s) * 0.15;
      // usa la batimetría fusionada si existe, si no baja el DEM base del dominio
      const fused = window.__koi?.bati?.fused;
      const dem = fused || await fetchDEM({ west: w - mLon, east: e + mLon, south: s - mLat, north: n + mLat }, { maxDim: 400 });
      st.textContent = ' mallando…';
      const mesh = construirMalla2D(this.dominio, this.cauce, dem, opts);
      let zmin = Infinity, zmax = -Infinity;
      for (const nd of mesh.nodes) { if (nd.z < zmin) zmin = nd.z; if (nd.z > zmax) zmax = nd.z; }
      mesh._zmin = zmin; mesh._zmax = zmax; mesh._dem = dem;
      this.mesh = mesh;
      this.map.showMalla2D({ dominio: this.dominio, cauce: this.cauce, mesh });
      st.textContent = '';
      this._render();
    } catch (err) { st.textContent = ' ✗ ' + err.message; console.error(err); }
  }
}
