// ─────────────────────────────────────────────────────────────────────────────
// dga.js — capa de datos DGA (koi-flow). Consume el catálogo y las series estáticas
// generadas por tools/export_dga_static.py desde CR2/DGA: selecciona las estaciones
// pluvio/fluviométricas más cercanas a un tramo y carga su serie de máximos anuales.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchJSON, fetchJSONopcional, KoiDataError } from './fetch_json.js?v=13';

let _catalogo = null;

// Series EDITADAS/IMPORTADAS por el usuario (memoria de sesión). Tienen prioridad
// sobre la base estática → el HUD de estación y TODO el pipeline usan tus datos.
const _override = new Map();
const _okey = (bna, tipo) => `${bna}_${tipo}`;
export function setSerieOverride(est, serie, tipo) {
  const bna = typeof est === 'object' ? est.bna : est;
  const t = typeof est === 'object' ? est.tipo : tipo;
  const base = typeof est === 'object' ? est : {};
  _override.set(_okey(bna, t), { ...base, bna, tipo: t, serie, editada: true });
}
export function getSerieOverride(bna, tipo) { return _override.get(_okey(bna, tipo)) || null; }

// Distribución de frecuencia ELEGIDA por el usuario para una estación ('auto' =
// mejor ajuste). La usan el HUD Y el pipeline (para no depender del auto que a
// veces extrapola de más, p.ej. Log-Normal en cauces con crecidas atípicas).
const _distOv = new Map();
export function setDistOverride(est, dist, tipo) {
  const bna = typeof est === 'object' ? est.bna : est;
  const t = typeof est === 'object' ? est.tipo : tipo;
  if (!dist || dist === 'auto') _distOv.delete(_okey(bna, t));
  else _distOv.set(_okey(bna, t), dist);
}
export function getDistOverride(bna, tipo) { return _distOv.get(_okey(bna, tipo)) || null; }

export function resetCatalogo() { _catalogo = null; }

export async function cargarCatalogo() {
  if (_catalogo) return _catalogo;
  // El catálogo puede no estar generado todavía → catálogo vacío en vez de reventar.
  _catalogo = (await fetchJSONopcional('data/estaciones_dga.json?v=13',
    { contexto: 'Catálogo de estaciones DGA' })) || { estaciones: [] };
  return _catalogo;
}

export function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371, rad = Math.PI / 180;
  const p1 = lat1 * rad, p2 = lat2 * rad;
  const dphi = (lat2 - lat1) * rad, dl = (lon2 - lon1) * rad;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Centroide aproximado de un tramo (LineString) en [lon, lat].
export function centroideTramo(feature) {
  const c = feature.geometry.coordinates;
  let x = 0, y = 0;
  for (const [lon, lat] of c) { x += lon; y += lat; }
  return [x / c.length, y / c.length];
}

// Estaciones más cercanas a un punto, opcionalmente filtradas por tipo.
//   tipo: 'pluviometrica' | 'fluviometrica' | undefined (ambas)
export async function estacionesCercanas([lon, lat], { tipo, n = 5, minAnios = 0 } = {}) {
  const cat = await cargarCatalogo();
  return cat.estaciones
    .filter((e) => (!tipo || e.tipo === tipo) && (e.n_anios || 0) >= minAnios)
    .map((e) => ({ ...e, dist: haversine(lon, lat, e.lon, e.lat) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

// Carga la serie de máximos anuales de una estación. Acepta el objeto de catálogo
// (con bna/tipo/archivo) o un BNA + tipo. El archivo incluye la variable para no
// confundir pluvio/fluvio del mismo BNA (p.ej. Q. Tarapacá en Sibaya).
export async function cargarSerie(est, tipo) {
  const bna = typeof est === 'object' ? est.bna : est;
  const t = (typeof est === 'object' ? est.tipo : tipo);
  const ov = _override.get(_okey(bna, t)); if (ov) return ov;   // datos editados/importados por el usuario
  const nombre = (typeof est === 'object' && est.nombre) ? est.nombre : bna;
  const archivo = (typeof est === 'object' && est.archivo)
    ? est.archivo
    : `${bna}_${t === 'fluviometrica' ? 'qflx' : 'pr'}.json`;
  // Ruta principal; si no existe, se prueba la ruta antigua (back-compat) SIN
  // enmascarar el error. En producción las series deben estar publicadas como JSON
  // estático para mantener la app serverless.
  const j = await fetchJSONopcional(`data/series/dga/${archivo}?v=13`,
    { contexto: `Serie de ${nombre}` });
  if (j) return j;
  const back = await fetchJSONopcional(`data/series/dga/${bna}.json?v=13`,
    { contexto: `Serie de ${nombre}` });
  if (back) return back;
  throw new KoiDataError(
    `No hay serie descargada para «${nombre}» (data/series/dga/${archivo}). ` +
    'Regenera la base estática con tools/export_dga_static.py.',
    { url: `data/series/dga/${archivo}`, status: 404 });
}

// Estación recomendada para un tramo: la más cercana del tipo con registro suficiente.
//   Prioriza años de registro sobre distancia pura (un registro largo lejano puede
//   ser mejor que uno corto cercano), con un ligero castigo por distancia.
export async function estacionRecomendada(feature, tipo, { minAnios = 15 } = {}) {
  const cand = await estacionesCercanas(centroideTramo(feature), { tipo, n: 12, minAnios: 0 });
  const buenas = cand.filter((e) => (e.n_anios || 0) >= minAnios);
  const pool = buenas.length ? buenas : cand;
  // score: más años, menos distancia (peso suave a la distancia)
  pool.sort((a, b) => (b.n_anios - b.dist / 20) - (a.n_anios - a.dist / 20));
  return pool[0] || null;
}
