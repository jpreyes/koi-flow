// ─────────────────────────────────────────────────────────────────────────────
// fetch_json.js — carga de JSON robusta para koi-flow.
// Problema que resuelve: los `fetch(url).then(r => r.json())` sueltos NO chequean
// el estado HTTP. Cuando el archivo no existe, el servidor de desarrollo (serve.py,
// SimpleHTTPRequestHandler) responde el 404 con una PÁGINA HTML (`<!DOCTYPE html>…`),
// y `r.json()` revienta con el críptico «Unexpected token '<'». Aquí se chequea
// `res.ok` y el content-type, y se lanza un KoiDataError con mensaje humano.
// ─────────────────────────────────────────────────────────────────────────────

// Error de datos con mensaje presentable al usuario. `.url` guarda el recurso que
// faltó y `.status` el código HTTP (0 si ni siquiera hubo respuesta: red caída).
export class KoiDataError extends Error {
  constructor(mensaje, { url = null, status = 0, causa = null } = {}) {
    super(mensaje);
    this.name = 'KoiDataError';
    this.url = url;
    this.status = status;
    if (causa) this.cause = causa;
  }
}

// Carga un JSON chequeando errores. `contexto` (string) se antepone al mensaje para
// que el usuario sepa QUÉ se estaba cargando (p.ej. "Serie de la estación Camiña").
//   fetchJSON('data/x.json?v=6', { contexto: 'Coeficientes hidrológicos' })
// Lanza KoiDataError si: la red falla, el HTTP no es 2xx, o el cuerpo no es JSON.
export async function fetchJSON(url, { contexto = null, signal = null } = {}) {
  const pref = contexto ? contexto + ': ' : '';
  let res;
  try {
    res = await fetch(url, signal ? { signal } : undefined);
  } catch (e) {
    throw new KoiDataError(`${pref}no se pudo conectar para descargar «${url}» (¿servidor caído o sin red?).`,
      { url, status: 0, causa: e });
  }
  if (!res.ok) {
    // 404 típico: el archivo no está generado/descargado todavía.
    const extra = res.status === 404 ? ' El archivo no existe (aún no se ha generado/descargado).' : '';
    throw new KoiDataError(`${pref}«${url}» respondió HTTP ${res.status}.${extra}`,
      { url, status: res.status });
  }
  const ctype = res.headers.get('content-type') || '';
  const txt = await res.text();
  // Si el content-type no es JSON o el cuerpo empieza con '<' (HTML de error),
  // no intentamos parsear: damos el mensaje humano en vez del SyntaxError.
  const pareceHTML = /^\s*</.test(txt);
  if (pareceHTML || (ctype && !/json/i.test(ctype) && !/text\/plain/i.test(ctype))) {
    throw new KoiDataError(`${pref}«${url}» no devolvió JSON (probablemente una página de error del servidor).`,
      { url, status: res.status });
  }
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new KoiDataError(`${pref}«${url}» no es JSON válido.`, { url, status: res.status, causa: e });
  }
}

// Variante que NO lanza: devuelve `null` si el recurso no está (útil para datos
// opcionales, p.ej. un DEM cacheado que puede no existir). Errores distintos de
// «no encontrado» (red caída, JSON corrupto) SÍ se propagan.
export async function fetchJSONopcional(url, opts = {}) {
  try {
    return await fetchJSON(url, opts);
  } catch (e) {
    if (e instanceof KoiDataError && (e.status === 404 || e.status === 0)) return null;
    throw e;
  }
}
