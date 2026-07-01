// ─────────────────────────────────────────────────────────────────────────────
// enrocado.js — Dimensionamiento de enrocado / defensas fluviales (koi-flow).
// MC-V3 3.707.4 / 3.708 (protección de riberas y estructuras) · HEC-11 / HEC-23.
//
// Calcula el tamaño de roca (D50) por varios métodos según la aplicación:
//   • Ribera / lecho:   Isbash (USACE) y Maynord / HEC-11 (EM 1110-2-1601).
//   • Pila de puente:   HEC-23 (Design Guideline 12).
//   • Estribo:          HEC-23 (Design Guideline 14, por Froude).
// Entrega D50 adoptado (envolvente), peso de la roca, espesor de capa, granulometría
// (D15–D85) y empotramiento del pie ligado a la socavación calculada.
//
// Unidades SI. V [m/s], h/d [m], s=ρroca/ρagua (≈2.65). g=9.81, 2g=19.62. Salidas en m.
// ─────────────────────────────────────────────────────────────────────────────

const G = 9.81, G2 = 19.62;

// Factor de talud K1 (corrección por pendiente lateral de la ribera):
//   K1 = √(1 − sin²θ / sin²φ)   θ=ángulo del talud, φ=ángulo de reposo de la roca (~40°).
export function factorTalud(taludHV, phiGrados = 40) {
  // talud H:V → ángulo θ respecto a la horizontal.
  const th = Math.atan2(1, Math.max(0.01, taludHV));
  const phi = phiGrados * Math.PI / 180;
  const val = 1 - Math.pow(Math.sin(th) / Math.sin(phi), 2);
  return val > 0 ? Math.sqrt(val) : 0.1;   // talud más tendido que el reposo → K1→1
}

// Isbash (USACE): V = C·√(2g·(s−1)·d) → d = V²/(C²·2g·(s−1)).
//   C ≈ 1.20 (baja turbulencia) · 0.86 (alta turbulencia, junto a estructuras).
export function isbash(V, { s = 2.65, C = 0.86 } = {}) {
  return (V * V) / (C * C * G2 * (s - 1));
}

// Maynord / HEC-11 (EM 1110-2-1601): tamaño en ribera/lecho.
//   D30 = SF·Cs·Cv·CT·d·[ V/√(K1·(s−1)·g·d) ]^2.5 ;  D50 ≈ 1.2·D30 (grad. estándar).
export function maynordHec11(V, d, o = {}) {
  const { s = 2.65, taludHV = 2, phi = 40, SF = 1.1, Cs = 0.30, Cv = 1.0, CT = 1.0 } = o;
  const K1 = factorTalud(taludHV, phi);
  const D30 = SF * Cs * Cv * CT * d * Math.pow(V / Math.sqrt(K1 * (s - 1) * G * d), 2.5);
  return { D30, D50: 1.2 * D30, K1 };
}

// Enrocado en PILA — HEC-23 (DG 12): D50 = 0.692·(K·V)² / ((s−1)·2g).
//   K = 1.5 nariz redonda · 1.7 nariz cuadrada (Vlocal ≈ 1.5–1.7·V media junto a la pila).
export function enrocadoPila(V, { s = 2.65, forma = 'redonda' } = {}) {
  const K = forma === 'cuadrada' ? 1.7 : 1.5;
  return { D50: 0.692 * Math.pow(K * V, 2) / ((s - 1) * G2), K };
}

// Enrocado en ESTRIBO — HEC-23 (DG 14), por Froude de aproximación:
//   Fr ≤ 0.8:  D50/y = K·Fr²/(s−1)      Fr > 0.8:  D50/y = K·Fr^0.14/(s−1)
//   K = 0.89 derrame · 1.02 muro vertical  (Fr≤0.8) ; 0.61 / 0.69 (Fr>0.8).
export function enrocadoEstribo(V, y, { s = 2.65, forma = 'derrame' } = {}) {
  const Fr = V / Math.sqrt(G * Math.max(y, 1e-3));
  let K, D50;
  if (Fr <= 0.8) { K = forma === 'vertical' ? 1.02 : 0.89; D50 = (K * Fr * Fr / (s - 1)) * y; }
  else { K = forma === 'vertical' ? 0.69 : 0.61; D50 = (K * Math.pow(Fr, 0.14) / (s - 1)) * y; }
  return { D50, Fr, K };
}

// Peso de una roca esférica equivalente de diámetro D [m]: W = γs·(π/6)·D³.
export function pesoRoca(D, s = 2.65) {
  const kg = s * 1000 * (Math.PI / 6) * Math.pow(D, 3);
  return { kg, ton: kg / 1000 };
}

// Dimensionamiento integral. aplicacion: 'ribera' | 'lecho' | 'pila' | 'estribo'.
export function dimensionarEnrocado(o) {
  const { aplicacion = 'ribera', V = 3, h = 2, s = 2.65, taludHV = 2, forma = 'derrame',
    turbulencia = 'alta', socavacion = 0, phi = 40, SF = 1.1, Cv = 1.0 } = o;
  const metodos = {};
  const C = turbulencia === 'baja' ? 1.20 : 0.86;
  metodos.isbash = isbash(V, { s, C });
  if (aplicacion === 'ribera' || aplicacion === 'lecho') {
    const m = maynordHec11(V, h, { s, taludHV: aplicacion === 'lecho' ? 100 : taludHV, phi, SF, Cv });
    metodos.maynord = m.D50; metodos._K1 = m.K1;
  }
  if (aplicacion === 'pila') metodos.hec23pila = enrocadoPila(V, { s, forma: forma === 'cuadrada' ? 'cuadrada' : 'redonda' }).D50;
  if (aplicacion === 'estribo') { const e = enrocadoEstribo(V, h, { s, forma }); metodos.hec23estribo = e.D50; metodos._Fr = e.Fr; }
  const vals = Object.entries(metodos).filter(([k, v]) => !k.startsWith('_') && isFinite(v)).map(([, v]) => v);
  const D50 = Math.max(...vals, 0);
  const D100 = 1.5 * D50, D85 = 1.3 * D50, D15 = 0.55 * D50;   // gradación estándar (D85/D15≈2.4)
  const espesor = Math.max(1.5 * D50, D100);                    // ≥ mayor de 1.5·D50 ó D100
  const w = pesoRoca(D50, s), w100 = pesoRoca(D100, s);
  const pieEmpotrado = socavacion > 0 ? socavacion + 0.5 : null; // empotrar pie bajo socavación + resguardo
  return {
    aplicacion, V, h, s, D50, D15, D85, D100, espesor,
    W50_kg: w.kg, W50_ton: w.ton, W100_ton: w100.ton,
    metodos, pieEmpotrado, K1: metodos._K1, Fr: metodos._Fr,
  };
}
