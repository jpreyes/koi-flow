// ─────────────────────────────────────────────────────────────────────────────
// kml.js — lee KML/KMZ en el navegador y los convierte a GeoJSON (koi-flow).
// KMZ = ZIP con un doc.kml (+ recursos). Descomprime con DecompressionStream
// ('deflate-raw') y parsea el KML con DOMParser. Soporta Point, LineString,
// Polygon, LinearRing y MultiGeometry, dentro de Folders/Placemarks.
// ─────────────────────────────────────────────────────────────────────────────

// ── Lector de ZIP mínimo (vía central directory) → { nombre: Uint8Array } ──────
async function unzip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // localiza End Of Central Directory (firma 0x06054b50) desde el final
  let eo = -1;
  for (let i = u8.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; } }
  if (eo < 0) throw new Error('KMZ inválido (sin EOCD)');
  const nEnt = dv.getUint16(eo + 10, true);
  let p = dv.getUint32(eo + 16, true);           // offset del central directory
  const out = {};
  for (let k = 0; k < nEnt; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);        // offset del local header
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    // local header: datos tras 30 + nombre + extra locales
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);
    out[name] = method === 0 ? comp.slice() : await inflateRaw(comp);
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Response(bytes).body.pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const parseCoords = (txt) => (txt || '').trim().split(/\s+/).filter(Boolean)
  .map((t) => t.split(',').map(Number)).map(([lon, lat]) => [lon, lat]);

function geomToFeatures(node, props) {
  const feats = [];
  for (const pt of node.getElementsByTagName('Point')) {
    const c = parseCoords(pt.getElementsByTagName('coordinates')[0]?.textContent)[0];
    if (c) feats.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });
  }
  for (const ls of node.getElementsByTagName('LineString')) {
    const cs = parseCoords(ls.getElementsByTagName('coordinates')[0]?.textContent);
    if (cs.length) feats.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: cs } });
  }
  for (const pg of node.getElementsByTagName('Polygon')) {
    const outer = pg.getElementsByTagName('outerBoundaryIs')[0];
    const ring = parseCoords(outer?.getElementsByTagName('coordinates')[0]?.textContent);
    if (ring.length) feats.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  return feats;
}

export function parseKMLText(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const features = [];
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const name = pm.getElementsByTagName('name')[0]?.textContent?.trim();
    features.push(...geomToFeatures(pm, { name }));
  }
  return { type: 'FeatureCollection', features };
}

// Lee un File (KMZ o KML) → GeoJSON.
export async function leerKMLoKMZ(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.kml')) return parseKMLText(await file.text());
  const dict = await unzip(await file.arrayBuffer());
  const kmlName = Object.keys(dict).find((n) => n.toLowerCase().endsWith('.kml'))
    || Object.keys(dict).find((n) => n.toLowerCase() === 'doc.kml');
  if (!kmlName) throw new Error('El KMZ no contiene un .kml');
  return parseKMLText(new TextDecoder().decode(dict[kmlName]));
}
