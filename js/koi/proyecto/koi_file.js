// ─────────────────────────────────────────────────────────────────────────────
// koi_file.js — formato de proyecto .koi de koi-flow (binario, in-house).
// Un .koi es un ZIP (contenedor propio, sin librerías) con:
//   koi.json            manifiesto: versión + el esquema del proyecto, donde cada
//                       TypedArray (DEM, mallas, campos H/h/V, frames…) se reemplaza
//                       por una referencia { __koiAsset, tipo, n }.
//   assets/<id>.bin     los bytes CRUDOS de cada TypedArray, comprimidos con DEFLATE.
// Así los MILLONES de floats nunca se vuelven texto ni se parsean como números
// (patrón npz/HDF5): el archivo queda chico y la lectura es directa (una vista sobre
// el buffer). Compresión con Compression/DecompressionStream (nativas en navegador y
// Node ≥18) — nada de afuera. Little-endian (navegador y Node lo son).
// ─────────────────────────────────────────────────────────────────────────────

// ── CRC32 (in-house, igual que cuenca/exportar.js) ──────────────────────────────
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

// ── DEFLATE crudo por streams nativos ──────────────────────────────────────────
async function deflateRaw(bytes) {
  const s = new Response(bytes).body.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function inflateRaw(bytes) {
  const s = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// ── ZIP writer con método STORE (0) y DEFLATE (8) ───────────────────────────────
const enc = new TextEncoder();
const asBytes = (x) => (typeof x === 'string' ? enc.encode(x) : x);

// entries: [{ name, data:string|Uint8Array, comprimir?:bool }] → Uint8Array (ZIP).
async function zipWrite(entries) {
  const parts = [], central = []; let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), raw = asBytes(e.data), crc = crc32(raw);
    const comprimir = e.comprimir !== false;                 // por defecto sí
    const data = comprimir ? await deflateRaw(raw) : raw;
    const method = comprimir ? 8 : 0;
    const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, method, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, raw.length, true);
    dv.setUint16(26, name.length, true); lh.set(name, 30);
    parts.push(lh, data);
    const cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); cd.set(name, 46);
    central.push(cd);
    offset += lh.length + data.length;
  }
  let cdSize = 0; for (const c of central) cdSize += c.length;
  const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  // concatena todo en un Uint8Array
  const chunks = [...parts, ...central, eocd];
  let total = 0; for (const c of chunks) total += c.length;
  const out = new Uint8Array(total); let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

// ── ZIP reader (central directory + inflate) → { name: Uint8Array } ─────────────
async function zipRead(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eo = -1;
  for (let i = u8.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; } }
  if (eo < 0) throw new Error('.koi inválido (sin EOCD)');
  const nEnt = dv.getUint16(eo + 10, true);
  let p = dv.getUint32(eo + 16, true);
  const out = {};
  for (let k = 0; k < nEnt; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(lho + 26, true), lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);
    out[name] = method === 0 ? comp.slice() : await inflateRaw(comp);
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}

// ── TypedArray ⇄ referencia de asset ────────────────────────────────────────────
const TIPOS = {
  f64: Float64Array, f32: Float32Array, i32: Int32Array, u32: Uint32Array,
  i16: Int16Array, u16: Uint16Array, i8: Int8Array, u8: Uint8Array,
};
const tipoDe = (v) => Object.keys(TIPOS).find((k) => v instanceof TIPOS[k]);

// Clona el proyecto reemplazando cada TypedArray por { __koiAsset } y juntando sus
// bytes en `assets`. Arrays normales, objetos y primitivos se copian tal cual.
function extraerAssets(valor, assets) {
  const tipo = tipoDe(valor);
  if (tipo) {
    const id = 'a' + assets.length;
    const bytes = new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength).slice();
    assets.push({ id, bytes });
    return { __koiAsset: id, tipo, n: valor.length };
  }
  if (Array.isArray(valor)) return valor.map((x) => extraerAssets(x, assets));
  if (valor && typeof valor === 'object') {
    const o = {};
    for (const k of Object.keys(valor)) o[k] = extraerAssets(valor[k], assets);
    return o;
  }
  return valor;   // primitivo (string/number/bool/null)
}

// Reconstruye las TypedArrays desde los assets ya descomprimidos.
function hidratarAssets(valor, assets) {
  if (valor && typeof valor === 'object' && valor.__koiAsset) {
    const bytes = assets[valor.__koiAsset];
    const Ctor = TIPOS[valor.tipo] || Uint8Array;
    // copia alineada (los bytes del ZIP pueden no estar alineados al tamaño del tipo)
    const buf = bytes.slice().buffer;
    return new Ctor(buf, 0, valor.n);
  }
  if (Array.isArray(valor)) return valor.map((x) => hidratarAssets(x, assets));
  if (valor && typeof valor === 'object') {
    const o = {};
    for (const k of Object.keys(valor)) o[k] = hidratarAssets(valor[k], assets);
    return o;
  }
  return valor;
}

// ── API pública ─────────────────────────────────────────────────────────────────
export const KOI_FORMATO = 1;

// Serializa un proyecto a un .koi (Uint8Array). `meta` (opcional) va al manifiesto.
export async function escribirKoi(proyecto, meta = {}) {
  const assets = [];
  const esquema = extraerAssets(proyecto, assets);
  const manifest = { formato: KOI_FORMATO, generado: new Date().toISOString(), ...meta, proyecto: esquema };
  const entries = [{ name: 'koi.json', data: JSON.stringify(manifest) }];
  for (const a of assets) entries.push({ name: 'assets/' + a.id + '.bin', data: a.bytes });
  return zipWrite(entries);
}

// Lee un .koi (Uint8Array/ArrayBuffer) → { proyecto, manifest }.
export async function leerKoi(buf) {
  const files = await zipRead(buf);
  if (!files['koi.json']) throw new Error('.koi sin koi.json');
  const manifest = JSON.parse(new TextDecoder().decode(files['koi.json']));
  const assets = {};
  for (const name of Object.keys(files)) {
    const m = name.match(/^assets\/(.+)\.bin$/);
    if (m) assets[m[1]] = files[name];
  }
  return { proyecto: hidratarAssets(manifest.proyecto, assets), manifest };
}
