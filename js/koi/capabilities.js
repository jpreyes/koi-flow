// capabilities.js - catalogo unico de capacidades visibles en Analisis.
// Cada item se muestra siempre; si faltan prerequisitos queda bloqueado con leyenda.

export const ANALYSIS_CAPABILITIES = [
  { group: 'Espacios de trabajo', id: 'tab-cuenca', label: 'Cuenca y morfometria' },
  { group: 'Espacios de trabajo', id: 'tab-hidro', label: 'Hidrologia' },
  { group: 'Espacios de trabajo', id: 'tab-hidraulica', label: 'Hidraulica (batimetria / 1D / 2D)' },
  { group: 'Espacios de trabajo', id: 'tab-estructuras', label: 'Estructuras (puentes / alcantarillas)' },

  { group: 'Punto de analisis', id: 'cuenca-delinear', label: 'Delinear cuenca del punto', requires: ['activePoint'] },
  { group: 'Punto de analisis', id: 'afluentes-punto', label: 'Red de drenaje / afluentes del punto', requires: ['activePoint'] },
  { group: 'Punto de analisis', id: 'estaciones-dga', label: 'Estaciones DGA del punto', requires: ['activePoint'] },
  { group: 'Punto de analisis', id: 'frecuencia', label: 'Analisis de frecuencia / series DGA', requires: ['activePoint'] },

  { group: 'Crecidas y transito', id: 'tormenta', label: 'Tormenta de diseno (hietograma)' },
  { group: 'Crecidas y transito', id: 'convolucion', label: 'Hidrograma de crecida (HU)' },
  { group: 'Crecidas y transito', id: 'routing', label: 'Transito en cauce (Muskingum)' },
  { group: 'Crecidas y transito', id: 'embalse', label: 'Embalse (laminacion de crecida)' },
  { group: 'Crecidas y transito', id: 'red', label: 'Red de cuencas (HMS-lite)' },

  { group: 'Hidrologia continua', id: 'continuo', label: 'Continua + deshielo (HMS-lite)' },
  { group: 'Hidrologia continua', id: 'calibracion', label: 'Calibracion (Nelder-Mead)' },
  { group: 'Hidrologia continua', id: 'modclark', label: 'ModClark grillado (HMS-lite)' },

  { group: 'Hidraulica 1D', id: 'bati', label: 'Importar batimetria / DEM base' },
  { group: 'Hidraulica 1D', id: 'remanso1d', label: 'Remanso 1D / Manning', requires: ['hydraulicSurface', 'reachAxis'] },
  { group: 'Hidraulica 1D', id: 'inun1d', label: 'Mancha de inundacion 1D', requires: ['hydraulicSurface', 'reachAxis'] },

  { group: 'Hidraulica 2D', id: 'malla2d', label: 'Generar malla 2D', requires: ['hydraulicSurface', 'domain2d'] },
  { group: 'Hidraulica 2D', id: 'difusiva2d', label: 'Onda difusiva 2D', requires: ['mesh2d'] },
  { group: 'Hidraulica 2D', id: 'transiente2d', label: 'Transiente difusiva 2D', requires: ['mesh2d'] },
  { group: 'Hidraulica 2D', id: 'momentum2d', label: 'Momentum 2D aguas someras completas', requires: ['mesh2d'] },
  { group: 'Hidraulica 2D', id: 'morfo2d', label: 'Morfodinamico 2D', requires: ['mesh2d'] },

  { group: 'Obras hidraulicas', id: 'estructuras-place', label: 'Colocar/editar estructuras' },
  { group: 'Obras hidraulicas', id: 'alcantarilla', label: 'Alcantarilla (FHWA HDS-5)' },
  { group: 'Obras hidraulicas', id: 'puente-presion', label: 'Puente (presion / vertedero)' },
  { group: 'Obras hidraulicas', id: 'enrocado', label: 'Enrocado / defensas (MC 3.708)' },
  { group: 'Obras hidraulicas', id: 'verificaciones', label: 'Verificaciones (periodo T / revancha)' },
  { group: 'Obras hidraulicas', id: 'sismo-estribo', label: 'Sismica de estribos (Mononobe-Okabe)' },

  { group: 'Sedimentos y lecho', id: 'degradacion', label: 'Degradacion a largo plazo' },
  { group: 'Sedimentos y lecho', id: 'morfo1d', label: 'Lecho movil 1D (evolucion)' },

  { group: 'Riesgo y rotura', id: 'colocar-presa', label: 'Colocar presa / deposito (vaso desde DEM)' },
  { group: 'Riesgo y rotura', id: 'breach', label: 'Rotura de presa / relaves (Froehlich)' },
];

const REQUIREMENT_LABELS = {
  activePoint: 'punto de analisis activo',
  hydraulicSurface: 'batimetria DXF o DEM base',
  reachAxis: 'eje del cauce',
  domain2d: 'dominio 2D',
  mesh2d: 'malla 2D generada',
};

function currentState(koi) {
  const pts = koi?.map?.getPoints?.() || [];
  const bati = koi?.bati;
  return {
    activePoint: pts.length > 0,
    hydraulicSurface: !!(bati?.demM || bati?.baseDEM || bati?.grid || bati?.fused),
    reachAxis: !!bati?.eje,
    domain2d: !!bati?.dominio,
    mesh2d: !!bati?.mesh2d,
  };
}

export function unmetRequirements(cap, koi) {
  const st = currentState(koi);
  return (cap.requires || []).filter((r) => !st[r]);
}

export function requirementText(reqs) {
  return reqs.map((r) => REQUIREMENT_LABELS[r] || r).join(' + ');
}

export function renderAnalysisMenu(actions, koi) {
  const root = document.querySelector('[data-menu="analisis"] .menu-dd');
  if (!root) return;
  let html = '';
  let group = null;
  for (const cap of ANALYSIS_CAPABILITIES) {
    if (cap.group !== group) {
      group = cap.group;
      html += `<div class="menu-grp">${group}</div>`;
    }
    const missing = unmetRequirements(cap, koi);
    const blocked = missing.length > 0 || !actions?.[cap.id];
    const need = missing.length ? `Necesita: ${requirementText(missing)}` : (!actions?.[cap.id] ? 'No cableado todavia' : '');
    html += `<button class="menu-item${blocked ? ' disabled' : ''}" data-action="${cap.id}" aria-disabled="${blocked ? 'true' : 'false'}" title="${need}">${cap.label}</button>`;
    if (blocked && need) html += `<div class="menu-need">${need}</div>`;
  }
  root.innerHTML = html;
}
