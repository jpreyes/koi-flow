// ─────────────────────────────────────────────────────────────────────────────
// embalse_ui.js — HUD de laminación en embalse (koi-flow). Dibuja el vaso, obtiene
// la curva cota–área–volumen del DEM, define el vertedero y un hidrograma de
// entrada, y rutea por piscina nivelada (Puls) mostrando la atenuación entrada/salida.
// ─────────────────────────────────────────────────────────────────────────────
import { curvaEmbalse, ruteoPuls, hidrogramaTriangular } from './embalse.js?v=4';
import { fetchDEM } from '../cuenca/dem_tiles.js?v=4';

const f = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d)));

export function abrirEmbalseHUD(koi, huds) {
  const hud = huds.open('embalse', { title: '🌊 Embalse (laminación)', w: 460, h: 560 });
  if (hud._embWired) { hud.focus?.(); return hud; }   // estado y cableado ÚNICOS por HUD
  hud.setBody(form());
  hud._emb = { poly: null, curva: null, layer: null };
  wire(hud, koi, hud._emb);
  hud._embWired = true;
  return hud;
}

function form() {
  return `
    <button class="hp-run" id="em-draw">▱ Dibujar el vaso del embalse (polígono)</button>
    <span class="hp-dl-status" id="em-st"></span>
    <div id="em-vaso" class="hud-note">Dibuja el contorno del vaso sobre el mapa (doble-clic para cerrar). Se calcula la curva cota–área–volumen desde el DEM.</div>
    <div class="cfg-grp">Vertedero de descarga</div>
    <div class="cfg-form">
      <label>Cota vertedero [m]<input id="em-cv" type="number" step="0.5"></label>
      <label>Largo vertedero [m]<input id="em-lv" type="number" value="20"></label>
      <label>Coef. Cd<input id="em-cd" type="number" step="0.05" value="1.7"></label>
      <label>Cota inicial [m]<input id="em-ci" type="number" step="0.5"></label>
    </div>
    <div class="cfg-grp">Hidrograma de entrada (triangular)</div>
    <div class="cfg-form">
      <label>Q pico [m³/s]<input id="em-qp" type="number" value="120"></label>
      <label>t al pico [h]<input id="em-tp" type="number" step="0.5" value="1"></label>
      <label>t base [h]<input id="em-tb" type="number" step="0.5" value="4"></label>
      <label>Δt [s]<input id="em-dt" type="number" value="600"></label>
    </div>
    <button class="hp-run" id="em-run" style="margin-top:8px">🌊 Rutear (laminar la crecida)</button>
    <div id="em-out"></div>`;
}

function wire(hud, koi, st) {
  const $ = (s) => hud.body.querySelector(s);
  const set = (t) => { const e = $('#em-st'); if (e) e.textContent = t || ''; };
  $('#em-draw').addEventListener('click', () => {
    if (!koi.map) return;
    koi.map.dibujar('poly', '#2563eb', async (pts) => {
      if (!pts || pts.length < 3) return;
      st.poly = pts;
      const L = window.L;
      if (st.layer) st.layer.remove();
      st.layer = L.polygon(pts.map(([lo, la]) => [la, lo]), { color: '#2563eb', fillColor: '#38bdf8', fillOpacity: 0.3 }).addTo(koi.map.map);
      try { koi.map.map.fitBounds(st.layer.getBounds()); } catch { /* */ }
      set(' obteniendo DEM…');
      try {
        let g = koi.bati?.fused || koi.bati?.baseDEM || (koi.bati?.grid?.data ? koi.bati.grid : null);
        if (!g || !g.data) {
          let w = 180, e = -180, s = 90, n = -90;
          for (const [lo, la] of pts) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
          const mLon = (e - w) * 0.2 || 0.004, mLat = (n - s) * 0.2 || 0.004;
          g = await fetchDEM({ west: w - mLon, east: e + mLon, south: s - mLat, north: n + mLat }, { maxDim: 400 });
        }
        st.curva = curvaEmbalse(g, pts);
        set('');
        $('#em-vaso').innerHTML = `Vaso: cotas <b>${f(st.curva.zmin)}–${f(st.curva.zmax)} m</b> · ${st.curva.nCeldas} celdas · vol. máx <b>${f(st.curva.curva[st.curva.curva.length - 1].vol_m3 / 1e6, 2)} Mm³</b>.`;
        // prefill cota vertedero / inicial si están vacías
        const cv = $('#em-cv'), ci = $('#em-ci'); const mid = st.curva.zmin + (st.curva.zmax - st.curva.zmin) * 0.7;
        if (cv && !cv.value) cv.value = mid.toFixed(1);
        if (ci && !ci.value) ci.value = mid.toFixed(1);
      } catch (err) { set(' ✗ ' + err.message); }
    });
  });
  $('#em-run').addEventListener('click', () => {
    const out = $('#em-out');
    if (!st.curva) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Dibuja el vaso primero.</p>'; return; }
    const cotaVert = parseFloat($('#em-cv').value), largoVert = parseFloat($('#em-lv').value) || 20, Cd = parseFloat($('#em-cd').value) || 1.7;
    const cotaIni = parseFloat($('#em-ci').value); const dt = parseFloat($('#em-dt').value) || 600;
    const Qp = parseFloat($('#em-qp').value) || 120, tp = (parseFloat($('#em-tp').value) || 1) * 3600, tb = (parseFloat($('#em-tb').value) || 4) * 3600;
    if (!isFinite(cotaVert)) { out.innerHTML = '<p class="hud-note" style="color:var(--red)">Ingresa la cota del vertedero.</p>'; return; }
    const inflow = hidrogramaTriangular(Qp, { tpico: tp, tbase: tb });
    const r = ruteoPuls(inflow, st.curva.curva, { cotaVert, largoVert, Cd, cotaIni: isFinite(cotaIni) ? cotaIni : cotaVert, dt });
    out.innerHTML = `<div class="hud-kv">
        <div><span>Q entrada (pico)</span><b>${f(r.QinPico)} m³/s</b></div>
        <div><span>Q salida (pico)</span><b>${f(r.QoutPico)} m³/s</b></div>
        <div><span>Atenuación del pico</span><b>${(r.atenuacion * 100).toFixed(0)} %</b></div>
        <div><span>Cota máxima alcanzada</span><b>${f(r.cotaMax)} m (vert. ${f(cotaVert)})</b></div></div>
      ${svgHidro(r)}
      <p class="hud-note">Ruteo por piscina nivelada (Puls). La curva coral es la salida laminada; el área entre curvas es el volumen almacenado temporalmente.</p>`;
  });
}

function svgHidro(r) {
  const W = 400, H = 150, pad = 26, o = r.out;
  const tMax = o[o.length - 1].t || 1, qMax = Math.max(r.QinPico, r.QoutPico) || 1;
  const X = (t) => pad + (t / tMax) * (W - 2 * pad), Y = (q) => H - pad - (q / qMax) * (H - 2 * pad);
  const line = (key, color) => `<polyline points="${o.map((p) => `${X(p.t).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"/>`;
  return `<svg class="hud-chart" viewBox="0 0 ${W} ${H}">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--border2)"/>
    ${line('Qin', '#2563eb')}${line('Qout', '#ef6c5a')}
    <text x="${pad}" y="12" font-size="9" fill="#2563eb">— entrada</text>
    <text x="${pad + 70}" y="12" font-size="9" fill="#ef6c5a">— salida (laminada)</text>
    <text x="${W - pad}" y="${H - 6}" text-anchor="end" font-size="8" fill="var(--text2)">${(tMax / 3600).toFixed(1)} h</text>
    <text x="${pad}" y="${H - 6}" font-size="8" fill="var(--text2)">tiempo</text></svg>`;
}
