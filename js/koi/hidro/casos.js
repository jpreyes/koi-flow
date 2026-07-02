// ─────────────────────────────────────────────────────────────────────────────
// casos.js — caso hidrológico validado, SOLO como REFERENCIA (ya NO se cablea a la
// UI: la hidrología corre desde la cuenca delineada + estaciones elegidas del
// proyecto, no por un caso atado al nombre del tramo). Se conserva el Sector 17
// (Quebrada Retamilla) con sus valores publicados porque reproduce el informe S17
// y sirve de banco de pruebas (futuro CLI/tests, R6). No lo importa ningún módulo.
// ─────────────────────────────────────────────────────────────────────────────

export const CASO_S17 = {
  nombre: 'Sector 17 · Quebrada Retamilla (validación S17)',
  zona: 'arida',
  morfometria: {
    A: 951.30, L: 108.86, Lg: 46.38, La: 85.57, P: 300,
    S: 0.03, H: 3207, lat: 19, region: 'III',
  },
  nieve: {
    // Línea de nieve Peña-Vidal del informe; toda la cuenca queda bajo la línea.
    temperatura: { Href: 1000, Tref: 15.5, gradiente: 0.5, umbral: 1 },
    areaPluvial: 951.30,   // = área total (hipsometría real vendrá del DEM)
  },
  precipitacion: {
    estacion: 'Camiña (BNA 01611001-9)',
    file: 'data/estacion_camina.json',
    coefIDF: 'Putre',
    dist: 'pearson3',
    // PP de diseño 24h publicada (Pearson III ×1.10). La serie cruda da ~7% menos
    // porque el informe rellenó estadísticas (pendiente relleno/WRC).
    ppDisenoFijo: { 2: 6.52, 5: 20.88, 10: 35.52, 25: 58.23, 50: 77.44, 100: 98.15, 150: 110.88, 200: 120.18 },
  },
  fluviometria: {
    estacion: 'Río Camarones en Conanoxa (BNA 01502002-4)',
    file: 'data/estacion_camarones.json',
    dist: 'lognormal',
    // Cuantiles Log-Normal publicados (serie rellenada del informe).
    Qc_publicado: { 2: 16.5, 5: 40.0, 10: 63.5, 25: 103.8, 50: 142.7, 100: 189.9, 150: 221.9, 200: 246.7 },
  },
};

export const CASOS = { 'Tramo 3': CASO_S17 };

// Devuelve el caso completo asociado a un tramo, o null si aún no tiene morfometría
// (la morfometría vendrá de la fase de cuencas/DEM). Tramo 3 = demo validado S17.
export function casoDeTramo(nombre) {
  return CASOS[nombre] || null;
}
