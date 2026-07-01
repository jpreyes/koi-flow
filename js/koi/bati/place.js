// ─────────────────────────────────────────────────────────────────────────────
// place.js — ubicación "scale-true" de la batimetría CAD sobre koi-flow (Fase 4).
//
// La idea (pedido del usuario): NO pelear con huso/datum. Se importa la malla en
// metros (forma y tamaño exactos), se ARRASTRA sobre el mapa hasta el punto real,
// y se AUTO-ELEVA para que descanse sobre el relieve del destino. La posición se
// define por un ANCLA lon/lat al que se amarra el centroide del DEM, mapeando los
// metros con una proyección equirectangular local (a esta escala, ~300 m, el error
// es milimétrico). Para HEC-RAS se conservan las coordenadas UTM originales.
//   grid koi-flow = { nx, ny, bbox:{west,south,east,north}, data, ... } (fila0=norte)
// ─────────────────────────────────────────────────────────────────────────────

const M_LAT = 110540;
const mPorGradoLon = (lat) => 111320 * Math.cos(lat * Math.PI / 180);

// Muestra la cota del DEM métrico en coord. métricas (x,y) [bilineal], + dz.
export function elevAtMetrico(demM, x, y, dz = 0) {
  const { x0, y0, dx, dy, nx, ny, data } = demM;
  let fx = (x - x0) / dx, fy = (y - y0) / dy;
  fx = Math.max(0, Math.min(nx - 1.001, fx)); fy = Math.max(0, Math.min(ny - 1.001, fy));
  const c0 = Math.floor(fx), r0 = Math.floor(fy), tx = fx - c0, ty = fy - r0;
  const g = (c, r) => data[r * nx + c];
  return dz + g(c0, r0) * (1 - tx) * (1 - ty) + g(c0 + 1, r0) * tx * (1 - ty)
            + g(c0, r0 + 1) * (1 - tx) * ty + g(c0 + 1, r0 + 1) * tx * ty;
}

// lon/lat → coord. métricas (UTM originales) según el ancla de colocación.
export function metricoDesdeLonLat(demM, anchor, lon, lat) {
  const x = demM.cx + (lon - anchor.lon) * mPorGradoLon(anchor.lat);
  const y = demM.cy + (lat - anchor.lat) * M_LAT;
  return { x, y };
}

// coord. métricas → lon/lat (para dibujar el DEM/footprint ubicado).
export function lonLatDesdeMetrico(demM, anchor, x, y) {
  return {
    lon: anchor.lon + (x - demM.cx) / mPorGradoLon(anchor.lat),
    lat: anchor.lat + (y - demM.cy) / M_LAT,
  };
}

// Convierte el DEM métrico a grilla koi-flow (lon/lat, fila0=norte) ubicada en el
// ancla y con desfase vertical dz. Reordena filas (métrico fila0=sur → grid norte).
export function demMetricoAGrid(demM, anchor, dz = 0) {
  const { nx, ny, data, ancho, alto } = demM;
  const mLon = mPorGradoLon(anchor.lat);
  const west  = anchor.lon + (demM.x0 - demM.cx) / mLon;
  const east  = anchor.lon + (demM.x0 + ancho - demM.cx) / mLon;
  const south = anchor.lat + (demM.y0 - demM.cy) / M_LAT;
  const north = anchor.lat + (demM.y0 + alto - demM.cy) / M_LAT;
  const out = new Float32Array(nx * ny);
  for (let r = 0; r < ny; r++) {
    const src = ny - 1 - r;                    // voltea vertical
    for (let c = 0; c < nx; c++) out[r * nx + c] = data[src * nx + c] + dz;
  }
  return {
    nx, ny, bbox: { west, south, east, north }, data: out,
    zmin: demM.zmin + dz, zmax: demM.zmax + dz,
    place: { anchor, dz }, metrico: demM,      // referencia para export/secciones
  };
}

// Polígono (lon/lat) del rectángulo del DEM ubicado — para el overlay arrastrable.
export function footprint(demM, anchor) {
  const c = (x, y) => { const p = lonLatDesdeMetrico(demM, anchor, x, y); return [p.lon, p.lat]; };
  const { x0, y0, ancho, alto } = demM;
  return [c(x0, y0), c(x0 + ancho, y0), c(x0 + ancho, y0 + alto), c(x0, y0 + alto), c(x0, y0)];
}

// Desfase vertical para que el centroide del DEM descanse sobre el relieve base.
//   baseElev(lon,lat) → cota del DEM base (Terrarium) en el ancla.
//   Devuelve dz = cota_terreno_destino − cota_DEM_en_su_centro.
export function autoElevar(demM, anchor, baseElev) {
  const zTerreno = baseElev(anchor.lon, anchor.lat);
  const zDem = elevAtMetrico(demM, demM.cx, demM.cy, 0);
  if (!Number.isFinite(zTerreno)) return 0;
  return zTerreno - zDem;
}

// Ancla inicial sugerida: centro del tramo activo (o del bbox visible).
export function anclaInicial(centro) { return { lon: centro[0], lat: centro[1] }; }
