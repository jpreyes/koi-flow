// ─────────────────────────────────────────────────────────────────────────────
// normas.js — Asistentes normativos de diseño (koi-flow). MC-V3 3.702 (períodos de
// retorno) y 3.702.4 / 3.707 (revancha / gálibo bajo tablero).
//
// Los períodos de retorno son REFERENCIALES; verificar contra la Tabla 3.702.203.A
// del Manual de Carreteras vigente y la categoría del camino.
// ─────────────────────────────────────────────────────────────────────────────

// Períodos de retorno de diseño por tipo de obra [años]. Tver = verificación
// (socavación / crecida extraordinaria). Valores referenciales del MC-V3 3.702.
export const PERIODOS_RETORNO = [
  { obra: 'Puentes y viaductos', T: 100, Tver: 200, nota: 'Diseño T=100; verificación de socavación T=200.' },
  { obra: 'Alcantarillas — camino principal / carretera', T: 25, Tver: 50, nota: 'Según categoría del camino (MC 3.702).' },
  { obra: 'Alcantarillas — camino secundario / local', T: 10, Tver: 25, nota: 'Caminos de menor tránsito.' },
  { obra: 'Badenes', T: 25, Tver: 50, nota: 'Obra de paso sumergible.' },
  { obra: 'Defensas fluviales / protección de riberas', T: 100, Tver: 100, nota: 'Coherente con la obra que protegen.' },
  { obra: 'Drenaje de la plataforma (cunetas, sifones)', T: 10, Tver: 10, nota: 'Drenaje menor; 5 años en zonas de bajo riesgo.' },
  { obra: 'Estructuras mayores / muros de gran altura', T: 100, Tver: 200, nota: 'Verificar riesgo aguas abajo.' },
];

// Sugerencia de T según el tipo de obra elegido.
export function sugerirT(obra) {
  return PERIODOS_RETORNO.find((p) => p.obra === obra) || PERIODOS_RETORNO[0];
}

// Chequeo de revancha / gálibo bajo el tablero (MC-V3 3.707.4):
//   gálibo = cota bajo-tablero − WSE de diseño ;  cumple si gálibo ≥ revancha mínima.
//   La revancha mínima crece con el arrastre de material flotante (troncos, palizada).
export function chequeoRevancha({ wseDiseno, cotaBajoTablero, revanchaMin = 1.0 }) {
  const galibo = cotaBajoTablero - wseDiseno;
  const cumple = galibo >= revanchaMin;
  return { galibo, revanchaMin, cumple, deficit: cumple ? 0 : revanchaMin - galibo };
}

// Revancha mínima recomendada según arrastre (referencial MC-V3):
//   sin arrastre 0.5–1.0 m · con sedimento grueso 1.0–1.5 m · con palizada/troncos 1.5–2.0 m.
export function revanchaRecomendada(arrastre = 'medio') {
  return { bajo: 0.5, medio: 1.0, alto: 1.5, extremo: 2.0 }[arrastre] ?? 1.0;
}
