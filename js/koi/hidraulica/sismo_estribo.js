// ─────────────────────────────────────────────────────────────────────────────
// sismo_estribo.js — empuje sísmico en estribos/muros por MONONOBE-OKABE (koi-flow).
// Método pseudo-estático clásico (Mononobe & Matsuo 1929; Okabe 1926; forma de
// Seed & Whitman / AASHTO): empuje activo con el ángulo de inercia sísmica
//   ψ = arctan( kh / (1−kv) )
//   K_AE = cos²(φ−ψ−θ) / [ cosψ·cos²θ·cos(δ+θ+ψ) · (1 + √Λ)² ]
//     con Λ = sen(φ+δ)·sen(φ−ψ−β) / ( cos(δ+θ+ψ)·cos(β−θ) )
//   P_AE = ½·γ·H²·(1−kv)·K_AE ;  ΔP_AE = P_AE − P_A (K_A = K_AE con ψ=0)
// El estático P_A se aplica a H/3 y el incremento dinámico ΔP_AE a 0.6·H
// (Seed & Whitman). Coeficiente sísmico kh = A0/(2g) según la zona sísmica
// (práctica MC 3.1004 / NCh433 para muros): A0 = 0.20g/0.30g/0.40g zonas 1/2/3.
// Incluye verificación SIMPLIFICADA de deslizamiento y volcamiento del muro
// (peso propio + inercia del muro kh·W; sin sobrecarga ni empuje pasivo del pie
// — conservador; la verificación estructural completa es de nodex/structweb3d).
// Unidades SI: H [m], γ [kN/m³], ángulos en GRADOS, empujes en kN/m (por metro).
// ─────────────────────────────────────────────────────────────────────────────
const rad = (g) => g * Math.PI / 180;

// A0/g por zona sísmica (NCh433 / MC 3.1004)
export const ZONAS_SISMICAS = { 1: 0.20, 2: 0.30, 3: 0.40 };

// Coeficiente de empuje activo M-O. Ángulos en grados; ψ=0 → Coulomb estático.
export function kMononobeOkabe({ phi, delta = null, beta = 0, theta = 0, psi = 0 } = {}) {
  const d = delta == null ? phi / 2 : delta;
  const f = rad(phi), dl = rad(d), b = rad(beta), th = rad(theta), ps = rad(psi);
  if (phi - psi - beta < 0) return { K: NaN, valido: false, nota: 'φ−ψ−β < 0: el relleno fluye (M-O no aplica; kh demasiado alto para este φ/β)' };
  const num = Math.pow(Math.cos(f - ps - th), 2);
  const lam = (Math.sin(f + dl) * Math.sin(f - ps - b)) / (Math.cos(dl + th + ps) * Math.cos(b - th));
  const den = Math.cos(ps) * Math.pow(Math.cos(th), 2) * Math.cos(dl + th + ps) * Math.pow(1 + Math.sqrt(Math.max(0, lam)), 2);
  return { K: num / den, valido: true, delta: d };
}

// Análisis completo del estribo/muro. o = {
//   H (altura [m]), gamma (peso relleno [kN/m³], 19 def), phi (fricción interna [°]),
//   delta (fricción muro-relleno [°], φ/2 def), beta (talud del relleno [°], 0),
//   theta (inclinación del trasdós desde la vertical [°], 0),
//   zona (1|2|3), kh (si se da, manda sobre la zona), kv (0 def),
//   W (peso del muro [kN/m]), Bz (ancho de la base [m]), muBase (fricción base, 0.55 def) }
export function sismoEstribo(o = {}) {
  const { H, gamma = 19, phi = 32, beta = 0, theta = 0, zona = 3, kv = 0, W = null, Bz = null, muBase = 0.55 } = o;
  if (!(H > 0)) throw new Error('Ingresa la altura del muro H.');
  const A0g = ZONAS_SISMICAS[zona] ?? 0.40;
  const kh = o.kh != null && isFinite(o.kh) ? o.kh : A0g / 2;
  const psi = Math.atan(kh / (1 - kv)) * 180 / Math.PI;

  const est = kMononobeOkabe({ phi, delta: o.delta, beta, theta, psi: 0 });
  const sis = kMononobeOkabe({ phi, delta: o.delta, beta, theta, psi });
  if (!sis.valido) return { ...sis, kh, psi, zona, A0g };

  const PA = 0.5 * gamma * H * H * est.K;                       // estático [kN/m]
  const PAE = 0.5 * gamma * H * H * (1 - kv) * sis.K;           // total sísmico
  const dPAE = Math.max(0, PAE - PA);                           // incremento dinámico
  const dRad = rad(sis.delta), thRad = rad(theta);
  const cosH = Math.cos(dRad + thRad);                          // componente horizontal del empuje
  const PAh = PA * cosH, dPh = dPAE * cosH;
  const brazoEst = H / 3, brazoDin = 0.6 * H;                   // Seed & Whitman
  const Msolic = PAh * brazoEst + dPh * brazoDin;               // momento volcante del empuje [kN·m/m]

  let FSdesl = null, FSvolc = null, Fmuro = null;
  if (W > 0 && Bz > 0) {
    Fmuro = kh * W;                                             // inercia del propio muro
    const Fresist = muBase * W;                                 // fricción en la base (sin pasivo: conservador)
    const Fsolic = PAh + dPh + Fmuro;
    FSdesl = Fresist / Math.max(1e-9, Fsolic);
    const Mres = W * (Bz / 2);                                  // peso al centro de la base
    const Mvol = Msolic + Fmuro * (H / 2);
    FSvolc = Mres / Math.max(1e-9, Mvol);
  }

  return {
    valido: true, zona, A0g, kh, kv, psi, KA: est.K, KAE: sis.K, delta: sis.delta,
    PA, PAE, dPAE, PAh, dPh, brazoEst, brazoDin, Msolic, Fmuro, FSdesl, FSvolc,
    cumpleDesl: FSdesl == null ? null : FSdesl >= 1.1,          // FS sísmicos usuales: ≥1.1 desliz., ≥1.15 volc.
    cumpleVolc: FSvolc == null ? null : FSvolc >= 1.15,
  };
}
