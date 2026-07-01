// ─────────────────────────────────────────────────────────────────────────────
// puente_presion.js — Hidráulica de puente en flujo a PRESIÓN y VERTEDERO (koi-flow).
// Rutina tipo HEC-RAS (Hydraulic Reference Manual, "Pressure and Weir Flow") para
// cuando el tablero se sumerge: MC-V3 3.707 (afección aguas arriba del cruce).
//
// Regímenes:
//   1) Superficie libre        → el agua no toca el bajo-tablero (usar eje 1D).
//   2) Presión tipo compuerta  → solo aguas arriba toca el bajo-tablero (sluice gate):
//        Q = Cd·A·√(2g·(Eu − Zc))     Cd≈0.5 ; Zc = centroide del vano.
//   3) Presión tipo orificio   → aguas arriba y abajo sumergidos (orificio ahogado):
//        Q = Co·A·√(2g·(Eu − TW))     Co≈0.8.
//   4) Presión + vertedero      → además el agua supera la rasante y vierte por la calzada:
//        Qw = Cw·L·H^1.5  (H = Eu − Zrasante), con corrección por sumergencia (Villemonte).
//   Se resuelve la cota de energía aguas arriba Eu tal que Qpresión(Eu)+Qvertedero(Eu)=Q.
//
// Unidades SI. Cotas [m]; Q [m³/s]; g=9.81. Eu se maneja como cota de energía (≈WSE si
// la velocidad de aproximación es baja). "afección" = Eu − TW (remanso del puente).
// ─────────────────────────────────────────────────────────────────────────────

const G = 9.81, G2 = 19.62;

// Q por el vano a presión, dada la cota de energía aguas arriba Eu.
function qPresion(Eu, g) {
  if (Eu <= g.Zlow) return 0;
  if (g.TW <= g.Zlow) {                       // compuerta (sluice gate)
    const Y = Eu - g.Zcen;
    return Y > 0 ? g.Cd * g.Anet * Math.sqrt(G2 * Y) : 0;
  }
  const dH = Eu - g.TW;                        // orificio ahogado
  return dH > 0 ? g.Co * g.Anet * Math.sqrt(G2 * dH) : 0;
}

// Q por vertedero sobre la rasante, con sumergencia de Villemonte.
function qVertedero(Eu, g) {
  if (Eu <= g.Zcrest) return 0;
  const H = Eu - g.Zcrest;
  let q = g.Cw * g.Lw * Math.pow(H, 1.5);
  if (g.TW > g.Zcrest) {                       // vertedero ahogado
    const s = (g.TW - g.Zcrest) / H;
    q *= s < 1 ? Math.pow(1 - Math.pow(s, 1.5), 0.385) : 0.02;
  }
  return q;
}

// Analiza el puente para un caudal Q. Devuelve régimen, Eu (cota de energía aguas
// arriba), reparto Qpresión/Qvertedero, velocidad por el vano, afección y revancha.
export function puentePresion(o) {
  const Zinv = +o.Zinvert, Zlow = +o.Zlow, Zcrest = +o.Zcrest;
  const Bopen = +o.Bopen || 10, pilas = +o.pilas || 0;
  const Bnet = Math.max(0.1, Bopen - pilas);
  const hVano = Math.max(0.01, Zlow - Zinv);
  const g = {
    Zinv, Zlow, Zcrest, Anet: Bnet * hVano, Zcen: Zinv + hVano / 2,
    Cd: o.Cd != null ? +o.Cd : 0.5, Co: o.Co != null ? +o.Co : 0.8,
    Cw: o.Cw != null ? +o.Cw : 1.66, Lw: +o.Lw || Bopen, TW: +o.TW || Zinv,
  };
  const Q = +o.Q || 0;
  // ¿presuriza? Q incipiente cuando Eu = Zlow (compuerta): Cd·A·√(g·hVano).
  const Qincip = g.Cd * g.Anet * Math.sqrt(G * hVano);
  if (Q <= Qincip && g.TW <= Zlow) {
    return { regimen: 'libre', presuriza: false, Q, Qincip, Anet: g.Anet, hVano, Bnet,
      nota: 'El caudal no llega al bajo-tablero: el puente trabaja a superficie libre. Usa el eje hidráulico 1D para el WSE en el cruce.' };
  }
  // resuelve Eu por bisección tal que qPresion+qVertedero = Q.
  let lo = Zlow, hi = Zcrest + 20;
  const total = (Eu) => qPresion(Eu, g) + qVertedero(Eu, g);
  if (total(hi) < Q) hi = Zcrest + 200;         // caudal enorme
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (total(m) < Q) lo = m; else hi = m; }
  const Eu = (lo + hi) / 2;
  const Qp = qPresion(Eu, g), Qw = qVertedero(Eu, g);
  const vertiendo = Eu > Zcrest && Qw > 0.01 * Q;
  const orificio = g.TW > Zlow;
  const regimen = vertiendo ? 'presión + vertedero'
    : orificio ? 'presión (orificio ahogado)' : 'presión (compuerta)';
  const Vvano = Qp / g.Anet;
  return {
    regimen, presuriza: true, Q, Eu, Qpresion: Qp, Qvertedero: Qw,
    fracVertedero: Q > 0 ? Qw / Q : 0, Vvano, Anet: g.Anet, Bnet, hVano,
    TW: g.TW, afeccion: Eu - g.TW, sobreRasante: Math.max(0, Eu - Zcrest),
    revancha: Zcrest - Eu, Qincip, Zlow, Zcrest, Zinv,
  };
}

// Curva de gasto del puente: Eu (cota de energía) vs Q, marcando el inicio de
// presión (Zlow) y de vertido (Zcrest).
export function curvaPuente(o, { Qmax, nPtos = 24 } = {}) {
  const base = puentePresion({ ...o, Q: (Qmax || 100) });
  const qm = Qmax || Math.max(50, base.Q || 100);
  const pts = [];
  for (let i = 1; i <= nPtos; i++) {
    const Q = (qm * i) / nPtos;
    const r = puentePresion({ ...o, Q });
    pts.push({ Q, Eu: r.presuriza ? r.Eu : o.Zlow, regimen: r.regimen, vierte: r.regimen === 'presión + vertedero' });
  }
  return pts;
}
