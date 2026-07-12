// ─────────────────────────────────────────────────────────────────────────────
// dock.js — panel derecho con PESTAÑAS tipo Chrome (koi-flow, rediseño UI).
//
// Antes: una barra vertical de íconos "estancada" en el borde + 7 pestañas con
// duplicados (DEM y Cuenca separados; Hidráulica ≡ Batimetría). Ahora: las
// pestañas son de TEXTO, horizontales y VIVEN DENTRO de la ventana (viajan y se
// redimensionan con ella, estilo pestañas de navegador). Se agrupan en 4:
//   CUENCA (relieve/DEM + delineación) · HIDROLOGÍA · HIDRÁULICA (batimetría +
//   secciones/eje/socavación) · 2D
// Cada grupo apila los "hosts" de contenido existentes, así ningún panel cambia:
// siguen escribiendo en dock.hosts.<clave> como antes. show() acepta tanto una
// clave de grupo ('hidraulica') como una clave de host ('bati','hidro',…) para
// mantener compatibilidad con hydro/bati/flujo2d.toggle().
// Controles de ventana: redimensionar (borde izq), expandir/contraer ancho, cerrar.
// ─────────────────────────────────────────────────────────────────────────────

// La 2D se fusionó dentro de "Hidráulica" (lienzo unificado 1D/2D) → 3 grupos.
// Fase E (E5): el panel derecho quedó SOLO como AYUDA contextual. Todo el análisis
// (cuenca/hidrología/hidráulica/estructuras) migró a ventanas flotantes (DockShim→HUD).
const TABS = [
  { key: 'ayuda', label: 'Ayuda', hosts: ['ayuda'] },
];
const HOST_KEYS = ['ayuda'];
// host → pestaña que lo contiene
const TAB_OF = {};
for (const t of TABS) for (const h of t.hosts) TAB_OF[h] = t.key;

export class Dock {
  constructor(root = document.getElementById('main') || document.body) {
    this.main = root;
    this.hosts = {};
    this.active = 'ayuda';         // clave (host o grupo) mostrada por última vez
    this.activeTab = 'ayuda';      // grupo visible
    this.COLLAPSED = 34;           // ancho al estar cerrado (px)
    this.dwNormal = 372;           // ancho normal (px)
    this.dwWide = Math.min(720, Math.round(window.innerWidth * 0.5));
    this.dw = this.dwNormal;       // ancho actual de la ventana
    this.expanded = false;

    const wrap = document.createElement('div');
    wrap.className = 'dock';
    const groups = TABS.map((t) => `
      <div class="dock-group" data-group="${t.key}">
        ${t.hosts.map((h) => `${t.seps?.[h] ? `<div class="dock-sep">${t.seps[h]}</div>` : ''}<div class="dock-body" data-body="${h}"></div>`).join('')}
      </div>`).join('');
    wrap.innerHTML = `
      <div class="dock-win">
        <div class="dock-resize" title="Arrastra para redimensionar"></div>
        <nav class="dock-tabs" style="display:none">
          ${TABS.map((t) => `<button class="dock-tab" data-tab="${t.key}" title="${t.label}">${t.label}</button>`).join('')}
        </nav>
        <div class="dock-main">
          <div class="dock-topbar">
            <div class="dock-head"><span class="dock-title" style="font-weight:600;margin-right:8px"></span><span class="dock-sub"></span></div>
            <div class="dock-winctl">
              <button class="dock-exp" title="Expandir / contraer ancho">⤢</button>
              <button class="dock-close" title="Cerrar panel">✕</button>
            </div>
          </div>
          <div class="dock-bodies">${groups}</div>
        </div>
      </div>
      <button class="dock-reopen" title="Abrir paneles"><span>PANELES</span></button>`;
    root.appendChild(wrap);

    this.el = wrap;
    this.win = wrap.querySelector('.dock-win');
    this.subEl = wrap.querySelector('.dock-sub');
    this.titleEl = wrap.querySelector('.dock-title');
    for (const h of HOST_KEYS) this.hosts[h] = wrap.querySelector(`[data-body="${h}"]`);

    wrap.querySelectorAll('.dock-tab').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.tab;
      if (this.isOpen() && this.activeTab === k) this.close();
      else this.show(k);
    }));
    wrap.querySelector('.dock-close').addEventListener('click', () => this.close());
    wrap.querySelector('.dock-exp').addEventListener('click', () => this.toggleWide());
    wrap.querySelector('.dock-reopen').addEventListener('click', () => this.show(this.active));
    this._wireResize(wrap.querySelector('.dock-resize'));
  }

  // Arrastre del borde izquierdo de la ventana para redimensionar su ancho.
  _wireResize(handle) {
    let startX = 0, startW = 0, drag = false;
    const onMove = (e) => {
      if (!drag) return;
      this.dw = Math.max(260, Math.min(window.innerWidth * 0.75, startW + (startX - e.clientX)));
      this.expanded = this.dw > this.dwNormal + 40;
      if (this.isOpen()) this.onResize?.(this.dw);
      this.map?.invalidateSize?.();
    };
    const onUp = () => { drag = false; document.body.style.cursor = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); this.map?.invalidateSize?.(); };
    handle.addEventListener('mousedown', (e) => {
      drag = true; startX = e.clientX; startW = this.win.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize'; e.preventDefault();
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    });
  }

  toggleWide() {
    this.expanded = !this.expanded;
    this.dw = this.expanded ? this.dwWide : this.dwNormal;
    if (this.isOpen()) this.onResize?.(this.dw);
    setTimeout(() => this.map?.invalidateSize?.(), 60);
  }

  host(tab) { return this.hosts[tab]; }
  isOpen() { return this.el.classList.contains('open'); }
  open() { this.el.classList.add('open'); this.onResize?.(this.dw); setTimeout(() => this.map?.invalidateSize?.(), 220); }
  close() { this.el.classList.remove('open'); this.onResize?.(this.COLLAPSED); setTimeout(() => this.map?.invalidateSize?.(), 220); }

  // Acepta clave de grupo ('hidraulica') o de host ('bati','hidro',…).
  show(key) {
    const tabKey = TAB_OF[key] || (TABS.some((t) => t.key === key) ? key : this.activeTab);
    this.active = key;
    this.activeTab = tabKey;
    this.el.querySelectorAll('.dock-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabKey));
    this.el.querySelectorAll('.dock-group').forEach((g) => g.classList.toggle('show', g.dataset.group === tabKey));
    // El menú superior es la única navegación: el dock solo rotula QUÉ workspace muestra.
    if (this.titleEl) this.titleEl.textContent = (TABS.find((t) => t.key === tabKey) || {}).label || '';
    this.open();
  }

  setSub(txt) { this.subEl.textContent = txt || ''; }
  setBadge(key, txt) {
    const tabKey = TAB_OF[key] || key;
    const b = this.el.querySelector(`.dock-tab[data-tab="${tabKey}"]`);
    if (!b) return;
    let dot = b.querySelector('.dock-dot');
    if (txt) { if (!dot) { dot = document.createElement('span'); dot.className = 'dock-dot'; b.appendChild(dot); } dot.textContent = txt; }
    else if (dot) dot.remove();
  }
}
