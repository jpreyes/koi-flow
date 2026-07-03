// ─────────────────────────────────────────────────────────────────────────────
// data.js — carga del proyecto activo de koi-flow.
// NO hay proyecto hardcodeado: la app arranca VACÍA salvo que haya un proyecto
// marcado como abierto (localStorage), cuyo estado se reconstruye. El usuario crea
// proyectos («Nuevo»), importa tramos (KMZ/KML) y guarda/abre desde localStorage.
// ─────────────────────────────────────────────────────────────────────────────
import { getOpen, loadProjectState } from './proyectos.js?v=3';

const EMPTY_FC = () => ({ type: 'FeatureCollection', features: [] });

export async function loadProject() {
  const open = getOpen();
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
