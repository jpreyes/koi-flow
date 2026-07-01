// ─────────────────────────────────────────────────────────────────────────────
// dxf.js — lector de DXF ASCII en el navegador (koi-flow, Fase 4, batimetría CAD).
//
// Extrae la GEOMETRÍA CON COTA de un DXF exportado desde CivilCAD/AutoCAD:
//   • LWPOLYLINE 2D con elevación en group-code 38   ← curvas de nivel típicas
//   • POLYLINE 3D (VERTEX con Z, code 30)            ← curvas 3D
//   • LINE / 3DFACE                                   ← MDT por triángulos
//   • POINT con Z                                     ← puntos topográficos
//   • TEXT / MTEXT numéricos                          ← cotas rotuladas
//
// No depende de librerías ni build. Devuelve entidades + un INVENTARIO POR CAPA
// (cuántas entidades, si traen Z, tipos) para que el usuario elija qué capas son
// terreno (curvas/puntos) y descarte carátulas, marcos, textos, etc.
//
// Las coordenadas salen tal cual del CAD (normalmente UTM). La reproyección a
// WGS84 la hace proj.js con el sistema/datum que elija el usuario.
// ─────────────────────────────────────────────────────────────────────────────

// Parsea el texto DXF completo → { entidades, capas, bbox, unidades }.
export function parseDXF(text) {
  const lines = text.split(/\r\n|\r|\n/);
  // 1) pares (code, value)
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { i -= 1; continue; }   // línea desalineada: reintenta
    pairs.push([code, lines[i + 1]]);
  }
  // 2) recortar a la sección ENTITIES (si existe)
  let ini = 0, fin = pairs.length;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i][0] === 2 && pairs[i][1].trim() === 'ENTITIES') { ini = i + 1; }
    if (pairs[i][0] === 0 && pairs[i][1].trim() === 'ENDSEC' && ini) { fin = i; break; }
  }
  const scope = ini ? pairs.slice(ini, fin) : pairs;

  // 3) partir en registros por code 0
  const recs = [];
  let cur = null;
  for (const [code, val] of scope) {
    if (code === 0) { cur = { type: val.trim(), codes: [] }; recs.push(cur); }
    else if (cur) cur.codes.push([code, val]);
  }

  // helpers de extracción
  const val = (rec, c) => { for (const [k, v] of rec.codes) if (k === c) return v; return undefined; };
  const num = (rec, c, d = 0) => { const v = val(rec, c); const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const layerOf = (rec) => (val(rec, 8) || '0').trim();

  // 4) ensamblar entidades (maneja POLYLINE…VERTEX…SEQEND)
  const entidades = [];
  let openPoly = null;
  const pushVertexTo = (poly, rec) => {
    poly.puntos.push({ x: num(rec, 10), y: num(rec, 20), z: num(rec, 30, poly.elev || 0) });
  };
  for (const rec of recs) {
    const t = rec.type;
    if (t === 'POLYLINE') {
      const flags = num(rec, 70, 0);
      openPoly = { tipo: 'polilinea', capa: layerOf(rec), puntos: [], elev: num(rec, 38, 0), cerrada: !!(flags & 1), z3d: !!(flags & 8) };
    } else if (t === 'VERTEX') {
      if (openPoly) pushVertexTo(openPoly, rec);
    } else if (t === 'SEQEND') {
      if (openPoly) { entidades.push(openPoly); openPoly = null; }
    } else if (t === 'LWPOLYLINE') {
      const elev = num(rec, 38, 0);
      const flags = num(rec, 70, 0);
      const pts = [];
      let px = null;
      for (const [k, v] of rec.codes) {
        if (k === 10) px = parseFloat(v);
        else if (k === 20 && px !== null) { pts.push({ x: px, y: parseFloat(v), z: elev }); px = null; }
      }
      entidades.push({ tipo: 'polilinea', capa: layerOf(rec), puntos: pts, elev, cerrada: !!(flags & 1), z3d: false });
    } else if (t === 'POINT') {
      entidades.push({ tipo: 'punto', capa: layerOf(rec), puntos: [{ x: num(rec, 10), y: num(rec, 20), z: num(rec, 30, 0) }] });
    } else if (t === 'LINE') {
      entidades.push({ tipo: 'linea', capa: layerOf(rec), puntos: [
        { x: num(rec, 10), y: num(rec, 20), z: num(rec, 30, 0) },
        { x: num(rec, 11), y: num(rec, 21), z: num(rec, 31, 0) },
      ] });
    } else if (t === '3DFACE') {
      const p = [];
      for (let k = 0; k < 4; k++) {
        const x = num(rec, 10 + k, NaN), y = num(rec, 20 + k, NaN), z = num(rec, 30 + k, 0);
        if (Number.isFinite(x) && Number.isFinite(y)) p.push({ x, y, z });
      }
      entidades.push({ tipo: 'cara', capa: layerOf(rec), puntos: p });
    } else if (t === 'TEXT' || t === 'MTEXT') {
      const s = (val(rec, 1) || '').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim();
      entidades.push({ tipo: 'texto', capa: layerOf(rec), texto: s, valor: parseFloat(s.replace(',', '.')),
        puntos: [{ x: num(rec, 10), y: num(rec, 20), z: num(rec, 30, 0) }] });
    }
  }
  if (openPoly) entidades.push(openPoly);

  // 5) inventario por capa + bbox global
  const capas = {};
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, minz = Infinity, maxz = -Infinity;
  for (const e of entidades) {
    const c = capas[e.capa] || (capas[e.capa] = { nombre: e.capa, n: 0, tipos: {}, conZ: 0, nZ: 0, minZ: Infinity, maxZ: -Infinity });
    c.n++; c.tipos[e.tipo] = (c.tipos[e.tipo] || 0) + 1;
    for (const p of e.puntos) {
      if (Number.isFinite(p.x)) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); }
      if (Number.isFinite(p.y)) { miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
      if (Number.isFinite(p.z)) {
        minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z);
        if (p.z !== 0) { c.conZ++; c.minZ = Math.min(c.minZ, p.z); c.maxZ = Math.max(c.maxZ, p.z); }
        c.nZ++;
      }
    }
    if (e.tipo === 'texto' && Number.isFinite(e.valor)) c.esCota = true;
  }
  return {
    entidades, capas,
    bbox: { minx, maxx, miny, maxy, minz, maxz },
  };
}

// Lee un File (input del navegador) → parseDXF. DXF suele ser ASCII/latin1.
export async function leerDXF(file) {
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: false }).decode(buf); }
  catch { text = new TextDecoder('latin1').decode(buf); }
  // heurística: si hay demasiados caracteres de reemplazo, reintenta latin1
  if ((text.match(/�/g) || []).length > 20) text = new TextDecoder('latin1').decode(buf);
  return parseDXF(text);
}

// Sugiere qué capas son "terreno" (curvas/puntos con cota) vs descartables.
export function sugerirCapas(res) {
  const terreno = [], otras = [];
  for (const c of Object.values(res.capas)) {
    const geom = (c.tipos.polilinea || 0) + (c.tipos.punto || 0) + (c.tipos.cara || 0) + (c.tipos.linea || 0);
    const fracZ = c.nZ > 0 ? c.conZ / c.nZ : 0;
    // terreno = tiene geometría y la mayoría de sus vértices trae Z ≠ 0
    if (geom > 0 && (fracZ > 0.5 || c.esCota)) terreno.push(c.nombre);
    else otras.push(c.nombre);
  }
  return { terreno, otras };
}

// Nube de puntos {x,y,z} desde las capas elegidas (para interpolar el DEM).
//   opts.usarCotasTexto: incluir TEXT numérico como punto con z = valor.
export function nubePuntos(res, capasSel, opts = {}) {
  const sel = new Set(capasSel);
  const out = [];
  for (const e of res.entidades) {
    if (!sel.has(e.capa)) continue;
    if (e.tipo === 'texto') {
      if (opts.usarCotasTexto && Number.isFinite(e.valor)) out.push({ x: e.puntos[0].x, y: e.puntos[0].y, z: e.valor });
      continue;
    }
    for (const p of e.puntos) if (Number.isFinite(p.z)) out.push({ x: p.x, y: p.y, z: p.z });
  }
  return out;
}

// Polilíneas (curvas de nivel) de las capas elegidas, para dibujar / snap de secciones.
export function polilineas(res, capasSel) {
  const sel = new Set(capasSel);
  return res.entidades.filter((e) => e.tipo === 'polilinea' && e.puntos.length > 1 && sel.has(e.capa));
}
