// ─────────────────────────────────────────────────────────────────────────────
// hud.js — ventanas HUD flotantes reutilizables (koi-flow, rediseño UI).
// Cada HUD es una ventana dentro de la escena que se puede MOVER (arrastrando el
// encabezado), REDIMENSIONAR (esquina inferior derecha), MINIMIZAR y CERRAR. El
// HudManager las crea sobre el viewport; con `open(id, …)` reutiliza la ventana si
// ya existe (la trae al frente y actualiza su contenido) en vez de duplicarla.
// Inspirado en el HUD flotante de wind-shm (jpreyes). Solo DOM/overlay.
// ─────────────────────────────────────────────────────────────────────────────

let _z = 40;   // z-index incremental para traer al frente

export class Hud {
  constructor({ id, title, parent, x = 60, y = 60, w = 360, h = 320, onClose, onFocus, onMin } = {}) {
    this.id = id; this.parent = parent; this.onClose = onClose; this.onFocus = onFocus; this.onMin = onMin;
    const elw = document.createElement('div');
    elw.className = 'hud';
    elw.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${++_z}`;
    elw.innerHTML = `
      <div class="hud-head">
        <span class="hud-title">${title || ''}</span>
        <div class="hud-ctl">
          <button class="hud-btn hud-min" title="Minimizar">–</button>
          <button class="hud-btn hud-close" title="Cerrar">✕</button>
        </div>
      </div>
      <div class="hud-body"></div>
      <div class="hud-resize" title="Redimensionar"></div>`;
    parent.appendChild(elw);
    this.el = elw;
    this.head = elw.querySelector('.hud-head');
    this.bodyEl = elw.querySelector('.hud-body');
    this.titleEl = elw.querySelector('.hud-title');
    elw.addEventListener('mousedown', () => this.focus(), true);
    elw.querySelector('.hud-close').addEventListener('click', () => this.close());
    elw.querySelector('.hud-min').addEventListener('click', () => this.toggleMin());
    this._wireDrag();
    this._wireResize();
  }

  focus() { this.el.style.zIndex = ++_z; this.onFocus?.(this); }
  setTitle(t) { this.titleEl.textContent = t || ''; }
  setBody(html) { this.bodyEl.innerHTML = html; this._restaurarForm(); }
  get body() { return this.bodyEl; }

  // ── memoria de formularios: los inputs/selects con id recuerdan su último valor
  // por HUD (localStorage), para no re-tipear los parámetros en cada sesión. ────
  _formKey() { return `koi_form_${this.id}`; }
  _restaurarForm() {
    let store; try { store = JSON.parse(localStorage.getItem(this._formKey())) || {}; } catch { store = {}; }
    for (const el of this.bodyEl.querySelectorAll('input[id], select[id]')) {
      const v = store[el.id];
      if (v == null) continue;
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type !== 'file') el.value = v;
    }
    if (!this._formWired) {
      this._formWired = true;
      this.bodyEl.addEventListener('change', (ev) => {
        const el = ev.target;
        if (!el.id || !(el.matches('input, select')) || el.type === 'file') return;
        let s; try { s = JSON.parse(localStorage.getItem(this._formKey())) || {}; } catch { s = {}; }
        s[el.id] = el.type === 'checkbox' ? el.checked : el.value;
        try { localStorage.setItem(this._formKey(), JSON.stringify(s)); } catch { /* cuota llena: se ignora */ }
      });
    }
  }

  // Minimizar ahora OCULTA la ventana; su chip en la barra de tareas la restaura.
  toggleMin(force) {
    this._min = (force == null) ? !this._min : !!force;
    this.el.classList.toggle('min', this._min);
    this.el.style.display = this._min ? 'none' : '';
    if (!this._min) this.el.style.zIndex = ++_z;
    this.onMin?.(this);
  }

  close() { this.el.remove(); this.onClose?.(this.id); }

  _clampInParent() {
    const p = this.parent.getBoundingClientRect(), r = this.el.getBoundingClientRect();
    let x = r.left - p.left, y = r.top - p.top;
    x = Math.max(0, Math.min(p.width - 40, x));
    y = Math.max(0, Math.min(p.height - 28, y));
    this.el.style.left = x + 'px'; this.el.style.top = y + 'px';
  }

  _wireDrag() {
    let sx, sy, ox, oy, drag = false;
    const onMove = (e) => {
      if (!drag) return;
      const p = this.parent.getBoundingClientRect();
      let x = ox + (e.clientX - sx), y = oy + (e.clientY - sy);
      x = Math.max(0, Math.min(p.width - 40, x));
      y = Math.max(0, Math.min(p.height - 28, y));
      this.el.style.left = x + 'px'; this.el.style.top = y + 'px';
    };
    const onUp = () => { drag = false; document.body.style.cursor = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    this.head.addEventListener('mousedown', (e) => {
      if (e.target.closest('.hud-btn')) return;
      drag = true; sx = e.clientX; sy = e.clientY;
      const r = this.el.getBoundingClientRect(), p = this.parent.getBoundingClientRect();
      ox = r.left - p.left; oy = r.top - p.top;
      document.body.style.cursor = 'grabbing'; e.preventDefault();
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    });
  }

  _wireResize() {
    const handle = this.el.querySelector('.hud-resize');
    let sx, sy, sw, sh, drag = false;
    const onMove = (e) => {
      if (!drag) return;
      this.el.style.width = Math.max(220, sw + (e.clientX - sx)) + 'px';
      this.el.style.height = Math.max(140, sh + (e.clientY - sy)) + 'px';
    };
    const onUp = () => { drag = false; document.body.style.cursor = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    handle.addEventListener('mousedown', (e) => {
      if (this._min) return;
      drag = true; sx = e.clientX; sy = e.clientY;
      const r = this.el.getBoundingClientRect(); sw = r.width; sh = r.height;
      document.body.style.cursor = 'nwse-resize'; e.preventDefault(); e.stopPropagation();
      window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    });
  }
}

export class HudManager {
  constructor(parent) {
    this.parent = parent; this.huds = new Map();
    // Barra de tareas: un chip por HUD abierto, para que ninguna ventana se pierda
    // detrás de otra. Vive abajo-centro del viewport; vacía → oculta.
    this.bar = document.createElement('div');
    this.bar.className = 'hud-bar'; this.bar.style.display = 'none';
    parent.appendChild(this.bar);
  }

  // Abre (o reutiliza si el id ya existe) una ventana HUD.
  open(id, { title, html, w = 380, h = 340, x, y } = {}) {
    let hud = this.huds.get(id);
    if (hud && hud.el.isConnected) {
      if (title != null) hud.setTitle(title);
      if (html != null) hud.setBody(html);
      if (hud._min) hud.toggleMin(false);
      hud.focus();
      this._sync();
      return hud;
    }
    // posición en cascada para no apilar exactamente
    const n = this.huds.size;
    const px = x ?? (24 + (n % 5) * 26), py = y ?? (24 + (n % 5) * 26);
    // Usamos el `id` capturado (no el argumento) porque varios HUD envuelven
    // onClose para limpiar listeners y a veces llaman prev?.() sin reenviar el id.
    hud = new Hud({
      id, title, parent: this.parent, x: px, y: py, w, h,
      onClose: () => { this.huds.delete(id); this._sync(); },
      onFocus: () => this._sync(), onMin: () => this._sync(),
    });
    if (html != null) hud.setBody(html);
    this.huds.set(id, hud);
    this._sync();
    return hud;
  }
  get(id) { return this.huds.get(id); }
  close(id) { this.huds.get(id)?.close(); }
  closeAll() { for (const h of [...this.huds.values()]) h.close(); }

  // Reconstruye los chips de la barra de tareas y marca el HUD al frente.
  _sync() {
    if (!this.bar) return;
    this.bar.style.display = this.huds.size ? 'flex' : 'none';
    let topId = null, topZ = -1;
    for (const [id, h] of this.huds) { if (!h._min) { const z = +h.el.style.zIndex || 0; if (z > topZ) { topZ = z; topId = id; } } }
    this.bar.innerHTML = '';
    for (const [id, h] of this.huds) {
      const chip = document.createElement('button');
      chip.className = 'hud-chip' + (h._min ? ' min' : '') + (id === topId ? ' active' : '');
      chip.title = h.titleEl.textContent;
      chip.innerHTML = `<span class="hud-chip-t">${h.titleEl.textContent}</span><span class="hud-chip-x" title="Cerrar">✕</span>`;
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.hud-chip-x')) { h.close(); return; }
        if (h._min) h.toggleMin(false);            // restaurar
        else if (id === topId) h.toggleMin(true);   // minimizar el que está al frente
        else h.focus();                             // traer al frente
      });
      this.bar.appendChild(chip);
    }
  }
}
