// ─────────────────────────────────────────────────────────────────────────────
// proyectos_nube.js — persistencia de proyectos .koi en Supabase (Fase A · A5).
// Guarda/lista/abre/borra el binario .koi en Storage (bucket 'proyectos', bajo
// <org_id>/<id>.koi) + una fila en la tabla `projects`. La RLS asegura que cada
// organización solo ve/edita lo suyo. Todo por fetch puro (sin supabase-js).
// ─────────────────────────────────────────────────────────────────────────────
import { REST_URL, STORAGE_URL, SUPABASE_KEY } from './config.js?v=13';
import { tokenValido } from './auth.js?v=13';

const BUCKET = 'proyectos';

async function _h(extra = {}) {
  const t = await tokenValido();
  if (!t) throw new Error('Sesión no válida. Vuelve a iniciar sesión.');
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${t}`, ...extra };
}
async function _err(res, def) { let e = {}; try { e = await res.json(); } catch {} return new Error(e.message || e.error || def); }

// Organización activa del usuario (primera membresía). Se cachea.
let _org = null;
export async function orgActiva() {
  if (_org) return _org;
  const res = await fetch(`${REST_URL}/org_members?select=org_id,rol&limit=1`, { headers: await _h() });
  if (!res.ok) throw await _err(res, 'No se pudo leer la organización');
  const rows = await res.json();
  if (!rows.length) throw new Error('Tu usuario no pertenece a ninguna organización. Pide a un admin que te agregue.');
  return (_org = rows[0].org_id);
}

// Lista de proyectos en la nube (RLS: solo los de tus orgs), más reciente primero.
export async function listarNube() {
  const res = await fetch(`${REST_URL}/projects?select=id,nombre,storage_path,actualizado&order=actualizado.desc`, { headers: await _h() });
  if (!res.ok) throw await _err(res, 'No se pudo listar los proyectos');
  return res.json();
}

// Guarda: fila en `projects` (insert si no hay id) + sube el .koi a Storage (upsert).
export async function guardarNube(nombre, bytes, id = null) {
  const org = await orgActiva();
  if (!id) {
    const res = await fetch(`${REST_URL}/projects`, {
      method: 'POST', headers: await _h({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ org_id: org, nombre }),
    });
    if (!res.ok) throw await _err(res, 'No se pudo crear el proyecto');
    id = (await res.json())[0].id;
  }
  const path = `${org}/${id}.koi`;
  const up = await fetch(`${STORAGE_URL}/object/${BUCKET}/${path}`, {
    method: 'POST', headers: await _h({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }),
    body: bytes,
  });
  if (!up.ok) throw await _err(up, `Error al subir el .koi (${up.status})`);
  await fetch(`${REST_URL}/projects?id=eq.${id}`, {
    method: 'PATCH', headers: await _h({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ nombre, storage_path: path, actualizado: new Date().toISOString() }),
  });
  return { id, path, nombre };
}

// Descarga el binario .koi de un proyecto → Uint8Array (para leerKoi).
export async function abrirNube(project) {
  const path = project.storage_path || `${await orgActiva()}/${project.id}.koi`;
  const res = await fetch(`${STORAGE_URL}/object/${BUCKET}/${path}`, { headers: await _h() });
  if (!res.ok) throw await _err(res, `Error al descargar el .koi (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// Borra un proyecto (objeto en Storage + fila).
export async function borrarNube(project) {
  const path = project.storage_path || `${await orgActiva()}/${project.id}.koi`;
  await fetch(`${STORAGE_URL}/object/${BUCKET}/${path}`, { method: 'DELETE', headers: await _h() }).catch(() => {});
  const res = await fetch(`${REST_URL}/projects?id=eq.${project.id}`, { method: 'DELETE', headers: await _h() });
  if (!res.ok) throw await _err(res, 'No se pudo borrar el proyecto');
}
