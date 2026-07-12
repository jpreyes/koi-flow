// ─────────────────────────────────────────────────────────────────────────────
// dock_shim.js — adaptador Dock→HUD (Fase E). Expone la MISMA API que usa un panel
// para hablar con el dock (hosts · show · setSub · isOpen · close · active), pero
// respaldada por una VENTANA FLOTANTE (HUD). Así los paneles grandes (bati, hydro)
// migran a flotante SIN reescribirse: solo se les pasa un DockShim en vez del Dock.
// Si el panel tenía varias "pestañas" (hosts), el shim las muestra como sub-pestañas
// dentro de la misma ventana.
// ─────────────────────────────────────────────────────────────────────────────

export class DockShim {
  constructor(huds, id, { title, tabs, w = 400, h = 620 } = {}) {
    this.huds = huds; this._id = id; this._title = title;
    this._tabs = tabs; this._w = w; this._h = h;
    this.active = tabs[0].key;
    this.hosts = {};

    // Contenedor persistente (sobrevive a cerrar/reabrir el HUD): nav + sub-hosts.
    this.root = document.createElement('div');
    this.root.className = 'dsh-root';
    const hasTabs = tabs.length > 1;
    const nav = hasTabs ? `<div class="dsh-tabs">${tabs.map((t) => `<button class="dsh-tab" data-k="${t.key}">${t.label}</button>`).join('')}</div>` : '';
    this.root.innerHTML = `${nav}<div class="dsh-sub"></div><div class="dsh-bodies"></div>`;
    this.subEl = this.root.querySelector('.dsh-sub');
    const bodies = this.root.querySelector('.dsh-bodies');
    for (const t of tabs) {
      const d = document.createElement('div'); d.className = 'dsh-body'; d.dataset.k = t.key;
      bodies.appendChild(d); this.hosts[t.key] = d;
    }
    if (hasTabs) this.root.querySelectorAll('.dsh-tab').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.k)));
    this._sync();
  }

  _hud() { return this.huds.get(this._id); }

  _sync() {
    for (const t of this._tabs) this.hosts[t.key].style.display = t.key === this.active ? '' : 'none';
    this.root.querySelectorAll('.dsh-tab').forEach((b) => b.classList.toggle('active', b.dataset.k === this.active));
  }

  // show(key): abre (o reutiliza) el HUD y muestra la sub-pestaña `key`.
  show(key) {
    if (key && this.hosts[key]) this.active = key;
    const hud = this.huds.open(this._id, { title: this._title, w: this._w, h: this._h });
    if (this.root.parentElement !== hud.body) hud.body.appendChild(this.root);
    this._sync();
    return hud;
  }

  open() { return this.show(this.active); }
  close() { this.huds.close(this._id); }
  isOpen() { const h = this._hud(); return !!(h && h.el.isConnected && !h._min); }
  setSub(txt) { if (this.subEl) this.subEl.textContent = txt || ''; }
  setBadge() { /* la barra de tareas de HUD ya rotula la ventana */ }
}
