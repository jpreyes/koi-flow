// ─────────────────────────────────────────────────────────────────────────────
// bump-version.mjs — sube el ?v= GLOBAL de koi-flow (cache-buster de los imports ES
// y de los links de index.html). Correr AL DESPLEGAR para que el navegador recargue
// los módulos nuevos (p.ej. el solver 2D con el fix de Picard). In-house, sin deps.
//
//   node tools/bump-version.mjs            → bump a (versión actual + 1)
//   node tools/bump-version.mjs 7          → fija a v7
//   node tools/bump-version.mjs --dry      → muestra qué cambiaría, sin escribir
//
// NO toca: worktrees (.claude), .git, node_modules, tools/, vendor (lib/three,
// lib/leaflet) ni el glue WASM (lib/portico/wasm). Sí toca js/koi, js/lib/portico
// (in-house), index.html, sw.js, manifest.
// ─────────────────────────────────────────────────────────────────────────────
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTS = new Set(['.js', '.mjs', '.html', '.css', '.webmanifest']);
const SKIP = ['.claude/', '.git/', 'node_modules/', 'tools/', 'lib/three/', 'lib/leaflet/', 'lib/portico/wasm/'];
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const skipped = (p) => SKIP.some((s) => (rel(p) + '/').includes(s));

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (skipped(p)) continue;
    if (e.isDirectory()) await walk(p, out);
    else if (EXTS.has(extname(e.name))) out.push(p);
  }
  return out;
}

const dry = process.argv.includes('--dry');
const files = await walk(ROOT);

// Versión actual = la máxima ?v= encontrada.
let cur = 0;
for (const f of files) { for (const m of (await readFile(f, 'utf8')).matchAll(/\?v=(\d+)/g)) cur = Math.max(cur, +m[1]); }
const arg = process.argv.find((a) => /^\d+$/.test(a));
const target = arg ? +arg : cur + 1;
if (!(target > 0)) { console.error('versión objetivo inválida'); process.exit(1); }

let nFiles = 0, nRepl = 0;
for (const f of files) {
  const txt = await readFile(f, 'utf8');
  let cnt = 0;
  const out = txt.replace(/\?v=\d+/g, () => { cnt++; return '?v=' + target; });
  if (cnt) { nFiles++; nRepl += cnt; if (!dry) await writeFile(f, out); }
}
console.log(`${dry ? '[dry] ' : ''}?v= v${cur} → v${target}: ${nRepl} referencias en ${nFiles} archivos.`);
if (dry) console.log('(dry-run: no se escribió nada; corré sin --dry para aplicar)');
