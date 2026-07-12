// ─────────────────────────────────────────────────────────────────────────────
// flujo_guiado.js — ASISTENTE por pasos de koi-flow ("for dummies").
// Módulo PROPIO e independiente (no es bati_ui): orquesta un flujo de N pasos
// (ej. el eje hidráulico) llamando a las acciones que YA existen, sin reescribir
// los motores. Cada paso se ve SIEMPRE; el que toca va encendido, los que dependen
// de un paso previo se ven en gris. Reutilizable: agregar un flujo = una "receta".
// ─────────────────────────────────────────────────────────────────────────────
import { bus } from './bus.js?v=13';

// Helpers para hablar con la app sin acoplarse a los internos de cada panel.
const clickAccion = (a) => document.querySelector(`.menu-item[data-action="${a}"]`)?.click();
const activo = () => (typeof window !== 'undefined' && window.__koiSel?.get?.()) || null;

// ── Recetas ─────────────────────────────────────────────────────────────────
// paso = { id, t (título), d (descripción), ic (Tabler), correr(koi), hecho(koi) }
// `hecho` es best-effort (lee el estado); si no está seguro, el paso igual se puede correr.
// Atajos de detección contra el estado REAL (verificados contra bati/koi.reg).
const esTramo = () => ['tramo', 'reach'].includes(activo()?.tipo);
const hayRelieve = (koi) => !!(koi.bati?.demM || koi.bati?.fused || koi.bati?.baseDEM || koi.bati?.tramo?.demGrid);

const RECETAS = {
  eje: {
    titulo: 'Eje hidráulico 1D',
    icono: 'ti-wave-sine',
    pasos: [
      { id: 'cauce', t: 'Elige el cauce', d: 'Selecciona un tramo en el mapa o el árbol, o dibuja uno con la herramienta Tramo.', ic: 'ti-ripple',
        correr: (koi) => koi.capas?._dibujarTramo?.(),
        hecho: (koi) => !!(koi.bati?.tramo || esTramo()) },
      { id: 'relieve', t: 'Descarga el relieve (DEM)', d: 'Baja el relieve del sector: de ahí salen las secciones y las cotas.', ic: 'ti-mountain',
        correr: () => clickAccion('remanso1d'),
        hecho: hayRelieve },
      { id: 'secciones', t: 'Genera las secciones', d: 'Extrae las secciones transversales del cauce desde el DEM.', ic: 'ti-chart-line',
        correr: () => clickAccion('remanso1d'),
        hecho: (koi) => (koi.bati?.secciones?.length || 0) >= 2 },
      { id: 'eje', t: 'Corre el eje 1D', d: 'Paso estándar (Manning) sobre las secciones → perfil de agua (WSE, V, Fr). Se abre el diálogo Correr.', ic: 'ti-arrow-guide',
        correr: () => clickAccion('correr-remanso1d'),
        hecho: (koi) => !!koi.bati?._remanso },
      { id: 'socav', t: 'Socavación (opcional)', d: 'Con el resultado del eje, calcula la socavación (LL + HEC-18) en el cruce.', ic: 'ti-arrow-down',
        correr: (koi) => koi.dock?.show?.('hidro'),
        hecho: (koi) => !!koi.reg?.socavacion },
      { id: 'informe', t: 'Genera el informe', d: 'Arma el informe (PDF/Word) con la cuenca, la hidrología y el eje.', ic: 'ti-file-text',
        correr: () => clickAccion('informe'),
        hecho: () => false },
    ],
  },

  rotura: {
    titulo: 'Rotura de presa / relave',
    icono: 'ti-alert-triangle',
    pasos: [
      { id: 'presa', t: 'Coloca la presa / depósito', d: 'Marca el muro en el mapa: el vaso (cota-área-volumen) se saca del DEM.', ic: 'ti-building-dam',
        correr: () => clickAccion('colocar-presa'),
        hecho: (koi) => (koi.presas?.length || 0) > 0 },
      { id: 'hidrograma', t: 'Genera el hidrograma de rotura', d: 'Froehlich/MacDonald a partir del volumen y la brecha → crecida del pipeline.', ic: 'ti-wave-saw-tool',
        correr: () => clickAccion('breach'),
        hecho: (koi) => !!koi.reg?.breach || (koi.hidrogramaCrecida?.length || 0) > 0 },
      { id: 'malla', t: 'Define el dominio y la malla 2D', d: 'Dibuja el dominio inundable y genera la malla por donde correrá la onda.', ic: 'ti-grid-dots',
        correr: () => clickAccion('malla2d'),
        hecho: (koi) => !!koi.bati?.mesh2d },
      { id: 'rutear', t: 'Rutea la onda (Momentum 2D)', d: 'Saint-Venant 2D con la crecida de rotura (reología de relave si aplica). Se abre el diálogo Correr.', ic: 'ti-wave',
        correr: () => clickAccion('momentum2d'),
        hecho: (koi) => !!koi.bati?.resultMom2d },
      { id: 'informe', t: 'Genera el informe', d: 'Arma el informe con el escenario de rotura y la mancha de inundación.', ic: 'ti-file-text',
        correr: () => clickAccion('informe'),
        hecho: () => false },
    ],
  },

  socavacion: {
    titulo: 'Socavación en un cruce',
    icono: 'ti-arrow-down',
    pasos: [
      { id: 'eje', t: 'Eje en la sección del cruce', d: 'Calcula el eje hidráulico en la sección (WSE + velocidad): es el insumo de la socavación.', ic: 'ti-arrow-guide',
        correr: (koi) => koi.dock?.show?.('hidro'),
        hecho: (koi) => !!koi.hydro?._ejeRes },
      { id: 'socav', t: 'Calcula la socavación', d: 'General Lischtvan-Lebediev + Neill y local en pila (HEC-18/CSU) si hay ancho de pila.', ic: 'ti-arrow-down-circle',
        correr: (koi) => koi.dock?.show?.('hidro'),
        hecho: (koi) => !!koi.reg?.socavacion },
      { id: 'defensa', t: 'Dimensiona la defensa (opcional)', d: 'Enrocado / defensas fluviales (MC 3.708) para proteger el cruce.', ic: 'ti-wall',
        correr: () => clickAccion('enrocado'),
        hecho: (koi) => !!koi.reg?.enrocado },
      { id: 'verif', t: 'Verifica T y revancha (opcional)', d: 'Comprueba período de retorno de diseño y revancha del cruce.', ic: 'ti-checkbox',
        correr: () => clickAccion('verificaciones'),
        hecho: (koi) => !!koi.reg?.verificaciones },
    ],
  },
};

let _panel = null;

export function abrirFlujoGuiado(koi, recetaId = 'eje') {
  const receta = RECETAS[recetaId];
  if (!receta) return;
  inyectarCSS();
  if (_panel) _panel.remove();
  _panel = document.createElement('div');
  _panel.className = 'koi-guia';
  _panel.innerHTML = `
    <div class="koi-guia-hd">
      <span class="koi-guia-ti"><i class="ti ${receta.icono}" aria-hidden="true"></i> Asistente · ${receta.titulo}</span>
      <span class="koi-guia-prog"></span>
      <button class="koi-guia-x" title="Cerrar" aria-label="Cerrar">✕</button>
    </div>
    <div class="koi-guia-body"></div>
    <div class="koi-guia-ft">El paso encendido es el que toca ahora. Lo hecho queda con ✓ y puedes rehacerlo.</div>`;
  document.body.appendChild(_panel);
  _panel.querySelector('.koi-guia-x').addEventListener('click', () => { _panel.remove(); _panel = null; });
  hacerArrastrable(_panel, _panel.querySelector('.koi-guia-hd'));

  const body = _panel.querySelector('.koi-guia-body');
  const prog = _panel.querySelector('.koi-guia-prog');

  let _sig = '';
  const pintar = () => {
    if (!document.body.contains(_panel)) return;
    const estados = receta.pasos.map((p) => { try { return !!p.hecho(koi); } catch { return false; } });
    _sig = estados.map((x) => (x ? 1 : 0)).join('');
    // un paso está "listo" si el anterior está hecho (el primero siempre listo)
    prog.textContent = `${estados.filter(Boolean).length}/${receta.pasos.length}`;
    body.innerHTML = '';
    receta.pasos.forEach((p, i) => {
      const hecho = estados[i];
      const listo = i === 0 || estados[i - 1] || estados[i];   // no encierra al experto: si el previo está hecho, o este ya, va
      const bloq = !listo && !hecho;
      const row = document.createElement('button');
      row.className = 'koi-guia-paso' + (bloq ? ' bloq' : '') + (hecho ? ' ok' : (!bloq ? ' activo' : ''));
      row.disabled = bloq;
      row.innerHTML = `
        <span class="koi-guia-num">${hecho ? '<i class="ti ti-check" aria-hidden="true"></i>' : (i + 1)}</span>
        <span class="koi-guia-tx"><span class="koi-guia-pt">${p.t}</span><span class="koi-guia-pd">${p.d}</span></span>
        <span class="koi-guia-go"><i class="ti ${bloq ? 'ti-lock' : (hecho ? 'ti-refresh' : 'ti-player-play')}" aria-hidden="true"></i></span>`;
      if (!bloq) row.addEventListener('click', () => { try { p.correr(koi); } catch (e) { console.warn('guia:', e.message); } });
      body.appendChild(row);
    });
  };
  pintar();

  // Se refresca al cambiar la selección o registrarse un resultado…
  const off1 = bus.on('seleccion:cambio', pintar);
  const off2 = bus.on('reg:actualizado', pintar);
  const off3 = bus.on('crecida:cambio', pintar);
  // …y por si un motor no emite evento (malla/2D), un chequeo ligero que repinta
  // SOLO cuando cambia el estado de los pasos (no toca el DOM si nada cambió).
  const iv = setInterval(() => {
    if (!document.body.contains(_panel)) return;
    const s = receta.pasos.map((p) => { try { return p.hecho(koi) ? 1 : 0; } catch { return 0; } }).join('');
    if (s !== _sig) pintar();
  }, 1000);
  const limpiar = () => { off1?.(); off2?.(); off3?.(); clearInterval(iv); obs.disconnect(); };
  const obs = new MutationObserver(() => { if (!document.body.contains(_panel)) limpiar(); });
  obs.observe(document.body, { childList: true });
  return _panel;
}

function hacerArrastrable(panel, handle) {
  let sx, sy, ox, oy, drag = false;
  handle.style.cursor = 'move';
  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('.koi-guia-x')) return;
    drag = true; sx = e.clientX; sy = e.clientY;
    const r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
    panel.style.right = 'auto'; document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => { if (!drag) return; panel.style.left = (ox + e.clientX - sx) + 'px'; panel.style.top = (oy + e.clientY - sy) + 'px'; });
  window.addEventListener('mouseup', () => { drag = false; document.body.style.userSelect = ''; });
}

function inyectarCSS() {
  if (document.getElementById('koi-guia-css')) return;
  const st = document.createElement('style'); st.id = 'koi-guia-css';
  st.textContent = `
.koi-guia{position:fixed;top:64px;right:16px;width:300px;z-index:8000;background:var(--panel,#171b22);color:var(--fg,#e6e9ef);
  border:0.5px solid var(--border,#2a2f3a);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.4);font-size:13px;overflow:hidden}
.koi-guia-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:0.5px solid var(--border,#2a2f3a)}
.koi-guia-ti{font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px}
.koi-guia-prog{margin-left:auto;font-size:12px;color:var(--muted,#8b93a3)}
.koi-guia-x{background:0;border:0;color:var(--muted,#8b93a3);cursor:pointer;font-size:15px;line-height:1;padding:2px}
.koi-guia-body{padding:8px;display:flex;flex-direction:column;gap:6px}
.koi-guia-paso{display:flex;align-items:flex-start;gap:10px;text-align:left;background:transparent;color:inherit;font:inherit;
  border:0.5px solid var(--border,#2a2f3a);border-radius:9px;padding:9px 10px;cursor:pointer}
.koi-guia-paso.activo{border-color:#31c3ce;background:rgba(49,195,206,.08)}
.koi-guia-paso.ok{opacity:.9}
.koi-guia-paso.bloq{opacity:.5;cursor:default}
.koi-guia-num{flex:0 0 auto;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:700;background:var(--bg,#0e1116);color:var(--muted,#8b93a3)}
.koi-guia-paso.activo .koi-guia-num{background:#31c3ce;color:#04222a}
.koi-guia-paso.ok .koi-guia-num{background:#1d9e75;color:#04342c}
.koi-guia-tx{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.koi-guia-pt{font-weight:600;font-size:13px}
.koi-guia-pd{font-size:11.5px;color:var(--muted,#8b93a3);line-height:1.35}
.koi-guia-go{flex:0 0 auto;color:var(--muted,#8b93a3);align-self:center}
.koi-guia-paso.activo .koi-guia-go{color:#31c3ce}
.koi-guia-ft{padding:8px 12px;border-top:0.5px solid var(--border,#2a2f3a);font-size:11.5px;color:var(--muted,#8b93a3)}`;
  document.head.appendChild(st);
}
