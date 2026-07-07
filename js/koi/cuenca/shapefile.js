// ─────────────────────────────────────────────────────────────────────────────
// shapefile.js — escribe un Shapefile (polígono) en el navegador, sin dependencias.
// Genera .shp + .shx + .dbf + .prj (WGS84) y los empaca en un ZIP descargable.
// Pensado para una cuenca (un polígono con atributos de morfometría).
// ─────────────────────────────────────────────────────────────────────────────
import { zipStore } from './exportar.js?v=13';

const PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

// Asegura anillo cerrado y orientación horaria (exterior, según spec shapefile).
function anilloHorario(polygon) {
  const ring = polygon.map((p) => [p[0], p[1]]);
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
  let area2 = 0;
  for (let i = 0; i < ring.length - 1; i++) area2 += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
  if (area2 < 0) ring.reverse();   // <0 = antihorario → invertir a horario
  return ring;
}

function shpShx(ring) {
  const N = ring.length;
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const [x, y] of ring) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const contentBytes = 48 + 16 * N;                 // tipo+box+nParts+nPoints+parts+points
  const shp = new Uint8Array(100 + 8 + contentBytes);
  const d = new DataView(shp.buffer);
  // cabecera .shp
  d.setInt32(0, 9994, false);                       // file code (BE)
  d.setInt32(24, (100 + 8 + contentBytes) / 2, false);  // file length en words (BE)
  d.setInt32(28, 1000, true);                       // versión
  d.setInt32(32, 5, true);                          // tipo: Polygon
  d.setFloat64(36, xmin, true); d.setFloat64(44, ymin, true);
  d.setFloat64(52, xmax, true); d.setFloat64(60, ymax, true);
  // registro
  let o = 100;
  d.setInt32(o, 1, false); o += 4;                  // nº registro (BE)
  d.setInt32(o, contentBytes / 2, false); o += 4;   // longitud contenido en words (BE)
  d.setInt32(o, 5, true); o += 4;                   // tipo
  d.setFloat64(o, xmin, true); o += 8; d.setFloat64(o, ymin, true); o += 8;
  d.setFloat64(o, xmax, true); o += 8; d.setFloat64(o, ymax, true); o += 8;
  d.setInt32(o, 1, true); o += 4;                   // numParts
  d.setInt32(o, N, true); o += 4;                   // numPoints
  d.setInt32(o, 0, true); o += 4;                   // parts[0]
  for (const [x, y] of ring) { d.setFloat64(o, x, true); o += 8; d.setFloat64(o, y, true); o += 8; }

  // .shx
  const shx = new Uint8Array(100 + 8);
  const s = new DataView(shx.buffer);
  s.setInt32(0, 9994, false); s.setInt32(24, (100 + 8) / 2, false);
  s.setInt32(28, 1000, true); s.setInt32(32, 5, true);
  s.setFloat64(36, xmin, true); s.setFloat64(44, ymin, true);
  s.setFloat64(52, xmax, true); s.setFloat64(60, ymax, true);
  s.setInt32(100, 50, false);                       // offset del registro (words) = 100/2
  s.setInt32(104, contentBytes / 2, false);         // longitud (words)
  return { shp, shx };
}

// .dbf (dBASE III) con campos de morfometría.
function dbf(props) {
  const campos = [
    ['NOMBRE', 'C', 40, 0, String(props.nombre ?? 'Cuenca')],
    ['AREA_KM2', 'N', 13, 3, props.area_km2],
    ['L_KM', 'N', 10, 3, props.L_km],
    ['S', 'N', 12, 6, props.S],
    ['H_M', 'N', 10, 1, props.H_m],
  ];
  const recSize = 1 + campos.reduce((s, c) => s + c[2], 0);
  const headSize = 32 + 32 * campos.length + 1;
  const buf = new Uint8Array(headSize + recSize + 1);   // +1 EOF
  const d = new DataView(buf.buffer);
  const now = new Date();
  buf[0] = 0x03; buf[1] = now.getFullYear() - 1900; buf[2] = now.getMonth() + 1; buf[3] = now.getDate();
  d.setInt32(4, 1, true);                              // nº registros
  d.setInt16(8, headSize, true); d.setInt16(10, recSize, true);
  let o = 32;
  for (const [name, type, len, dec] of campos) {
    for (let i = 0; i < 11; i++) buf[o + i] = i < name.length ? name.charCodeAt(i) : 0;
    buf[o + 11] = type.charCodeAt(0); buf[o + 16] = len; buf[o + 17] = dec; o += 32;
  }
  buf[o++] = 0x0D;                                    // fin de descriptores
  buf[o++] = 0x20;                                    // flag de borrado (no borrado)
  const enc = new TextEncoder();
  for (const [, type, len, dec, val] of campos) {
    let s;
    if (type === 'N') { const n = Number(val); s = (isFinite(n) ? n.toFixed(dec) : '').padStart(len, ' ').slice(-len); }
    else { s = String(val ?? '').slice(0, len).padEnd(len, ' '); }
    const b = enc.encode(s); for (let i = 0; i < len; i++) buf[o + i] = b[i] ?? 0x20; o += len;
  }
  buf[o] = 0x1A;                                      // EOF
  return buf;
}

// Devuelve un Blob ZIP con el shapefile completo (nombre base = `base`).
export function cuencaShapefileZip(polygon, props = {}, base = 'cuenca') {
  const ring = anilloHorario(polygon);
  const { shp, shx } = shpShx(ring);
  return zipStore([
    { name: `${base}.shp`, data: shp },
    { name: `${base}.shx`, data: shx },
    { name: `${base}.dbf`, data: dbf(props) },
    { name: `${base}.prj`, data: PRJ },
  ], 'application/zip');
}
