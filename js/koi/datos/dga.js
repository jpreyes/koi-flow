// ─────────────────────────────────────────────────────────────────────────────
// dga.js — capa de datos DGA (koi-flow). Consume el catálogo y las series que genera
// tools/fetch_dga.py (compiladas por el CR2 desde la DGA): selecciona las estaciones
// pluvio/fluviométricas más cercanas a un tramo y carga su serie de máximos anuales.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchJSON, fetchJSONopcional, KoiDataError } from './fetch_json.js?v=2';
import { emit } from '../ui/bus.js?v=2';

let _catalogo = null;

export function resetCatalogo() { _catalogo = null; }

export async function cargarCatalogo() {
  if (_catalogo) return _catalogo;
  // El catálogo puede no estar generado todavía → catálogo vacío en vez de reventar.
  _catalogo = (await fetchJSONopcional('data/estaciones_dga.json?v=2',
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
  const nombre = (typeof est === 'object' && est.nombre) ? est.nombre : bna;
  const archivo = (typeof est === 'object' && est.archivo)
    ? est.archivo
    : `${bna}_${t === 'fluviometrica' ? 'qflx' : 'pr'}.json`;
  // Ruta principal; si no existe, se prueba la ruta antigua (back-compat) SIN
  // enmascarar el error: si ninguna está, se lanza un KoiDataError con mensaje
  // accionable (el HUD ofrece «Descargar serie DGA»).
  const j = await fetchJSONopcional(`data/series/dga/${archivo}?v=2`,
    { contexto: `Serie de ${nombre}` });
  if (j) return j;
  const back = await fetchJSONopcional(`data/series/dga/${bna}.json?v=2`,
    { contexto: `Serie de ${nombre}` });
  if (back) return back;
  throw new KoiDataError(
    `No hay serie descargada para «${nombre}» (data/series/dga/${archivo}). ` +
    'Usa «Descargar serie DGA» para bajarla desde el CR2.',
    { url: `data/series/dga/${archivo}`, status: 404 });
}

// Descarga la serie de una estación (o de un punto) desde el CR2, vía el endpoint
// POST /api/fetch_dga que expone serve.py (corre tools/fetch_dga.py). Al terminar
// invalida el catálogo cacheado para que las nuevas series aparezcan. Devuelve el
// objeto {ok, stdout, stderr} del servidor; lanza KoiDataError si el endpoint no
// responde JSON (p.ej. si no se está usando serve.py sino otro servidor estático).
//   loc: { lon, lat }  ·  tipo: 'pluviometrica' | 'fluviometrica'
export async function descargarSerieDGA(loc, tipo) {
  const esFluvio = tipo === 'fluviometrica';
  let res;
  try {
    res = await fetch('/api/fetch_dga', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lon: loc.lon, lat: loc.lat, radio: esFluvio ? 120 : 60, var: esFluvio ? 'qflx' : 'pr' }),
    });
  } catch (e) {
    throw new KoiDataError('No se pudo contactar el servicio de descarga DGA (¿usas serve.py?).', { url: '/api/fetch_dga', causa: e });
  }
  const ctype = res.headers.get('content-type') || '';
  if (!/json/i.test(ctype)) {
    throw new KoiDataError('La descarga DGA requiere el servidor serve.py (endpoint /api/fetch_dga no disponible).', { url: '/api/fetch_dga', status: res.status });
  }
  const j = await res.json();
  if (!j.ok) throw new KoiDataError(j.error || j.stderr || 'Falló la descarga de la serie DGA.', { url: '/api/fetch_dga', status: res.status });
  resetCatalogo();
  emit('datos:serie-cargada', { tipo, lon: loc.lon, lat: loc.lat });
  return j;
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
