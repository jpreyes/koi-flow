// ─────────────────────────────────────────────────────────────────────────────
// terrain.js — relieve 3D conceptual desde un DEM vendorizado (koi-flow).
// Adaptado de wind-shm/js/shm/terrain.js (jpreyes): mismo shader hipsométrico +
// curvas de nivel + hillshade, pero desacoplado (recibe una proyección de geo.js).
// `heightAt(x,z)` da la cota de escena para drapear el cauce/tramo y, luego, la
// cuenca y la mancha de inundación.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { fetchJSON } from './datos/fetch_json.js?v=5';

export class Terrain {
  // dem: {bbox,nx,ny,min,max,data}  ·  proj: makeProjection(...)
  constructor(dem, proj, opts = {}) {
    this.dem = dem;
    this.proj = proj;
    this.vex = opts.vex ?? 1.5;                 // exageración vertical (relieve árido es plano)
    this.scale = proj.scale;
    this.base = dem.min * this.scale * this.vex; // la cota mínima va a y=0
    this.mesh = this._build();
  }

  // Elevación (m) interpolada bilineal en la grilla DEM, dada lon/lat.
  _elev(lon, lat) {
    const { bbox, nx, ny, data } = this.dem;
    let fx = (lon - bbox.lon0) / (bbox.lon1 - bbox.lon0) * (nx - 1);
    let fy = (lat - bbox.lat0) / (bbox.lat1 - bbox.lat0) * (ny - 1);
    fx = Math.max(0, Math.min(nx - 1.001, fx)); fy = Math.max(0, Math.min(ny - 1.001, fy));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
    const g = (x, y) => data[y * nx + x];
    return g(x0, y0) * (1 - dx) * (1 - dy) + g(x0 + 1, y0) * dx * (1 - dy)
         + g(x0, y0 + 1) * (1 - dx) * dy + g(x0 + 1, y0 + 1) * dx * dy;
  }

  // Cota de ESCENA (Y) en una posición (x,z) de escena.
  heightAt(x, z) {
    const { lon, lat } = this.proj.toGeo(x, z);
    return this._elev(lon, lat) * this.scale * this.vex - this.base;
  }

  _build() {
    const { bbox, nx, ny, data, min, max } = this.dem;
    const pos = new Float32Array(nx * ny * 3);
    const uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const u = i / (nx - 1), v = j / (ny - 1);
      const lon = bbox.lon0 + u * (bbox.lon1 - bbox.lon0);
      const lat = bbox.lat0 + v * (bbox.lat1 - bbox.lat0);
      const s = this.proj.toScene(lon, lat), k = (j * nx + i) * 3, m = (j * nx + i) * 2;
      pos[k] = s.x; pos[k + 1] = data[j * nx + i] * this.scale * this.vex - this.base; pos[k + 2] = s.z;
      uv[m] = u; uv[m + 1] = v;
    }
    const idx = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();

    const yMin = 0, yMax = (max - min) * this.scale * this.vex;
    const interval = 50 * this.scale * this.vex;   // curvas cada 50 m
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMin: { value: yMin }, uMax: { value: yMax },
        uInterval: { value: interval },
        uLight: { value: new THREE.Vector3(0.5, 0.85, 0.3).normalize() },
        uDim: { value: 0.0 },
      },
      vertexShader: `
        varying float vH; varying vec3 vN; varying vec2 vUv;
        void main(){ vH = position.y; vN = normalize(normal); vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        precision highp float;
        varying float vH; varying vec3 vN; varying vec2 vUv;
        uniform float uMin, uMax, uInterval, uDim; uniform vec3 uLight;
        vec3 ramp(float t){                       // árido: arenas → ocres → claros de altura
          vec3 c0 = vec3(0.78, 0.72, 0.58);
          vec3 c1 = vec3(0.83, 0.76, 0.60);
          vec3 c2 = vec3(0.88, 0.84, 0.74);
          vec3 c3 = vec3(0.94, 0.95, 0.96);
          if(t < 0.4) return mix(c0, c1, t / 0.4);
          if(t < 0.75) return mix(c1, c2, (t - 0.4) / 0.35);
          return mix(c2, c3, (t - 0.75) / 0.25);
        }
        void main(){
          float t = clamp((vH - uMin) / max(uMax - uMin, 1.0), 0.0, 1.0);
          vec3 col = ramp(t);
          float lit = clamp(dot(normalize(vN), uLight), 0.0, 1.0);
          float hs = 0.62;
          col *= hs + (1.0 - hs) * lit;
          col = mix(col, vec3(0.20, 0.18, 0.30), (1.0 - lit) * 0.30);
          float e = vH / uInterval;
          float d = abs(fract(e - 0.5) - 0.5) / max(fwidth(e), 1e-4);
          float line = 1.0 - clamp(d, 0.0, 1.0);
          col = mix(col, col * 0.70, line * 0.45);
          float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
          float a = smoothstep(0.0, 0.06, edge);
          a *= (1.0 - uDim * 0.35);
          gl_FragColor = vec4(col, a);
        }`,
      side: THREE.DoubleSide, transparent: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1; mesh.name = 'terrain';
    return mesh;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// Carga el DEM y devuelve un Terrain listo para añadir a la escena.
export async function loadTerrain(url, proj, opts) {
  const dem = await fetchJSON(url, { contexto: 'DEM del tramo' });
  return new Terrain(dem, proj, opts);
}
