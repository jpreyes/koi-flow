// ─────────────────────────────────────────────────────────────────────────────
// data.js — carga del proyecto activo de koi-flow.
// Ya NO hay proyecto hardcodeado: la app arranca VACÍA salvo que haya un proyecto
// marcado como abierto (localStorage). 'demo' = proyecto de muestra (Tarapacá,
// STR 1695) que se carga a pedido. Un id guardado reconstruye su estado.
// ─────────────────────────────────────────────────────────────────────────────
import { getOpen, loadProjectState } from './proyectos.js?v=2';

const EMPTY_FC = () => ({ type: 'FeatureCollection', features: [] });

// Proyecto de muestra (Tarapacá) — cargado sólo si el usuario abre "demo".
export async function demoProject() {
  const fc = await (await fetch('data/tramos_str1695.geojson?v=2')).json();
  const dems = { 'Tramo 3': 'data/dem_tramo3.json?v=2' };
  const project = {
    id: 'demo', name: 'Demo — STR 1695 (Tarapacá)',
    tramos: fc.features.map((f) => ({ name: f.properties.name, feature: f, npts: f.geometry.coordinates.length, dem: dems[f.properties.name] || null })),
  };
  return { project, fc };
}

export async function loadProject() {
  const open = getOpen();
  if (open === 'demo') return demoProject();
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
