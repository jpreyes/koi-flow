// ─────────────────────────────────────────────────────────────────────────────
// crecidas_historicas.js — Análisis del registro histórico de crecidas (koi-flow).
//
// Cuando existen eventos observados (aforos, marcas de agua, registros visuales),
// se contrastan contra la curva de frecuencia para:
//   (a) asignar a cada crecida observada su período de retorno (empírico y por modelo),
//   (b) verificar que el caudal de diseño envuelve la mayor crecida registrada,
//   (c) ajustar momentos por información histórica fuera del registro sistemático (WRC).
// ─────────────────────────────────────────────────────────────────────────────

// Período de retorno empírico (Weibull) de una serie observada.
export function periodosEmpiricos(serie) {
  const xs = [...serie].sort((a, b) => b - a);   // descendente
  const n = xs.length;
  return xs.map((Q, i) => ({ Q, rank: i + 1, T: (n + 1) / (i + 1), P: (i + 1) / (n + 1) }));
}

// Período de retorno de un caudal según un modelo ajustado (invierte quantile(T)).
export function Tdesde(model, Q) {
  let lo = 1.0001, hi = 1e5;
  if (model.quantile(lo) >= Q) return lo;
  if (model.quantile(hi) <= Q) return hi;
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi);             // bisección en log(T)
    if (model.quantile(mid) < Q) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

// Analiza eventos históricos contra el modelo y el caudal de diseño.
//   eventos: [{ año, Q, nota? }]   model: distribución ajustada (con quantile(T))
//   Qdiseno: { T: Q } caudales de diseño adoptados
export function analizarHistoricas(eventos, model, Qdiseno = {}) {
  const items = eventos.map((e) => ({
    ...e,
    T_modelo: model ? Tdesde(model, e.Q) : null,
  }));
  const maxObs = items.reduce((a, b) => (b.Q > a.Q ? b : a), items[0]);
  const Ts = Object.keys(Qdiseno).map(Number).sort((a, b) => a - b);
  // mayor T de diseño cuyo Q queda por debajo del máximo observado (lo "envuelve" o no)
  let envuelto = null;
  for (const T of Ts) if (Qdiseno[T] >= maxObs.Q) { envuelto = T; break; }
  return {
    eventos: items,
    maxObservado: maxObs,
    envueltoPorT: envuelto,                       // null => el diseño NO cubre la crecida histórica
    advertencia: envuelto == null
      ? `La mayor crecida registrada (${maxObs.Q} m³/s, ${maxObs['año'] ?? maxObs.year ?? '?'}) supera todos los T de diseño.`
      : null,
  };
}

// Ajuste por información histórica (Water Resources Council / B17): pondera la
// muestra sistemática para incorporar crecidas históricas sobre un umbral X0 en
// un período histórico h. Devuelve media y desviación ajustadas (espacio que se le pase).
//   sistematica: serie sistemática (n años);  historicas: peaks históricos > X0
//   h: longitud del período histórico (años);  X0: umbral
export function ajusteWRC(sistematica, historicas, h, X0) {
  const n = sistematica.length;
  const z = historicas.length;
  const l = sistematica.filter((x) => x >= X0).length;  // sistemáticos sobre umbral
  const w = (h - z) / (n + l);                          // peso de cada dato sistemático
  const bajos = sistematica.filter((x) => x < X0);
  const altos = [...historicas, ...sistematica.filter((x) => x >= X0)];
  const N = z + l + w * bajos.length;                   // tamaño efectivo ≈ h
  const mean = (altos.reduce((a, b) => a + b, 0) + w * bajos.reduce((a, b) => a + b, 0)) / N;
  let s2 = altos.reduce((a, b) => a + (b - mean) ** 2, 0)
         + w * bajos.reduce((a, b) => a + (b - mean) ** 2, 0);
  const std = Math.sqrt(s2 / (N - 1));
  return { n, z, l, w, h, X0, Nefectivo: N, mean, std };
}
