// ─────────────────────────────────────────────────────────────────────────────
// peligrosidad2d.js — peligrosidad de inundación h·V y export del campo 2D.
// Clasificación combinada de peligrosidad (Australian Rainfall & Runoff 2019 /
// Smith et al. 2014), la de referencia internacional: el producto D·V [m²/s] con
// topes de calado y velocidad → clases H1..H6 (seguridad de personas, vehículos y
// construcciones). D = calado h [m], V = velocidad [m/s].
// ─────────────────────────────────────────────────────────────────────────────

// Clase de peligrosidad para (h, V). Devuelve { clase, dv, desc, color }.
export function claseHazard(h, V) {
  const dv = h * V;
  const T = [
    { clase: 'H1', dvMax: 0.30, dMax: 0.30, vMax: 2.0, desc: 'Generalmente seguro', color: '#22c55e' },
    { clase: 'H2', dvMax: 0.60, dMax: 0.50, vMax: 2.0, desc: 'Inseguro para vehículos pequeños', color: '#a3e635' },
    { clase: 'H3', dvMax: 0.60, dMax: 1.20, vMax: 2.0, desc: 'Inseguro para vehículos, niños y adultos mayores', color: '#facc15' },
    { clase: 'H4', dvMax: 1.00, dMax: 2.00, vMax: 2.0, desc: 'Inseguro para personas y vehículos', color: '#fb923c' },
    { clase: 'H5', dvMax: 4.00, dMax: 4.00, vMax: 4.0, desc: 'Inseguro para vehículos y construcciones vulnerables', color: '#ef4444' },
  ];
  for (const t of T) if (dv <= t.dvMax && h <= t.dMax && V <= t.vMax) return { clase: t.clase, dv, desc: t.desc, color: t.color };
  return { clase: 'H6', dv, desc: 'Inseguro para todos; posible colapso de construcciones', color: '#7f1d1d' };
}

// Resumen sobre el campo 2D: producto h·V por nodo, pico y reparto por clase (solo
// nodos mojados h>hmin). Devuelve { hv:Float64Array, hvMax, iMax, clasePico, conteo, mojados }.
export function resumenPeligrosidad(h, V, { hmin = 0.02 } = {}) {
  const n = h.length, hv = new Float64Array(n);
  const conteo = { H1: 0, H2: 0, H3: 0, H4: 0, H5: 0, H6: 0 };
  let hvMax = 0, iMax = -1, mojados = 0;
  for (let i = 0; i < n; i++) {
    hv[i] = h[i] * V[i];
    if (h[i] <= hmin) continue;
    mojados++;
    conteo[claseHazard(h[i], V[i]).clase]++;
    if (hv[i] > hvMax) { hvMax = hv[i]; iMax = i; }
  }
  const clasePico = iMax >= 0 ? claseHazard(h[iMax], V[iMax]) : claseHazard(0, 0);
  return { hv, hvMax, iMax, clasePico, conteo, mojados };
}

// Coordenadas geográficas de un nodo (si la malla trae origin). x,y en metros
// relativos al origen: lon = lon0 + x/mLon, lat = lat0 + y/mLat.
function lonlat(nd, origin) {
  if (!origin) return { lon: '', lat: '' };
  return { lon: origin.lon0 + nd.x / origin.mLon, lat: origin.lat0 + nd.y / origin.mLat };
}

// CSV del campo 2D por nodo: i, x, y, lon, lat, z, h, V, hV, clase.
export function exportarCSV(mesh, r) {
  const { h, V } = r, origin = mesh.origin;
  const rows = ['i,x_m,y_m,lon,lat,z_m,h_m,V_ms,hV_m2s,clase'];
  for (let i = 0; i < mesh.nodes.length; i++) {
    const nd = mesh.nodes[i], { lon, lat } = lonlat(nd, origin);
    const cls = claseHazard(h[i], V[i]).clase;
    rows.push([i, nd.x.toFixed(2), nd.y.toFixed(2),
      lon === '' ? '' : lon.toFixed(7), lat === '' ? '' : lat.toFixed(7),
      (nd.z ?? 0).toFixed(2), h[i].toFixed(3), V[i].toFixed(3), (h[i] * V[i]).toFixed(3), cls].join(','));
  }
  return rows.join('\n');
}

// GeoJSON de puntos (nodos mojados) con propiedades h, V, hV, clase. Requiere origin.
export function exportarGeoJSON(mesh, r, { hmin = 0.02 } = {}) {
  const { h, V } = r, origin = mesh.origin;
  const feats = [];
  for (let i = 0; i < mesh.nodes.length; i++) {
    if (h[i] <= hmin) continue;
    const nd = mesh.nodes[i], { lon, lat } = lonlat(nd, origin);
    if (lon === '') continue;
    const hz = claseHazard(h[i], V[i]);
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [+lon.toFixed(7), +lat.toFixed(7)] },
      properties: { h: +h[i].toFixed(3), V: +V[i].toFixed(3), hV: +(h[i] * V[i]).toFixed(3), clase: hz.clase, desc: hz.desc } });
  }
  return { type: 'FeatureCollection', features: feats };
}
