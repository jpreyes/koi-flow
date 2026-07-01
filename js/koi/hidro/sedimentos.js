// ─────────────────────────────────────────────────────────────────────────────
// sedimentos.js — Transporte de sedimentos (koi-flow). MC-V3 Sección 3.707
// "Procedimientos y Técnicas de Hidráulica y Mecánica Fluvial":
//   3.707.303(5) Transporte incipiente o crítico (velocidad crítica, Shields)
//   3.707.304(1) Transporte en suspensión y de fondo
//   3.707.304(3) Transporte de fondo granular (Meyer-Peter & Müller)
// Insumo para socavación (Fase 4: Neill + Lischtvan-Lebediev) y diseño de defensas.
//
// NOTA: las formas implementadas son las estándar que adopta el manual; los
// coeficientes (θc de Shields, factores de MPM) deben contrastarse con las láminas
// 3.707.304 / 3.708.302 del MC-V3 al cerrar el módulo de socavación.
//
// Unidades SI: D [m], h [m], V [m/s], pendiente J [m/m], g=9.81, ρ=1000 kg/m³.
// s = ρs/ρ (≈2.65 para sedimento cuarzoso).
// ─────────────────────────────────────────────────────────────────────────────

export const G = 9.81;
export const RHO = 1000;        // agua [kg/m³]
export const S_DEFAULT = 2.65;  // densidad relativa del sedimento

// Esfuerzo de corte del flujo en el lecho: τ0 = ρ·g·h·J  [N/m²].
export function corteFlujo(h, J) { return RHO * G * h * J; }

// Esfuerzo de corte crítico de Shields: τc = θc·(s−1)·ρ·g·D  [N/m²].
export function corteCritico(D, { s = S_DEFAULT, thetaC = 0.047 } = {}) {
  return thetaC * (s - 1) * RHO * G * D;
}

// Esfuerzo de corte adimensional (parámetro de Shields): τ* = τ0 / ((s−1)·ρ·g·D).
export function shields(tau0, D, s = S_DEFAULT) { return tau0 / ((s - 1) * RHO * G * D); }

// Velocidad de corte: V* = √(g·h·J)  [m/s].
export function velocidadCorte(h, J) { return Math.sqrt(G * h * J); }

// Criterio de la velocidad crítica de arrastre (Maza/MC-V3 3.707.303(2)):
//   forma tipo Strickler  Vc = α·√((s−1)·g·D)·(h/D)^(1/6).  α≈1.41 (verificar).
export function velocidadCriticaArrastre(D, h, { s = S_DEFAULT, alfa = 1.41 } = {}) {
  return alfa * Math.sqrt((s - 1) * G * D) * Math.pow(h / D, 1 / 6);
}

// ¿Hay arrastre? Compara corte del flujo vs corte crítico.
export function hayArrastre(h, J, D, opts = {}) {
  const tau0 = corteFlujo(h, J), tauc = corteCritico(D, opts);
  return { tau0, tauc, taux: shields(tau0, D, opts.s ?? S_DEFAULT), arrastra: tau0 > tauc };
}

// Gasto sólido de fondo — Meyer-Peter & Müller (MC-V3 3.707.304(3)):
//   φ = 8·(τ* − τ*c)^1.5   (caudal sólido adimensional)
//   qsf = φ·√((s−1)·g·D³)  [m³/s por m de ancho] (volumen de sólidos sin poros)
//   gsf = qsf·ρs           [kg/s por m]
// Devuelve por unidad de ancho; multiplicar por el ancho activo del cauce.
export function meyerPeterMuller(h, J, D, { s = S_DEFAULT, thetaC = 0.047 } = {}) {
  const tau0 = corteFlujo(h, J);
  const taux = shields(tau0, D, s);
  if (taux <= thetaC) return { taux, thetaC, phi: 0, qsf: 0, gsf: 0, arrastra: false };
  const phi = 8 * Math.pow(taux - thetaC, 1.5);
  const qsf = phi * Math.sqrt((s - 1) * G * Math.pow(D, 3)); // m³/s/m
  const gsf = qsf * s * RHO;                                  // kg/s/m
  return { taux, thetaC, phi, qsf, gsf, arrastra: true };
}

// Velocidad de sedimentación (caída) — forma de Rubey (MC-V3 3.707.304(2).25):
//   Vs ≈ 1.1·√((s−1)·g·D)  para arenas/gravas (verificar rango).
export function velocidadCaida(D, { s = S_DEFAULT, k = 1.1 } = {}) {
  return k * Math.sqrt((s - 1) * G * D);
}

// Parámetro de suspensión (número de Rouse) z = Vs/(κ·V*); κ=0.4.
//   z < 0.8 suspensión dominante · 0.8–2.5 mixto · >2.5 sólo fondo.
export function rouse(Vs, Vast, kappa = 0.4) {
  const z = Vs / (kappa * Vast);
  const modo = z < 0.8 ? 'suspensión' : z <= 2.5 ? 'mixto (fondo+suspensión)' : 'fondo';
  return { z, modo };
}

// Resumen: dado el flujo de diseño (h, V, J) y el D50, evalúa modo y gasto de fondo.
export function evaluar({ h, V, J, D50, ancho = 1, s = S_DEFAULT }) {
  const tau0 = corteFlujo(h, J);
  const Vast = velocidadCorte(h, J);
  const Vs = velocidadCaida(D50, { s });
  const mpm = meyerPeterMuller(h, J, D50, { s });
  return {
    tau0, tauc: corteCritico(D50, { s }), taux: shields(tau0, D50, s),
    Vcritica: velocidadCriticaArrastre(D50, h, { s }), V,
    arrastra: mpm.arrastra, ...rouse(Vs, Vast),
    gastoFondo_kg_s: mpm.gsf * ancho, gastoFondo_m3_s: mpm.qsf * ancho, mpm,
  };
}
