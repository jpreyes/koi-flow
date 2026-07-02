// ─────────────────────────────────────────────────────────────────────────────
// breach.js — hidrograma de ROTURA de presa / depósito de relaves (koi-flow).
// Parámetros de brecha e hidrograma por relaciones empíricas publicadas:
//   · Froehlich (2008): ancho medio de brecha y tiempo de falla
//       Bavg = 0.27·Ko·Vw^0.32·hb^0.04   (Ko = 1.3 sobrevertimiento, 1.0 tubificación)
//       tf   = 63.2·√( Vw / (g·hb²) )    [s]
//   · Froehlich (1995a): caudal pico de rotura
//       Qp = 0.607·Vw^0.295·hw^1.24      [m³/s]
//   · MacDonald & Langridge-Monopolis (1984), como CONTRASTE:
//       Qp = 1.154·(Vw·hw)^0.412
// Hidrograma: ascenso lineal 0→Qp en tf (formación de la brecha) y recesión lineal
// que CONSERVA el volumen embalsado (área del hidrograma = Vw).
// El resultado se deja en koi.hidrogramaCrecida → se rutea con el 2D de momentum
// (con reología de mezcla si es relave). Unidades SI. DS 50 (DGA) / GISTM.
// ─────────────────────────────────────────────────────────────────────────────
const G = 9.81;

// Parámetros de brecha + Qp. o = { Vw [m³], hb [m], hw [m] (= hb def), modo:'sobrevertimiento'|'tubificacion' }
export function parametrosBrecha({ Vw, hb, hw = null, modo = 'sobrevertimiento' } = {}) {
  if (!(Vw > 0) || !(hb > 0)) throw new Error('Ingresa el volumen embalsado Vw y la altura de brecha hb.');
  const hwx = hw > 0 ? hw : hb;
  const Ko = modo === 'tubificacion' ? 1.0 : 1.3;
  const Bavg = 0.27 * Ko * Math.pow(Vw, 0.32) * Math.pow(hb, 0.04);
  const tf = 63.2 * Math.sqrt(Vw / (G * hb * hb));
  const QpFroehlich = 0.607 * Math.pow(Vw, 0.295) * Math.pow(hwx, 1.24);
  const QpMLM = 1.154 * Math.pow(Vw * hwx, 0.412);
  return { Vw, hb, hw: hwx, modo, Ko, Bavg, tf, QpFroehlich, QpMLM, Qp: Math.max(QpFroehlich, QpMLM) };
}

// Hidrograma de rotura [{t,Q}] que conserva el volumen. opts:
//   Qp ('froehlich' def | 'mlm' | 'max' | número), dt (paso de muestreo, tf/20 def).
export function hidrogramaRotura(o = {}, opts = {}) {
  const p = parametrosBrecha(o);
  let Qp = p.QpFroehlich;
  if (opts.Qp === 'mlm') Qp = p.QpMLM;
  else if (opts.Qp === 'max') Qp = p.Qp;
  else if (isFinite(opts.Qp) && opts.Qp > 0) Qp = +opts.Qp;
  // ascenso 0→Qp en tf; recesión lineal Qp→0 en td con ½·Qp·(tf+td)=Vw ⟹ td = 2Vw/Qp − tf
  let tf = p.tf, td = 2 * p.Vw / Qp - tf;
  if (td <= 0) {   // Qp "demasiado alto" para el volumen: acorta la formación para conservar masa
    tf = p.Vw / Qp; td = tf;
  }
  const tTot = tf + td;
  const dt = opts.dt || Math.max(1, tf / 20);
  const out = [];
  for (let t = 0; t <= tTot + dt / 2; t += dt) {
    const Q = t <= tf ? (Qp * t / tf) : Math.max(0, Qp * (1 - (t - tf) / td));
    out.push({ t, Q });
  }
  if (out[out.length - 1].Q > 0) out.push({ t: tTot, Q: 0 });
  const vol = out.reduce((a, pt, i) => i ? a + (pt.Q + out[i - 1].Q) / 2 * (pt.t - out[i - 1].t) : 0, 0);
  return { ...p, QpUsado: Qp, td, tTot, out, volumenHidro: vol };
}
