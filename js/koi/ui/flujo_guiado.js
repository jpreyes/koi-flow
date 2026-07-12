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
const RECETAS = {
  eje: {
    titulo: 'Eje hidráulico 1D',
    icono: 'ti-wave-sine',
    pasos: [
      { id: 'cauce', t: 'Elegí el cauce', d: 'Seleccioná un tramo en el mapa o el árbol, o dibujá uno con la herramienta Tramo.', ic: 'ti-ripple',
        correr: (koi) => koi.capas?._dibujarTramo?.(),
        hecho: (koi) => !!(koi.bati?.tramo || ['tramo', 'reach'].includes(activo()?.tipo)) },
      { id: 'relieve', t: 'Descargá el relieve (DEM)', d: 'Bajá el relieve del sector: de ahí salen las secciones y las cotas.', ic: 'ti-mountain',
        correr: () => clickAccion('remanso1d'),
        hecho: (koi) => !!(koi.bati?.demM || koi.bati?.tramo?.demGrid || koi.bati?.fused) },
      { id: 'secciones', t: 'Generá las secciones', d: 'Extraé las secciones transversales del cauce desde el DEM.', ic: 'ti-chart-line',
        correr: () => clickAccion('remanso1d'),
        hecho: (koi) => !!(koi.bati?.secciones?.length || koi.bati?._secciones?.length) },
      { id: 'eje', t: 'Corré el eje 1D', d: 'Paso estándar (Manning) sobre las secciones → perfil de agua (WSE, V, Fr).', ic: 'ti-arrow-guide',
        correr: () => clickAccion('remanso1d'),
        hecho: (koi) => !!(koi.bati?._remanso || koi.reg?.remanso || koi.bati?.result1d) },
      { id: 'socav', t: 'Socavación (opcional)', d: 'Con el resultado del eje, calculá la socavación (HEC-18) donde haya puente/estructura.', ic: 'ti-arrow-down',
        correr: (koi) => koi.dock?.show?.('hidro'),
        hecho: (koi) => !!koi.reg?.socavacion },
      { id: 'informe', t: 'Generá el informe', d: 'Armá el informe (PDF/Word) con la cuenca, la hidrología y el eje.', ic: 'ti-file-text',
        correr: () => clickAccion('informe'),
        hecho: () => false },
    ],
  },
  // Molde para el próximo flujo (rotura de relave, socavación, etc.):
  // rotura: { titulo:'Rotura de presa / relave', icono:'ti-alert-triangle', pasos:[…] },
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
    <div class="koi-guia-ft">El paso encendido es el que toca ahora. Lo hecho queda con ✓ y podés rehacerlo.</div>`;
  document.body.appendChild(_panel);
  _panel.querySelector('.koi-guia-x').addEventListener('click', () => { _panel.remove(); _panel = null; });
  hacerArrastrable(_panel, _panel.querySelector('.koi-guia-hd'));

  const body = _panel.querySelector('.koi-guia-body');
  const prog = _panel.querySelector('.koi-guia-prog');

  const pintar = () => {
    if (!document.body.contains(_panel)) return;
    const estados = receta.pasos.map((p) => { try { return !!p.hecho(koi); } catch { return false; } });
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

  // Se refresca cuando cambia la selección o se registra un resultado.
  const off1 = bus.on('seleccion:cambio', pintar);
  const off2 = bus.on('reg:actualizado', pintar);
  const off3 = bus.on('crecida:cambio', pintar);
  const obs = new MutationObserver(() => { if (!document.body.contains(_panel)) { off1?.(); off2?.(); off3?.(); obs.disconnect(); } });
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
