// ─────────────────────────────────────────────────────────────────────────────
// manning.js — hidráulica 1D en secciones irregulares (koi-flow, Fase 3).
// Dada una sección (estación s [m] vs cota z [m]) calcula, para un nivel de agua
// WSE, el área, perímetro mojado, ancho superficial, R, V y Froude; y resuelve la
// PROFUNDIDAD NORMAL (Manning) para un caudal Q dado (n, pendiente J). Es una
// aproximación de flujo uniforme por sección — el eje hidráulico completo (remanso)
// vendrá con el solver por pasos / HEC-RAS.
//   Q = (1/n)·A·R^(2/3)·√J
// ─────────────────────────────────────────────────────────────────────────────

const G = 9.81;

// Propiedades hidráulicas de la sección para un nivel de agua WSE [m].
//   pts: [{ s, z }] ordenados por s.  Devuelve {A,P,B,R,zAgua} o A=0 si seco.
export function propiedades(pts, WSE) {
  let A = 0, P = 0, B = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const x1 = pts[i].s, z1 = pts[i].z, x2 = pts[i + 1].s, z2 = pts[i + 1].z;
    const d1 = WSE - z1, d2 = WSE - z2;                 // profundidad en cada extremo
    if (d1 <= 0 && d2 <= 0) continue;                   // segmento seco
    let xa = x1, za = z1, xb = x2, zb = z2, da = d1, db = d2;
    // recorta a los cruces con la superficie si un extremo está seco
    if (da < 0) { const t = d1 / (d1 - d2); xa = x1 + t * (x2 - x1); za = WSE; da = 0; }
    if (db < 0) { const t = d1 / (d1 - d2); xb = x1 + t * (x2 - x1); zb = WSE; db = 0; }
    const dx = xb - xa;
    A += 0.5 * (da + db) * dx;                          // área (trapecio de agua)
    P += Math.hypot(dx, zb - za);                       // perímetro mojado (fondo)
    B += dx;                                            // ancho superficial
  }
  return { A, P, B, R: P > 0 ? A / P : 0, WSE };
}

// Caudal por Manning a un nivel dado.
export function caudalManning(pts, WSE, n, J) {
  const { A, R } = propiedades(pts, WSE);
  if (A <= 0 || R <= 0) return 0;
  return (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(J);
}

// Profundidad normal: encuentra el WSE tal que el caudal de Manning = Q (bisección).
export function nivelNormal(pts, { Q, n = 0.035, J }) {
  const zMin = Math.min(...pts.map((p) => p.z));
  const zMax = Math.max(...pts.map((p) => p.z));
  let lo = zMin + 1e-4, hi = zMax;
  if (caudalManning(pts, hi, n, J) < Q) {               // desborda: extiende el nivel
    const rango = zMax - zMin || 1;
    for (let k = 0; k < 40 && caudalManning(pts, hi, n, J) < Q; k++) hi += rango;
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (caudalManning(pts, mid, n, J) < Q) lo = mid; else hi = mid;
  }
  const WSE = (lo + hi) / 2;
  const pr = propiedades(pts, WSE);
  const V = pr.A > 0 ? Q / pr.A : 0;
  const Dh = pr.B > 0 ? pr.A / pr.B : 0;                 // profundidad hidráulica media
  const Fr = Dh > 0 ? V / Math.sqrt(G * Dh) : 0;
  return { WSE, ...pr, Q, V, Fr, profMax: WSE - zMin, regimen: Fr >= 1 ? 'supercrítico' : 'subcrítico' };
}

// Eje hidráulico por sección (flujo uniforme): calcula el nivel normal en cada
// sección para el caudal Q. secciones: [{ puntos:[{s,z}], ... }].
export function ejeHidraulico(secciones, { Q, n = 0.035, J }) {
  return secciones.map((sec, i) => ({ i, ...nivelNormal(sec.puntos, { Q, n, J }) }));
}
