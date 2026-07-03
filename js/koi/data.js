// ─────────────────────────────────────────────────────────────────────────────
// data.js — carga del proyecto activo de koi-flow.
// NO hay proyecto hardcodeado: la app arranca VACÍA salvo que haya un proyecto
// marcado como abierto (localStorage), cuyo estado se reconstruye. El usuario crea
// proyectos («Nuevo»), importa tramos (KMZ/KML) y guarda/abre desde localStorage.
// ─────────────────────────────────────────────────────────────────────────────
import { getOpen, setOpen, loadProjectState } from './proyectos.js?v=7';

const EMPTY_FC = () => ({ type: 'FeatureCollection', features: [] });

export async function loadProject() {
  let open = getOpen();
  // 'demo' es un id LEGADO: el proyecto demo (Tarapacá) se quitó en R2, pero un puntero
  // `koi_open='demo'` viejo seguía restaurando ese proyecto al arrancar y re-centrando el
  // mapa en Tarapacá. Se ignora y se limpia para que la app abra en la vista de Chile.
  if (open === 'demo') { setOpen(null); open = null; }
  if (open) {
    const st = loadProjectState(open);
    if (st) {
      const tramos = (st.tramos || []).map((t) => ({ name: t.name, feature: t.feature, npts: t.feature?.geometry?.coordinates?.length || 0, dem: t.dem || null }));
      const fc = { type: 'FeatureCollection', features: tramos.map((t) => t.feature).filter(Boolean) };
      return { project: { id: st.id, name: st.name, tramos }, fc, state: st };
    }
  }
  // sin proyecto abierto → lienzo vacío
  return { project: { id: 'nuevo', name: 'Proyecto nuevo', tramos: [] }, fc: EMPTY_FC() };
}
