// ─────────────────────────────────────────────────────────────────────────────
// transposicion.js — Caudales por método DIRECTO (fluviometría) (koi-flow, Fase 1).
//
// En zonas áridas (norte de Chile) los métodos pluviales (Racional/IDF) NO son
// confiables: la lluvia es convectiva y esporádica y la relación lluvia-escorrentía
// no es válida. El caudal de diseño debe GOBERNARLO el método con control
// fluviométrico: se hace análisis de frecuencia sobre la serie de caudales máximos
// instantáneos de una estación patrón y se transpone a la cuenca sin control.
//
// Transposición por la fórmula original de Verni-King (informe S17):
//   Qx = Qc · (Apx/Apc)^a · (Px24/Pc24)^p      con a=0.88, p=1.24
// Si la precipitación es homogénea (Px24=Pc24) el segundo factor vale 1.
//
// Validado vs informe S17 (estación Río Camarones en Conanoxa, A=2009 km²,
// distribución Log-Normal → cuenca Sector 17 A=951.3 km²): reproduce la
// Tabla 3-41/3-42 de caudales adoptados.
// ─────────────────────────────────────────────────────────────────────────────
import { analizar } from './frecuencia.js?v=4';

export const VERNI_KING = { a: 0.88, p: 1.24 };

// Factor de transposición entre cuenca con control (c) y sin control (x).
//   Apx, Apc: áreas pluviales [km²];  Px24, Pc24: PP de diseño 24h [mm] (opcional).
export function factorTransposicion({ Apx, Apc, Px24 = 1, Pc24 = 1 }, exp = VERNI_KING) {
  return Math.pow(Apx / Apc, exp.a) * Math.pow(Px24 / Pc24, exp.p);
}

// Transpone una serie de caudales de la estación patrón a la cuenca de estudio.
//   patron: { serie: {año:Q} | [Q], area_km2 }   estación con control fluviométrico
//   cuenca: { Apx, Px24?, Pc24? }                 cuenca sin control
//   opts:   { distribucion?: 'lognormal'|...|'mejor', T?, exp?, pp24?:{T:mm} }
// Devuelve { estacion, factor, distribucion, Qc:{T}, Qx:{T}, analisis }.
export function transponer(patron, cuenca, opts = {}) {
  // Cuantiles de la estación patrón: o se entregan ya calculados (opts.Qc), o se
  // obtienen del análisis de frecuencia de la serie (serie cruda o rellenada).
  let analisis = null, dist = opts.distribucion || 'lognormal', Qc;
  if (opts.Qc) {
    Qc = opts.Qc;
  } else {
    const serie = Array.isArray(patron.serie) ? patron.serie : Object.values(patron.serie);
    analisis = analizar(serie, { T: opts.T });
    dist = !opts.distribucion || opts.distribucion === 'mejor' ? analisis.mejor : opts.distribucion;
    Qc = analisis.resultados[dist].quantiles;
  }

  const Ts = opts.T || (analisis ? analisis.T : Object.keys(Qc).map(Number));
  const exp = opts.exp || VERNI_KING;
  const Qx = {};
  const factores = {};
  for (const T of Ts) {
    // permite ratio de precipitación por T si se entregan pp24 de ambas cuencas
    const Px24 = opts.pp24 && opts.pp24[T] != null ? opts.pp24[T] : (cuenca.Px24 ?? 1);
    const Pc24 = cuenca.Pc24 ?? 1;
    const f = factorTransposicion({ Apx: cuenca.Apx, Apc: patron.area_km2, Px24, Pc24 }, exp);
    factores[T] = f;
    Qx[T] = Qc[T] * f;
  }

  return {
    metodo: 'Transposición (fluviometría)',
    estacion: patron.nombre || 'estación patrón',
    Apc: patron.area_km2, Apx: cuenca.Apx,
    distribucion: dist, exp, factor: factores,
    Qc, Qx, valores: Object.fromEntries(Ts.map((T) => [T, { Q: Qx[T] }])),
    analisis, gobierna: true,
    nota: 'Método directo con control fluviométrico — gobierna el diseño en zona árida.',
  };
}

// Estimación de una cuenca sin control desde VARIAS estaciones de cuencas similares
// (regionalización por transposición ponderada). Cada donante se transpone por
// Verni-King a la cuenca objetivo y se combinan con pesos por similitud.
//   donantes: [{ nombre, area_km2, lon, lat, Qc?:{T}, serie?, dist?:'lognormal'|... }]
//   objetivo: { Apx, lon, lat, Px24?, Pc24? }
//   opts: { T?, exp?, pesos?:'distancia'|'area'|'igual', distribucion? }
// Peso por defecto = inverso de la distancia geográfica donante→objetivo (si hay
// coords), si no por similitud de área (1/|ln(Ax/Ad)|), si no igual.
export function transponerRegional(donantes, objetivo, opts = {}) {
  const Ts = opts.T || [2, 5, 10, 25, 50, 100, 150, 200];
  const exp = opts.exp || VERNI_KING;
  const haversine = (a, b) => {
    const R = 6371, r = Math.PI / 180;
    const dphi = (b.lat - a.lat) * r, dl = (b.lon - a.lon) * r;
    const x = Math.sin(dphi / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };

  const items = donantes.map((d) => {
    const tr = transponer(
      { nombre: d.nombre, area_km2: d.area_km2, serie: d.serie },
      { Apx: objetivo.Apx, Px24: objetivo.Px24, Pc24: objetivo.Pc24 },
      { Qc: d.Qc, distribucion: d.dist || opts.distribucion || 'lognormal', T: Ts },
    );
    let peso = 1;
    const modo = opts.pesos || (objetivo.lon != null && donantes[0].lon != null ? 'distancia' : 'area');
    if (modo === 'distancia' && d.lon != null && objetivo.lon != null) {
      peso = 1 / Math.max(haversine(d, objetivo), 1);
    } else if (modo === 'area') {
      peso = 1 / Math.max(Math.abs(Math.log(objetivo.Apx / d.area_km2)), 1e-3);
    }
    return { donante: d.nombre, area: d.area_km2, peso, Qx: tr.Qx, factor: tr.factor };
  });

  const sw = items.reduce((s, it) => s + it.peso, 0) || 1;
  const Qx = {};
  for (const T of Ts) Qx[T] = items.reduce((s, it) => s + it.peso * it.Qx[T], 0) / sw;

  return {
    metodo: 'Cuenca similar (regional)',
    donantes: items.map((it) => ({ nombre: it.donante, area: it.area, peso: it.peso / sw })),
    Qx, valores: Object.fromEntries(Ts.map((T) => [T, { Q: Qx[T] }])),
    gobierna: true,
    nota: 'Estimación regional: transposición ponderada desde estaciones de cuencas similares.',
  };
}
