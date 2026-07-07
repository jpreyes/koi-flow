#!/usr/bin/env node
// export_dga_static.mjs - genera la base DGA estatica completa para koi-flow.
//
// Lee los zips CR2 cacheados (o los descarga) y escribe:
//   - data/estaciones_dga.json
//   - data/series/dga/<BNA>_pr.json
//   - data/series/dga/<BNA>_qflx.json
//
// El resultado queda servido como archivos estaticos, compatible con GitHub Pages.
// No usa dependencias externas; implementa solo el ZIP deflate necesario para CR2.

import { inflateRawSync } from 'node:zlib';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const FUENTES = {
  pr: {
    landing: 'https://www.cr2.cl/download/cr2_prdaily_2018-zip/',
    referer: 'https://www.cr2.cl/datos-de-precipitacion/',
    tipo: 'pluviometrica',
    variable: 'Maximo anual de PP diaria',
    unidad: 'mm',
  },
  qflx: {
    landing: 'https://www.cr2.cl/download/cr2_qflxdaily_2018-zip/',
    referer: 'https://www.cr2.cl/datos-de-caudales/',
    tipo: 'fluviometrica',
    variable: 'Maximo anual de caudal medio diario',
    unidad: 'm3/s',
  },
};

const args = parseArgs(process.argv.slice(2));
const CACHE = args.cache || join(ROOT, 'tools', '.cache_dga');
const OUT_CATALOGO = args.outCatalogo || join(ROOT, 'data', 'estaciones_dga.json');
const OUT_SERIES = args.outSeries || join(ROOT, 'data', 'series', 'dga');
const MIN_ANIOS = Number(args.minAnios ?? 1);

await mkdir(OUT_SERIES, { recursive: true });
const estaciones = [];
for (const variable of ['pr', 'qflx']) {
  estaciones.push(...await exportarVariable(variable));
}

estaciones.sort((a, b) =>
  a.tipo.localeCompare(b.tipo) ||
  a.lat - b.lat ||
  a.lon - b.lon ||
  a.bna.localeCompare(b.bna));

await mkdir(dirname(OUT_CATALOGO), { recursive: true });
await writeJSON(OUT_CATALOGO, {
  generado: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
  fuente: 'CR2 (compila DGA) - https://www.cr2.cl',
  nacional: true,
  estaciones,
});
console.log(`catalogo: ${OUT_CATALOGO} (${estaciones.length} estaciones)`);

async function exportarVariable(variable) {
  const fuente = FUENTES[variable];
  const zipPath = await resolverZip(variable);
  const zip = await openZip(zipPath);
  const { dataTxt, stationsTxt } = miembros(zip);
  const meta = leerEstaciones(zip.readText(stationsTxt));
  const annual = maximosAnuales(zip.readText(dataTxt), new Set(meta.keys()));
  const out = [];

  for (const [key, serieRaw] of [...annual.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const serie = {};
    for (const [year, value] of [...serieRaw.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (Number.isFinite(value) && value > 0) serie[year] = Math.round(value * 10) / 10;
    }
    const years = Object.keys(serie);
    if (years.length < MIN_ANIOS || !meta.has(key)) continue;

    const m = meta.get(key);
    const archivo = `${m.bna}_${variable}.json`;
    await writeJSON(join(OUT_SERIES, archivo), {
      nombre: m.nombre,
      bna: m.bna,
      tipo: fuente.tipo,
      variable: fuente.variable,
      unidad: fuente.unidad,
      altitud_m: m.altitud_m,
      lat: m.lat,
      lon: m.lon,
      cuenca: m.cuenca,
      subcuenca: m.subcuenca,
      fuente: `CR2 (DGA) - ${basename(dataTxt)}`,
      n_anios: years.length,
      serie,
    });

    out.push({
      bna: m.bna,
      nombre: m.nombre,
      tipo: fuente.tipo,
      var: variable,
      archivo,
      lat: m.lat,
      lon: m.lon,
      altitud_m: m.altitud_m,
      cuenca: m.cuenca,
      periodo: `${years[0]}-${years.at(-1)}`,
      n_anios: years.length,
      nacional: true,
    });
  }
  console.log(`${variable}: ${out.length} series`);
  return out;
}

async function resolverZip(variable) {
  const source = FUENTES[variable];
  const zipPath = join(CACHE, `cr2_${variable}.zip`);
  await mkdir(CACHE, { recursive: true });
  if (!args.forceDownload) {
    try {
      const s = await stat(zipPath);
      if (s.size > 1_000_000) {
        console.log(`  (cache) ${zipPath}`);
        return zipPath;
      }
    } catch (_) {}
  }

  console.log(`  resolviendo link de descarga (${variable})...`);
  const html = await getText(source.landing, source.referer);
  const match = html.match(/wpdm-download-link[^>]*href=['"]([^'"]+wpdmdl=[^'"]+)['"]/i);
  if (!match) throw new Error(`No se encontro el link de descarga WPDM para ${variable}.`);

  console.log('  descargando zip...');
  const bytes = await getBytes(match[1], source.referer);
  await writeFile(zipPath, bytes);
  console.log(`  guardado ${zipPath} (${Math.floor(bytes.byteLength / 1024 / 1024)} MB)`);
  return zipPath;
}

async function getText(url, referer) {
  return new TextDecoder('utf-8').decode(await getBytes(url, referer));
}

async function getBytes(url, referer) {
  const res = await fetch(url, { headers: { 'user-agent': UA, referer } });
  if (!res.ok) throw new Error(`${url} respondio HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function openZip(path) {
  const buf = await readFile(path);
  const entries = new Map();
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let off = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('ZIP invalido: central directory corrupto.');
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const fileNameLength = buf.readUInt16LE(off + 28);
    const extraLength = buf.readUInt16LE(off + 30);
    const commentLength = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + fileNameLength).toString('utf8');
    entries.set(name, { method, compressedSize, localOffset });
    off += 46 + fileNameLength + extraLength + commentLength;
  }

  return {
    names: () => [...entries.keys()],
    readText(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`No existe ${name} en ${path}`);
      return readZipEntry(buf, entry).toString('utf8');
    },
  };
}

function findEndOfCentralDirectory(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('ZIP invalido: no se encontro EOCD.');
}

function readZipEntry(buf, entry) {
  const off = entry.localOffset;
  if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('ZIP invalido: local header corrupto.');
  const fileNameLength = buf.readUInt16LE(off + 26);
  const extraLength = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + fileNameLength + extraLength;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new Error(`Metodo ZIP no soportado: ${entry.method}`);
}

function miembros(zip) {
  const names = zip.names();
  const stationsTxt = names.find((n) => n.endsWith('_stations.txt'));
  const dataTxt = names.find((n) => n.endsWith('.txt') && !n.endsWith('_stations.txt') && !n.endsWith('_description.txt'));
  if (!stationsTxt || !dataTxt) throw new Error('ZIP CR2 incompleto.');
  return { dataTxt, stationsTxt };
}

function leerEstaciones(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines.shift());
  const meta = new Map();
  for (const line of lines) {
    const row = objectFromCsv(header, parseCsvLine(line));
    const lat = Number(row.latitud);
    const lon = Number(row.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!(lat >= -56 && lat <= -17 && lon >= -76 && lon <= -66)) continue;
    const bna = String(row.codigo_estacion || '').trim();
    if (!bna) continue;
    meta.set(bna.padStart(8, '0'), {
      bna,
      nombre: String(row.nombre || '').trim(),
      lat,
      lon,
      altitud_m: num(row.altura),
      cuenca: String(row.nombre_cuenca || '').trim(),
      subcuenca: String(row.nombre_sub_cuenca || '').trim(),
    });
  }
  return meta;
}

function maximosAnuales(text, estaciones) {
  const lines = text.split(/\r?\n/);
  const header = lines.shift().split(',');
  const cols = [];
  for (let i = 0; i < header.length; i++) {
    if (estaciones.has(header[i])) cols.push([i, header[i]]);
  }
  const annual = new Map(cols.map(([, bna]) => [bna, new Map()]));
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split(',');
    const fecha = parts[0] || '';
    if (fecha.length < 10 || fecha[4] !== '-') continue;
    const year = fecha.slice(0, 4);
    for (const [idx, bna] of cols) {
      const value = parts[idx];
      if (!value || value === '-9999') continue;
      const x = Number(value);
      if (!Number.isFinite(x)) continue;
      const byYear = annual.get(bna);
      if (x > (byYear.get(year) ?? -Infinity)) byYear.set(year, x);
    }
  }
  return annual;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function objectFromCsv(header, values) {
  const obj = {};
  for (let i = 0; i < header.length; i++) obj[header[i]] = values[i] ?? '';
  return obj;
}

function num(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

async function writeJSON(path, value) {
  await writeFile(path, JSON.stringify(value), 'utf8');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force-download') out.forceDownload = true;
    else if (arg === '--cache') out.cache = argv[++i];
    else if (arg === '--out-catalogo') out.outCatalogo = argv[++i];
    else if (arg === '--out-series') out.outSeries = argv[++i];
    else if (arg === '--min-anios') out.minAnios = argv[++i];
    else if (arg === '-h' || arg === '--help') {
      console.log('Uso: node tools/export_dga_static.mjs [--cache dir] [--out-catalogo file] [--out-series dir] [--min-anios n] [--force-download]');
      process.exit(0);
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }
  return out;
}
