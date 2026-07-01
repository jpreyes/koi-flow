// ─────────────────────────────────────────────────────────────────────────────
// degradacion.js — Degradación / agradación general del cauce a LARGO PLAZO (koi-flow).
// MC-V3 3.707.4 (la socavación TOTAL = degradación de largo plazo + socavación general
// por contracción + socavación local). HEC-18 la trata como una componente aparte.
//
// Estima el descenso (o ascenso) del lecho por un desbalance permanente de aporte de
// sedimentos (p.ej. aguas abajo de un embalse o de una extracción de áridos), con dos
// métodos y se adopta el más restrictivo:
//   • Pendiente de equilibrio: si el aporte baja a una razón r del transporte de
//       capacidad, el lecho se aplana hasta Se = S0·r^(1/m) (m≈1.5, Qs∝S^m). La
//       degradación en el extremo del tramo es Δz = (S0 − Se)·Lpivote.  r>1 ⇒ agrada.
//   • Acorazamiento: la degradación se detiene al formarse la coraza de material grueso
//       que el flujo ya no mueve.  Δz_coraza = 2·Dc·(1/Pc − 1)  (Pc = fracción más gruesa
//       que el tamaño competente Dc, desde Shields).
//
// Unidades SI. Autocontenido (sin imports) para test en Node. g=9.81, ρ=1000.
// ─────────────────────────────────────────────────────────────────────────────

const G = 9.81, RHO = 1000;

// Gasto sólido de fondo unitario (Meyer-Peter-Müller), inline: φ=8·(τ*−θc)^1.5.
function mpmUnit(h, J, D, s, thetaC) {
  const tau = RHO * G * h * J;
  const taux = tau / ((s - 1) * RHO * G * D);
  if (taux <= thetaC) return 0;
  return 8 * Math.pow(taux - thetaC, 1.5) * Math.sqrt((s - 1) * G * Math.pow(D, 3)); // m²/s
}

export function degradacionLargoPlazo(o) {
  const {
    h = 2, J = 0.005, B = 20, D50mm = 20, s = 2.65, thetaC = 0.047,
    L = 1000, razonAporte = 0.5, expTransporte = 1.5, fraccionGruesa = 0.1,
  } = o;
  const D = Math.max(D50mm, 0.1) / 1000, r = Math.max(0, razonAporte);
  const tau0 = RHO * G * h * J;
  const Dc = tau0 / (thetaC * (s - 1) * RHO * G);            // tamaño competente [m]
  const QsCap = mpmUnit(h, J, D, s, thetaC) * B;             // capacidad de transporte [m³/s]
  const mueve = QsCap > 1e-6;
  // pendiente de equilibrio y descenso en el extremo del tramo (pivote en el control).
  const Se = J * Math.pow(r, 1 / expTransporte);
  const dzPend = (J - Se) * L;                               // >0 degrada · <0 agrada
  // control por acorazamiento (solo aplica si hay transporte y déficit)
  const Pc = Math.min(0.95, Math.max(0.01, fraccionGruesa));
  const dzCoraza = Dc > 0 ? 2 * Dc * (1 / Pc - 1) : Infinity;
  const degradaEsperada = dzPend > 1e-3 && mueve;
  const degradacion = degradaEsperada ? Math.min(dzPend, dzCoraza) : 0;
  const agradacion = dzPend < -1e-3 ? -dzPend : 0;
  const limitadaPorCoraza = degradaEsperada && dzCoraza < dzPend;
  const tendencia = !mueve ? 'lecho estable (no hay transporte)'
    : dzPend > 1e-3 ? 'degradación' : dzPend < -1e-3 ? 'agradación' : 'equilibrio';
  return {
    tendencia, degradacion, agradacion, dzPendiente: dzPend, dzCoraza, limitadaPorCoraza,
    Dc_mm: Dc * 1000, QsCap, S0: J, Se, razonAporte: r, mueve,
    aporteASocavacion: degradacion,   // sumar a la socavación total (positivo = descenso)
  };
}
