// ─────────────────────────────────────────────────────────────────────────────
// proyectos.js — gestión de proyectos de koi-flow (localStorage).
// Reemplaza el proyecto hardcodeado: la app arranca vacía o abre el proyecto
// marcado como "abierto". Permite crear, guardar, listar, abrir y BORRAR proyectos.
// El cambio de proyecto se hace recargando la página (arranque limpio y robusto):
// se marca el id abierto y boot lo lee.
// ─────────────────────────────────────────────────────────────────────────────
const LKEY = 'koi_projects';       // índice: [{id,name,fecha}]
const OKEY = 'koi_open';           // id abierto (<id> | null)
const PKEY = (id) => 'koi_proj_' + id;

export function listProjects() { try { return JSON.parse(localStorage.getItem(LKEY)) || []; } catch { return []; } }
function _writeList(l) { localStorage.setItem(LKEY, JSON.stringify(l)); }

export function newProjectId() { return 'p' + Date.now().toString(36); }

// state = { id, name, tramos?, puntos?, importados?, etiquetas? } (serializable)
export function saveProject(state) {
  if (!state?.id) return;
  const l = listProjects().filter((p) => p.id !== state.id);
  l.push({ id: state.id, name: state.name || state.id, fecha: new Date().toISOString() });
  _writeList(l);
  try { localStorage.setItem(PKEY(state.id), JSON.stringify(state)); } catch (e) { (window.__koiToast || alert)('No se pudo guardar (almacenamiento lleno): ' + e.message, 'error'); }
}
export function loadProjectState(id) { try { return JSON.parse(localStorage.getItem(PKEY(id))); } catch { return null; } }
export function removeProject(id) {
  _writeList(listProjects().filter((p) => p.id !== id));
  localStorage.removeItem(PKEY(id));
  if (getOpen() === id) setOpen(null);
}
export function setOpen(id) { if (id) localStorage.setItem(OKEY, id); else localStorage.removeItem(OKEY); }
export function getOpen() { return localStorage.getItem(OKEY); }
