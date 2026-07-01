// ─────────────────────────────────────────────────────────────────────────────
// linea_nieve.js — Línea de nieve y áreas aportantes (koi-flow, Fase 1).
// MC-V3 (3.702/3.906) + Manual DGA 1995 (Tabla 2.1). En cuencas de cordillera la
// crecida PLUVIAL la genera sólo la fracción de cuenca bajo la línea de nieves
// (área pluvial aportante); sobre ella la precipitación es nival y no contribuye
// al peak pluvial. El área pluvial Ap es la que entra a Verni-King/DGA-AC/HU y a
// la transposición — por eso este paso precede al cálculo de caudales.
//
// Criterio MC: para crecidas de diseño de ORIGEN PLUVIAL se adopta la línea de
// nieves MÁS ALTA, para MAXIMIZAR el área aportante (conservador).
//
// Referencia S17 (Quebrada Retamilla, lat ~19°): Línea de Nieve Peña-Vidal = 3910
// msnm (gradiente −0.5 °C/100 m, umbral 1 °C, PP>10 mm) → área pluvial = 951.30 km²
// (toda la cuenca), área nival = 0.
// ─────────────────────────────────────────────────────────────────────────────

// Línea de nieve por temperatura (método Peña-Vidal): cota donde T = umbral.
//   Href [m], Tref [°C] a esa cota; gradiente [°C/100 m] (positivo); umbral [°C].
export function lineaNieveTemperatura({ Href, Tref, gradiente = 0.5, umbral = 1 }) {
  return Href + ((Tref - umbral) / gradiente) * 100;
}

// Línea de nieve por latitud (tabla DGA 2.1 — sembrada; extender con la tabla real).
// Devuelve la cota [msnm] interpolada linealmente por latitud sur (grados).
const TABLA_DGA = { 18: 4000, 19: 3910, 20: 3800 };  // semilla; reemplazar con Tabla 2.1 completa
export function lineaNieveLatitud(latSur, tabla = TABLA_DGA) {
  const ls = Object.keys(tabla).map(Number).sort((a, b) => a - b);
  if (latSur <= ls[0]) return tabla[ls[0]];
  if (latSur >= ls[ls.length - 1]) return tabla[ls[ls.length - 1]];
  for (let i = 0; i < ls.length - 1; i++) if (latSur >= ls[i] && latSur <= ls[i + 1]) {
    const t = (latSur - ls[i]) / (ls[i + 1] - ls[i]);
    return tabla[ls[i]] + t * (tabla[ls[i + 1]] - tabla[ls[i]]);
  }
}

// Áreas aportantes a partir de la curva hipsométrica y la línea de nieves.
//   hipso: bandas [{ cota_inf, cota_sup, area }] (km²) o curva [{ cota, areaAcum }].
//   Hnieve: cota de la línea de nieves [msnm].
// Devuelve { areaTotal, areaPluvial (bajo Hnieve), areaNival (sobre), fraccionPluvial }.
export function areasAportantes(bandas, Hnieve) {
  let pluvial = 0, nival = 0, total = 0;
  for (const b of bandas) {
    const inf = b.cota_inf, sup = b.cota_sup, a = b.area;
    total += a;
    if (sup <= Hnieve) pluvial += a;            // banda completa bajo la línea
    else if (inf >= Hnieve) nival += a;         // banda completa sobre la línea
    else {                                      // banda cortada por la línea: prorrateo lineal
      const fr = (Hnieve - inf) / (sup - inf);
      pluvial += a * fr; nival += a * (1 - fr);
    }
  }
  return { areaTotal: total, areaPluvial: pluvial, areaNival: nival, fraccionPluvial: total ? pluvial / total : 0, Hnieve };
}

// Determina la línea de nieves y el área pluvial aportante de diseño.
//   metodos: { latitud?, temperatura? } cada uno produce una cota candidata.
//   politica 'pluvial' (por defecto) → adopta la cota MÁS ALTA (maximiza Ap).
export function areaPluvialDiseno(bandas, metodos = {}, politica = 'pluvial') {
  const cotas = [];
  if (metodos.latitud != null) cotas.push({ metodo: 'Latitud (DGA 2.1)', H: lineaNieveLatitud(metodos.latitud) });
  if (metodos.temperatura) cotas.push({ metodo: 'Temperatura (Peña-Vidal)', H: lineaNieveTemperatura(metodos.temperatura) });
  if (metodos.cota != null) cotas.push({ metodo: 'Cota dada', H: metodos.cota });
  if (!cotas.length) throw new Error('Indique al menos un método de línea de nieves');
  const adoptada = politica === 'pluvial'
    ? cotas.reduce((a, b) => (b.H > a.H ? b : a))   // más alta → más área pluvial
    : cotas.reduce((a, b) => (b.H < a.H ? b : a));
  const areas = areasAportantes(bandas, adoptada.H);
  return { candidatas: cotas, lineaNieve: adoptada, ...areas, politica };
}
