// ─────────────────────────────────────────────────────────────────────────────
// exportar.js — exporta la cuenca delineada como superficie/polígono a GeoJSON,
// KML y KMZ (KML zippeado). KMZ se arma con un ZIP mínimo (store, sin compresión)
// en JS puro, sin dependencias. (Shapefile vendrá por el backend.)
// ─────────────────────────────────────────────────────────────────────────────

// polígono: [[lon,lat],...]  (anillo exterior). props: { nombre, ...morfometria }
export function cuencaGeoJSON(polygon, props = {}) {
  const ring = [...polygon];
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } }],
  };
}

export function cuencaKML(polygon, props = {}) {
  const ring = [...polygon];
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
  const coords = ring.map(([lon, lat]) => `${lon},${lat},0`).join(' ');
  const desc = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n');
  const nombre = props.nombre || 'Cuenca';
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>${nombre}</name>
  <Style id="cuenca"><LineStyle><color>ff2563eb</color><width>2</width></LineStyle>
    <PolyStyle><color>552563eb</color></PolyStyle></Style>
  <Placemark><name>${nombre}</name><description>${desc}</description>
    <styleUrl>#cuenca</styleUrl>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>
  </Placemark>
</Document></kml>`;
}

// ── ZIP mínimo (método "store", sin compresión), multi-archivo ──────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const asBytes = (x) => (typeof x === 'string' ? new TextEncoder().encode(x) : x);

// files: [{ name, data:string|Uint8Array }] → Blob ZIP.
export function zipStore(files, mime = 'application/zip') {
  const enc = new TextEncoder();
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = asBytes(f.data), crc = crc32(data);
    const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); dv.setUint16(8, 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    lh.set(name, 30);
    parts.push(lh, data);
    const cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += lh.length + data.length;
  }
  let cdSize = 0; for (const c of central) cdSize += c.length;
  const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, eocd], { type: mime });
}

export function cuencaKMZ(polygon, props = {}) {
  return zipStore([{ name: 'doc.kml', data: cuencaKML(polygon, props) }], 'application/vnd.google-earth.kmz');
}

// Dispara la descarga de un archivo en el navegador.
export function descargar(nombre, contenido, mime) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
