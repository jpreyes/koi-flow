// ─────────────────────────────────────────────────────────────────────────────
// mapa_fig.js — figura de MAPA para el informe (koi-flow): compone tiles
// satelitales (ArcGIS World Imagery, los mismos del mapa 2D de la app) en un
// canvas y dibuja encima la cuenca delineada y el punto de análisis → dataURL
// PNG listo para <img class="snap"> (HTML/PDF) y para incrustar en el .docx.
// Independiente de la vista actual de Leaflet: calcula qué tiles cubren el bbox
// de la cuenca al zoom adecuado y los baja con crossOrigin=anonymous (los
// servidores de tiles usados permiten CORS → el canvas no se contamina).
// ─────────────────────────────────────────────────────────────────────────────
const TILE = 256;
const URL_SAT = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

// lon/lat → pixel global web-mercator al zoom z
function gpx(lon, lat, z) {
  const s = TILE * 2 ** z;
  const x = (lon + 180) / 360 * s;
  const rad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * s;
  return [x, y];
}

function cargarTile(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile ' + src));
    img.src = src;
  });
}

// Figura de la cuenca sobre el satélite. coords = [[lon,lat],…] (anillo);
// punto = [lon,lat] opcional. opts: { maxDim (px objetivo, 640), margen (0.18) }.
// Devuelve dataURL PNG, o null si no se pudieron bajar los tiles (sin red).
export async function figuraCuencaMapa(coords, punto = null, opts = {}) {
  if (!coords || coords.length < 3) return null;
  const maxDim = opts.maxDim || 640, margen = opts.margen ?? 0.18;

  // bbox con margen
  let w = 180, e = -180, s = 90, n = -90;
  for (const [lo, la] of coords) { w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la); }
  if (punto) { w = Math.min(w, punto[0]); e = Math.max(e, punto[0]); s = Math.min(s, punto[1]); n = Math.max(n, punto[1]); }
  const mLon = (e - w) * margen || 0.01, mLat = (n - s) * margen || 0.01;
  w -= mLon; e += mLon; s -= mLat; n += mLat;

  // zoom que deja el bbox bajo maxDim px por lado (tope z17 del servicio)
  let z = 17;
  for (; z >= 3; z--) {
    const [x0, y0] = gpx(w, n, z), [x1, y1] = gpx(e, s, z);
    if (Math.max(x1 - x0, y1 - y0) <= maxDim) break;
  }
  const [px0, py0] = gpx(w, n, z), [px1, py1] = gpx(e, s, z);
  const W = Math.max(64, Math.round(px1 - px0)), H = Math.max(64, Math.round(py1 - py0));
  const tx0 = Math.floor(px0 / TILE), tx1 = Math.floor(px1 / TILE);
  const ty0 = Math.floor(py0 / TILE), ty1 = Math.floor(py1 / TILE);

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#c9d4da'; ctx.fillRect(0, 0, W, H);   // fondo si falta algún tile

  // tiles en paralelo; si TODOS fallan (sin red) no hay figura
  const trabajos = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
    trabajos.push(cargarTile(URL_SAT(z, tx, ty))
      .then((img) => ctx.drawImage(img, Math.round(tx * TILE - px0), Math.round(ty * TILE - py0)))
      .then(() => true).catch(() => false));
  }
  const ok = await Promise.all(trabajos);
  if (!ok.some(Boolean)) return null;

  // cuenca: relleno translúcido + borde con halo blanco (legible sobre satélite)
  const X = (lon) => gpx(lon, 0, z)[0] - px0;
  const Y = (lat) => gpx(0, lat, z)[1] - py0;
  ctx.beginPath();
  coords.forEach(([lo, la], i) => { const x = X(lo), y = Y(la); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.fillStyle = 'rgba(49,195,206,0.22)'; ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4.5; ctx.stroke();
  ctx.strokeStyle = '#0d7a94'; ctx.lineWidth = 2.2; ctx.stroke();

  // punto de análisis (exutorio)
  if (punto) {
    const x = X(punto[0]), y = Y(punto[1]);
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ef6c5a'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
  }

  // crédito de la imagen (obligación de uso del servicio)
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  const credito = 'Esri World Imagery';
  ctx.strokeText(credito, W - ctx.measureText(credito).width - 6, H - 6);
  ctx.fillText(credito, W - ctx.measureText(credito).width - 6, H - 6);

  return cv.toDataURL('image/png');
}
