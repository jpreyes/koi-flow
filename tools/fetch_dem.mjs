// ─────────────────────────────────────────────────────────────────────────────
// fetch_dem.mjs — baja un DEM (relieve) de AWS Terrain Tiles y lo vendoriza a JSON.
// Adaptado de wind-shm (jpreyes) para koi-flow: bbox/zoom/salida por CLI.
//
// Fuente: AWS Terrain Tiles (Terrarium), gratis y sin API key:
//   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
//   elevación(m) = (R*256 + G + B/256) − 32768
//
// Uso:
//   node tools/fetch_dem.mjs --lon0 -69.252 --lat0 -20.001 --lon1 -69.192 --lat1 -20.075 \
//        --z 13 --nx 240 --ny 240 --out data/dem_tramo3.json
//   (lat0 = borde NORTE = menos negativo ; lat1 = borde SUR = más negativo)
// ─────────────────────────────────────────────────────────────────────────────
import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const BBOX = {
  lon0: parseFloat(arg('lon0', -69.252)), lat0: parseFloat(arg('lat0', -20.001)),
  lon1: parseFloat(arg('lon1', -69.192)), lat1: parseFloat(arg('lat1', -20.075)),
};
const Z = parseInt(arg('z', 13), 10);      // 13 ≈ 15 m/px a esta latitud (cuencas chicas)
const NX = parseInt(arg('nx', 240), 10);
const NY = parseInt(arg('ny', 240), 10);
const OUT = arg('out', 'data/dem.json');

const lon2px = (lon, z) => (lon + 180) / 360 * Math.pow(2, z) * 256;
const lat2px = (lat, z) => {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * 256;
};

// Decodificador PNG mínimo: 8 bits, truecolor (RGB/RGBA), filtros 0–4.
function decodePNG(buf) {
  let p = 8, width = 0, height = 0, colorType = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch) throw new Error('colortype ' + colorType + ' no soportado');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch, out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const rb = raw[pos++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let v;
      if (f === 0) v = rb; else if (f === 1) v = rb + a; else if (f === 2) v = rb + b;
      else if (f === 3) v = rb + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, ch, px: out };
}

async function main() {
  const minTX = Math.floor(lon2px(BBOX.lon0, Z) / 256), maxTX = Math.floor(lon2px(BBOX.lon1, Z) / 256);
  const minTY = Math.floor(lat2px(BBOX.lat0, Z) / 256), maxTY = Math.floor(lat2px(BBOX.lat1, Z) / 256);
  const nxT = maxTX - minTX + 1, nyT = maxTY - minTY + 1;
  console.log(`tiles z${Z}: x ${minTX}..${maxTX}, y ${minTY}..${maxTY}  (${nxT}×${nyT} = ${nxT * nyT} tiles)`);

  const W = nxT * 256, H = nyT * 256, elev = new Float32Array(W * H);
  for (let ty = minTY; ty <= maxTY; ty++) for (let tx = minTX; tx <= maxTX; tx++) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} en ${url}`);
    const png = decodePNG(Buffer.from(await res.arrayBuffer()));
    const ox = (tx - minTX) * 256, oy = (ty - minTY) * 256;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (y * png.width + x) * png.ch;
      const e = png.px[i] * 256 + png.px[i + 1] + png.px[i + 2] / 256 - 32768;
      elev[(oy + y) * W + (ox + x)] = e;
    }
  }

  const px0 = minTX * 256, py0 = minTY * 256;
  const sample = (gx, gy) => {
    const x = Math.max(0, Math.min(W - 1.001, gx - px0)), y = Math.max(0, Math.min(H - 1.001, gy - py0));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const e = (xx, yy) => elev[yy * W + xx];
    return e(x0, y0) * (1 - fx) * (1 - fy) + e(x0 + 1, y0) * fx * (1 - fy) + e(x0, y0 + 1) * (1 - fx) * fy + e(x0 + 1, y0 + 1) * fx * fy;
  };
  const data = new Array(NX * NY); let min = Infinity, max = -Infinity;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const lon = BBOX.lon0 + (i / (NX - 1)) * (BBOX.lon1 - BBOX.lon0);
    const lat = BBOX.lat0 + (j / (NY - 1)) * (BBOX.lat1 - BBOX.lat0);
    const v = Math.round(sample(lon2px(lon, Z), lat2px(lat, Z)));
    data[j * NX + i] = v; if (v < min) min = v; if (v > max) max = v;
  }
  const out = { source: 'AWS Terrarium', z: Z, bbox: BBOX, nx: NX, ny: NY, min, max, data };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`OK → ${OUT}  (${NX}×${NY}, ${min}..${max} m)`);
}
main().catch(e => { console.error(e); process.exit(1); });
