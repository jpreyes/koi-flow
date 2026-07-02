// ─────────────────────────────────────────────────────────────────────────────
// worker_routd8.js — corre el ruteo D8 (relleno de depresiones + direcciones +
// acumulación de flujo) en un Web Worker, para el re-trazado AUTOMÁTICO del cauce
// al mover/zoom el mapa sin congelar la UI (routD8 es lo pesado: priority-flood +
// acumulación O(n)). El DEM llega copiado; los resultados (elev/recv/accum) vuelven
// por transferencia (sin copia).
//   entrada:  { grid:{nx,ny,bbox,data,zoom} }
//   salida:   { elev, recv, accum }   (transferibles)  |  { error }
// ─────────────────────────────────────────────────────────────────────────────
import { routD8 } from './delineacion.js';

self.onmessage = (ev) => {
  const { grid } = ev.data;
  try {
    const { elev, recv, accum } = routD8(grid);
    self.postMessage({ elev, recv, accum }, [elev.buffer, recv.buffer, accum.buffer]);
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
