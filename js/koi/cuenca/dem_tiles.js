// ─────────────────────────────────────────────────────────────────────────────
// dem_tiles.js — DEM en el navegador desde tiles Terrarium de AWS (koi-flow).
// Descarga y decodifica los PNG de elevación (elevación = R*256 + G + B/256 − 32768)
// para un bbox y zoom, y arma una grilla regular {nx,ny,bbox,data} para delinear.
// El zoom se elige adaptativamente: más alto para cuencas chicas (más resolución),
// más bajo (más extensión) para cuencas grandes, acotando el nº de celdas.
//   Fuente: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
// ─────────────────────────────────────────────────────────────────────────────

const TILE = 256;
const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// lon/lat → coordenadas de pixel global (web mercator) a un zoom dado.
function gpx(lon, lat, z) {
  const s = TILE * 2 ** z;
  const x = (lon + 180) / 360 * s;
  const rad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * s;
  return [x, y];
}
// pixel global → lon/lat
function gll(x, y, z) {
  const s = TILE * 2 ** z;
  const lon = x / s * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / s;
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lon, lat];
}

function cargarImagen(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile ' + src));
    img.src = src;
  });
}

// Elige el zoom que mantiene el bbox bajo maxDim pixeles por lado.
export function zoomParaBbox(bbox, maxDim = 400, zMax = 15, zMin = 9) {
  for (let z = zMax; z >= zMin; z--) {
    const [x0, y0] = gpx(bbox.west, bbox.north, z);
    const [x1, y1] = gpx(bbox.east, bbox.south, z);
    if (Math.max(x1 - x0, y1 - y0) <= maxDim) return z;
  }
  return zMin;
}

// Descarga el DEM del bbox con FALLBACK de zoom: si algún tile no existe a ese zoom
// (p.ej. z15 fuera de cobertura), reintenta a un zoom menor hasta lograrlo.
export async function fetchDEM(bbox, opts = {}) {
  const zTop = opts.zoom || zoomParaBbox(bbox, opts.maxDim || 400);
  const zMin = opts.zMin ?? 9;
  let lastErr;
  for (let z = zTop; z >= zMin; z--) {
    try { return await fetchDEMzoom(bbox, z); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No se pudo descargar el relieve (DEM).');
}

async function fetchDEMzoom(bbox, z) {
  const [gx0, gy0] = gpx(bbox.west, bbox.north, z);
  const [gx1, gy1] = gpx(bbox.east, bbox.south, z);
  const x0 = Math.floor(gx0), y0 = Math.floor(gy0), x1 = Math.ceil(gx1), y1 = Math.ceil(gy1);
  const W = x1 - x0, H = y1 - y0;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });

  const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor((x1 - 1) / TILE);
  const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor((y1 - 1) / TILE);
  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    jobs.push(cargarImagen(URL(z, tx, ty)).then((img) =>
      ctx.drawImage(img, tx * TILE - x0, ty * TILE - y0)));
  }
  await Promise.all(jobs);

  const px = ctx.getImageData(0, 0, W, H).data;
  const data = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    data[i] = r * 256 + g + b / 256 - 32768;
  }
  // bbox real del bloque de pixeles (esquinas) — lo usamos como bbox lineal de la grilla
  const [west, north] = gll(x0, y0, z);
  const [east, south] = gll(x1, y1, z);
  return { nx: W, ny: H, bbox: { west, south, east, north }, data, zoom: z };
}

// bbox cuadrado centrado en (lon,lat) con semi-lado en grados.
export function bboxEntorno(lon, lat, halfDeg) {
  const k = 1 / Math.cos(lat * Math.PI / 180);
  return { west: lon - halfDeg * k, east: lon + halfDeg * k, south: lat - halfDeg, north: lat + halfDeg };
}
