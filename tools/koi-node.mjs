// ─────────────────────────────────────────────────────────────────────────────
// koi-node.mjs — preload para correr los MOTORES de koi-flow en Node (base del CLI y
// los tests headless, R6). Los motores ya son puros; lo único que asumen del
// navegador es `fetch('data/…')` para cargar datos. Este shim mapea esas URLs
// relativas (con o sin ?v=…) a lecturas de `fs` desde la raíz del repo, así
// pipeline.js / datos / fetchJSON corren sin cambios.
//   node --import ./tools/koi-node.mjs  tu-script.mjs
// Nota: `?v=2` en los imports NO necesita loader — Node 20+/24 lo resuelve solo.
// ─────────────────────────────────────────────────────────────────────────────
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');   // tools/ → raíz del repo

// fetch mínimo compatible con fetchJSON (res.ok, headers.get('content-type'),
// json()/text()/arrayBuffer()). Solo sirve rutas locales del repo.
if (typeof globalThis.fetch !== 'function' || !globalThis.__koiFetchShim) {
  globalThis.__koiFetchShim = true;
  globalThis.fetch = async (url) => {
    const limpio = String(url).split('?')[0].split('#')[0].replace(/^\.?\//, '');
    let buf;
    try {
      buf = await readFile(join(ROOT, limpio));
    } catch (e) {
      return { ok: false, status: 404, headers: { get: () => 'text/html' },
        async json() { throw new Error('404'); }, async text() { return '<!DOCTYPE html>404'; }, async arrayBuffer() { return new ArrayBuffer(0); } };
    }
    const esJSON = /\.(json|geojson|webmanifest)$/i.test(limpio);
    return {
      ok: true, status: 200,
      headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? (esJSON ? 'application/json' : 'text/plain') : null) },
      async json() { return JSON.parse(buf.toString('utf8')); },
      async text() { return buf.toString('utf8'); },
      async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
    };
  };
}
