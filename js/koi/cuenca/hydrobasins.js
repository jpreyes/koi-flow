// ─────────────────────────────────────────────────────────────────────────────
// hydrobasins.js — cuenca aportante COMPLETA con hidrografía global (koi-flow).
// Para ríos grandes el DEM local no alcanza (la divisoria puede estar a cientos de
// km). HydroBASINS (HydroSHEDS/WWF) trae sub-cuencas anidadas con topología: cada
// sub-cuenca tiene NEXT_DOWN (la de aguas abajo) y UP_AREA (área aguas arriba).
// Dado el punto: se ubica su sub-cuenca y se agregan TODAS las de aguas arriba
// (recorriendo el árbol inverso de NEXT_DOWN) → cuenca completa hasta la divisoria.
//
// Consume un JSON compacto generado por tools/fetch_hydrobasins.py:
//   { level, region, basins:[ { id, nextDown, subArea, upArea, bbox:[w,s,e,n], ring:[[lon,lat]…] } ] }
// ─────────────────────────────────────────────────────────────────────────────

let BASINS = null;         // id → basin
let CHILDREN = null;       // nextDown → [ids que drenan hacia él]
let META = null;

// Carga (una vez) el dataset regional de HydroBASINS.
export async function cargarHydroBasins(url = 'data/hydrobasins/cl.json?v=13') {
  if (BASINS) return META;
  const r = await fetch(url);
  if (!r.ok) throw new Error('HydroBASINS no disponible (genera data/hydrobasins con tools/fetch_hydrobasins.py)');
  const j = await r.json();
  BASINS = new Map();
  CHILDREN = new Map();
  for (const b of j.basins) {
    BASINS.set(b.id, b);
    if (!CHILDREN.has(b.nextDown)) CHILDREN.set(b.nextDown, []);
    CHILDREN.get(b.nextDown).push(b.id);
  }
  META = { level: j.level, region: j.region, n: j.basins.length };
  return META;
}

export function hydroBasinsCargado() { return !!BASINS; }

// point-in-polygon (ray casting) sobre un anillo [[lon,lat]…].
function pip(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Sub-cuenca que contiene el punto (prefiltro por bbox + pip).
export function subCuencaEn(lon, lat) {
  if (!BASINS) return null;
  for (const b of BASINS.values()) {
    const bb = b.bbox;
    if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
    if (pip(b.ring, lon, lat)) return b.id;
  }
  return null;
}

// Todas las sub-cuencas aguas arriba de `id` (incluida), por BFS del árbol inverso.
export function aguasArriba(id) {
  const out = [];
  const stack = [id];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur); out.push(cur);
    for (const child of (CHILDREN.get(cur) || [])) if (!seen.has(child)) stack.push(child);
  }
  return out;
}

// Cuenca aportante completa al punto vía HydroBASINS.
//   Devuelve { multipolygon:[ring…], morfometria:{A,nSub}, outletId, subIds } o null.
export function cuencaHydroBasins(lon, lat) {
  const id = subCuencaEn(lon, lat);
  if (id == null) return null;
  const ids = aguasArriba(id);
  const rings = ids.map((i) => BASINS.get(i).ring);
  let A = 0; for (const i of ids) A += (BASINS.get(i).subArea || 0);
  // envolvente (bbox) para encuadrar
  let w = 180, s = 90, e = -180, n = -90;
  for (const ring of rings) for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const outlet = BASINS.get(id);
  return {
    multipolygon: rings,
    outletId: id, subIds: ids, bbox: { west: w, south: s, east: e, north: n },
    morfometria: {
      A: +A.toFixed(2), nSub: ids.length,
      upAreaOutlet: outlet.upArea ?? null,
      fuente: `HydroBASINS nivel ${META?.level ?? '?'}`,
    },
  };
}
