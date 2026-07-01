// ─────────────────────────────────────────────────────────────────────────────
// scene_view.js — escena Three.js de koi-flow: relieve 3D + cauce/tramo drapeado.
// Versión Fase 0 (scaffold): cámara orbital, luz, grid, terreno y la polilínea
// del tramo seleccionado pegada al relieve. Las capas de cuenca, secciones,
// mancha de inundación y puente se montan encima en fases siguientes.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Terrain } from './terrain.js?v=2';
import { makeProjection, bboxCenter } from './geo.js?v=2';
import { tableroSobre } from './estructuras/estructuras.js?v=2';

export class SceneView {
  constructor(container) {
    this.el = container;
    this.scene = new THREE.Scene();
    this.scene.background = null;

    const w = container.clientWidth || 800, h = container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
    this.camera.position.set(60, 55, 90);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5a4d3a, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(60, 120, 40);
    this.scene.add(sun);

    this.terrain = null;
    this.proj = null;
    this.tramoLine = null;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._animate = this._animate.bind(this);
    this.renderer.setAnimationLoop(this._animate);
  }

  // Carga el relieve desde un DEM JSON pre-generado (formato data/dem_*.json).
  async loadSector(demUrl, tramoFeature) {
    const demHead = await (await fetch(demUrl)).json();
    this._mountDem(demHead, tramoFeature);
  }

  // Carga el relieve desde una grilla bajada en el navegador (dem_tiles.fetchDEM):
  //   grid = { nx, ny, bbox:{west,south,east,north}, data:Float32Array }
  loadSectorGrid(grid, tramoFeature) {
    this._mountDem(SceneView.gridToDem(grid), tramoFeature);
  }

  // Convierte la grilla de fetchDEM al formato que espera Terrain.
  static gridToDem(g) {
    let min = Infinity, max = -Infinity;
    for (const v of g.data) { if (v < min) min = v; if (v > max) max = v; }
    return { bbox: { lon0: g.bbox.west, lat0: g.bbox.north, lon1: g.bbox.east, lat1: g.bbox.south },
      nx: g.nx, ny: g.ny, min, max, data: g.data };
  }

  _mountDem(dem, tramoFeature) {
    const c = bboxCenter(dem.bbox);
    this.proj = makeProjection(c.lon, c.lat, 0.01);
    if (this.terrain) { this.scene.remove(this.terrain.mesh); this.terrain.dispose(); }
    this.terrain = new Terrain(dem, this.proj, { vex: 1.5 });
    this.scene.add(this.terrain.mesh);
    if (!this.grid) {
      this.grid = new THREE.GridHelper(160, 32, 0x9fb0c4, 0xd6dde6);
      this.grid.material.opacity = 0.25; this.grid.material.transparent = true;
      this.grid.position.y = -0.01;
      this.scene.add(this.grid);
    }
    if (tramoFeature) this.setTramo(tramoFeature);
    this._frameCamera();
  }

  setTramo(feature) {
    if (this.tramoLine) { this.scene.remove(this.tramoLine); this.tramoLine.geometry.dispose(); this.tramoLine.material.dispose(); }
    const coords = feature.geometry.coordinates;
    const pts = coords.map(([lon, lat]) => {
      const s = this.proj.toScene(lon, lat);
      const y = (this.terrain ? this.terrain.heightAt(s.x, s.z) : 0) + 0.4; // un pelo sobre el relieve
      return new THREE.Vector3(s.x, y, s.z);
    });
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xe23b5a, linewidth: 3 });
    this.tramoLine = new THREE.Line(geo, mat);
    this.tramoLine.renderOrder = 2;
    this.scene.add(this.tramoLine);
  }

  // Estructuras 3D: cajas/cilindros simples posados en el terreno (misma escala vex).
  loadEstructuras(estructuras) {
    this.clearEstructuras();
    if (!this.proj) return;
    const g = new THREE.Group();
    const sc = this.proj.scale, vex = this.terrain?.vex ?? 1.5, vy = sc * vex;
    for (const e of estructuras || []) {
      const poly = e.planta; if (!poly || poly.length < 2) continue;
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, cxLL = 0, cyLL = 0;
      for (const [lo, la] of poly) { const s = this.proj.toScene(lo, la); minx = Math.min(minx, s.x); maxx = Math.max(maxx, s.x); minz = Math.min(minz, s.z); maxz = Math.max(maxz, s.z); cxLL += lo; cyLL += la; }
      cxLL /= poly.length; cyLL /= poly.length;
      const cs = this.proj.toScene(cxLL, cyLL);
      const baseY = this.terrain ? this.terrain.heightAt(cs.x, cs.z) : 0;
      let alto = (e.params.alto || e.params.espesor || 2) * vy;
      // pilas/estribos/alcantarillas bajo un tablero TOPAN en su cara inferior (luz libre)
      if (e.tipo !== 'tablero' && e.tipo !== 'viga') {
        const t = tableroSobre(e, estructuras);
        if (t) alto = Math.min(alto, (t.params.luzLibre || 2) * vy);
      }
      const solido = e.solido;
      const color = solido ? 0x9b6bd6 : 0xe0a93f;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, transparent: !solido, opacity: solido ? 1 : 0.85 });
      let mesh;
      if (e.forma === 'circ') {
        const r = (e.params.diametro || 1) / 2 * sc;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, alto, 20), mat);
      } else {
        const w = Math.max(maxx - minx, 0.02), d = Math.max(maxz - minz, 0.02);
        mesh = new THREE.Mesh(new THREE.BoxGeometry(w, alto, d), mat);
      }
      // el tablero/viga flotan sobre el cauce (luz libre); el resto se posa en el terreno
      const off = (e.tipo === 'tablero' || e.tipo === 'viga') ? (e.params.luzLibre || 2) * vy : 0;
      mesh.position.set(cs.x, baseY + off + alto / 2, cs.z);
      mesh.userData.estr = e.id;
      g.add(mesh);
    }
    this.estrGroup = g; this.scene.add(g);
    this._wireEstrDrag();
  }
  clearEstructuras() { if (this.estrGroup) { this.scene.remove(this.estrGroup); this.estrGroup.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); this.estrGroup = null; } }

  // Arrastre de estructuras en 3D: raycast sobre las piezas y mover sobre un plano
  // horizontal; al soltar, convierte a lon/lat (proj.fromScene) y avisa onEstrMove.
  _wireEstrDrag() {
    if (this._estrDragWired) return; this._estrDragWired = true;
    const dom = this.renderer.domElement, ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    let drag = null;
    const setM = (e) => { const r = dom.getBoundingClientRect(); mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1; };
    dom.addEventListener('pointerdown', (e) => {
      if (!this.estrGroup || !this.proj) return;
      setM(e); ray.setFromCamera(mouse, this.camera);
      const hits = ray.intersectObjects(this.estrGroup.children, false);
      if (hits.length) { drag = hits[0].object; this.controls.enabled = false; plane.constant = -drag.position.y; }
    });
    dom.addEventListener('pointermove', (e) => {
      if (!drag) return; setM(e); ray.setFromCamera(mouse, this.camera);
      if (ray.ray.intersectPlane(plane, hit)) { drag.position.x = hit.x; drag.position.z = hit.z; }
    });
    const end = () => {
      if (!drag) return; this.controls.enabled = true;
      const ll = this.proj.toGeo(drag.position.x, drag.position.z);
      this.onEstrMove?.(drag.userData.estr, ll.lon, ll.lat);
      drag = null;
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointerleave', end);
  }

  _frameCamera() {
    // encuadra el relieve: tamaño aproximado de la escena
    const box = new THREE.Box3().setFromObject(this.terrain.mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z);
    this.controls.target.copy(center);
    this.camera.position.set(center.x + r * 0.7, center.y + r * 0.8, center.z + r * 0.9);
    this.camera.near = r / 1000; this.camera.far = r * 50; this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  setVisible(v) { this.renderer.domElement.style.display = v ? '' : 'none'; if (v) this.resize(); }

  // Captura el 3D como PNG (render + toDataURL en el mismo tick para el informe).
  snapshot() {
    try { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
    catch { return null; }
  }
}
