// ─────────────────────────────────────────────────────────────────────────────
// tree.js — árbol lateral Proyecto ▸ Sector (koi-flow). Hereda el patrón del
// árbol Parque▸Zona▸Torre de wind-shm/js/shm/parks.js (jpreyes), simplificado.
// ─────────────────────────────────────────────────────────────────────────────
export class Tree {
  constructor(container, { onSelect } = {}) {
    this.el = container;
    this.onSelect = onSelect;
    this.selected = null;
  }

  render(project) {
    this.project = project;
    const el = this.el;
    el.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'tree-proj';
    head.innerHTML = `<span class="tree-ico">🗂️</span><span>${project.name}</span>`;
    el.appendChild(head);

    const ul = document.createElement('ul');
    ul.className = 'tree-list';
    for (const t of project.tramos) {
      const li = document.createElement('li');
      li.className = 'tree-item';
      li.dataset.name = t.name;
      const hasDem = t.dem ? '🏔️' : '·';
      li.innerHTML = `<span class="tree-ico">📍</span>
        <span class="tree-label">${t.name}</span>
        <span class="tree-meta" title="${t.dem ? 'DEM disponible' : 'sin DEM aún'}">${hasDem} ${t.npts}p</span>`;
      li.addEventListener('click', () => { this.select(t.name); this.onSelect?.(t); });
      ul.appendChild(li);
    }
    el.appendChild(ul);
  }

  select(name) {
    this.selected = name;
    this.el.querySelectorAll('.tree-item').forEach((li) =>
      li.classList.toggle('sel', li.dataset.name === name));
  }
}
