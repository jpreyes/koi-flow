// punto_contexto.js — modelo persistente de cada punto de análisis.
// Un punto no es solo una coordenada: es el contenedor metodológico de su cuenca,
// red local, estaciones, referencias, importados y resultados.

export function ensurePointContext(p) {
  if (!p) return null;
  const c = p.contexto = p.contexto || {};
  c.version = c.version || 1;
  c.estaciones = c.estaciones || {};
  c.estaciones.cercanas = c.estaciones.cercanas || [];
  c.estaciones.seleccion = c.estaciones.seleccion || {};
  c.referencias = c.referencias || [];
  c.importados = c.importados || [];
  c.resultados = c.resultados || {};
  if (!('red' in c)) c.red = null;
  return c;
}

export function stationLite(e) {
  if (!e) return null;
  const {
    bna, nombre, tipo, var: variable, archivo, lat, lon, altitud_m,
    cuenca, periodo, n_anios, dist, nacional,
  } = e;
  return { bna, nombre, tipo, var: variable, archivo, lat, lon, altitud_m, cuenca, periodo, n_anios, dist, nacional };
}

export function pointRefLite(ref) {
  if (!ref) return null;
  const { name, tipo, lon, lat } = ref;
  return { name, tipo, lon, lat };
}

export function pointImportLite(im) {
  if (!im) return null;
  const { name, geojson } = im;
  return { name, geojson };
}

export function featureCollectionLite(fc) {
  if (!fc) return null;
  const { type = 'FeatureCollection', features = [], meta = null } = fc;
  return { type, features, meta };
}

export function redLite(red) {
  if (!red) return null;
  return {
    fc: featureCollectionLite(red.fc || red),
    meta: red.meta || red.fc?.meta || null,
    umbralKm2: red.umbralKm2 ?? red.fc?.meta?.umbralKm2 ?? null,
    actualizado: red.actualizado || null,
  };
}

export function serializePoint(p) {
  const c = ensurePointContext(p);
  return {
    id: p.id,
    lon: p.lon,
    lat: p.lat,
    nombre: p.nombre,
    tramo: p.tramo || null,
    snapMeters: p.snapMeters ?? null,
    crecida: p.crecida || null,
    cuenca: p.cuenca ? {
      polygon: p.cuenca.polygon,
      polygonSuave: p.cuenca.polygonSuave || null,
      morfometria: p.cuenca.morfometria,
      tocaBorde: !!p.cuenca.tocaBorde,
      truncada: !!p.cuenca.truncada,
      enRed: !!p.cuenca.enRed,
    } : null,
    cuencaHB: p.cuencaHB || null,
    contexto: c ? {
      version: 1,
      estaciones: {
        cercanas: (c.estaciones.cercanas || []).map(stationLite).filter(Boolean),
        seleccion: {
          ctrl: stationLite(c.estaciones.seleccion?.ctrl),
          pluvio: stationLite(c.estaciones.seleccion?.pluvio),
        },
      },
      red: redLite(c.red),
      referencias: (c.referencias || []).map(pointRefLite).filter(Boolean),
      importados: (c.importados || []).map(pointImportLite).filter(Boolean),
      resultados: c.resultados || {},
    } : null,
  };
}

export function migrateProjectPoints(data) {
  const flat = [];
  for (const p of data?.puntos || []) flat.push(p);
  if (!flat.length) {
    for (const t of data?.tramos || []) {
      for (const p of t.puntos || []) flat.push({ ...p, tramo: p.tramo || t.name });
    }
  }
  return flat;
}
