// ─────────────────────────────────────────────────────────────────────────────
// geo.js — proyección local lon/lat → escena 3D (equirectangular centrada).
// Compartida por terrain.js, scene_view.js y el drapeado de tramos/cauces.
// koi-flow (hereda la convención de wind-shm: relieve asentado, Y arriba).
// ─────────────────────────────────────────────────────────────────────────────
export const M_PER_DEG_LAT = 111320;

// Crea una proyección centrada en (centerLon, centerLat). `scale` lleva metros
// reales a unidades de escena (0.01 → 100 m = 1 unidad; cuenca ~6 km ≈ 60 u).
export function makeProjection(centerLon, centerLat, scale = 0.01) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(centerLat * Math.PI / 180);
  return {
    centerLon, centerLat, scale, mPerDegLon,
    // lon/lat → {x, z} de escena (Norte = -z, Este = +x).
    toScene(lon, lat) {
      const east = (lon - centerLon) * mPerDegLon;
      const north = (lat - centerLat) * M_PER_DEG_LAT;
      return { x: east * scale, z: -north * scale };
    },
    // inversa: {x,z} de escena → {lon,lat}.
    toGeo(x, z) {
      const east = x / scale, north = -z / scale;
      return { lon: centerLon + east / mPerDegLon, lat: centerLat + north / M_PER_DEG_LAT };
    },
  };
}

// Centro de un bbox {lon0,lat0,lon1,lat1}.
export function bboxCenter(b) {
  return { lon: (b.lon0 + b.lon1) / 2, lat: (b.lat0 + b.lat1) / 2 };
}
