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

// Gasto sólido TOTAL (fondo + suspensión) — Engelund-Hansen:
//   φ = 0.1·θ^{5/2}/f' ,  f' = 2·g·h·J/V²  (factor de fricción) ;  qst = φ·√((s−1)g D³) [m²/s/m].
export function engelundHansen(h, V, J, D, { s = S_DEFAULT } = {}) {
  const tau0 = corteFlujo(h, J), theta = shields(tau0, D, s);
  const fprime = 2 * G * h * J / (V * V || 1e-6);
  const phi = 0.1 * Math.pow(Math.max(theta, 0), 2.5) / (fprime || 1e-6);
  const qst = phi * Math.sqrt((s - 1) * G * Math.pow(D, 3));
  return { theta, phi, qst };
}

// Perfil de transporte a lo largo del reach: gasto sólido por sección (MPM y E-H) y
// tendencia de EROSIÓN/DEPÓSITO por el gradiente de transporte (Exner simplificado):
//   ∂z/∂t = −1/(1−p)·(1/B)·∂Q_s/∂x  → si Qs crece aguas abajo hay déficit → erosión.
export function perfilTransporte(secs, { D50mm = 20, s = S_DEFAULT, J = 0.005, poros = 0.4 } = {}) {
  const D = Math.max(D50mm, 0.1) / 1000;
  const rows = (secs || []).filter((x) => x.res).map((x) => {
    const r = x.res, Hm = (r.A > 0 && r.B > 0) ? r.A / r.B : (r.profMax || 1), B = r.B || 1, V = r.V || 0;
    const mpm = meyerPeterMuller(Hm, J, D, { s }), eh = engelundHansen(Hm, V, J, D, { s });
    return { nombre: x.nombre, station: x.station || 0, tau0: corteFlujo(Hm, J), tauc: corteCritico(D, { s }), arrastra: mpm.arrastra, Qs_mpm: mpm.qsf * B, Qs_eh: eh.qst * B, B, Hm };
  }).sort((a, b) => a.station - b.station);
  for (let i = 0; i < rows.length; i++) {
    let grad = 0;
    if (i > 0) { const dS = (rows[i].station - rows[i - 1].station) || 1; grad = (rows[i].Qs_mpm - rows[i - 1].Qs_mpm) / dS; }
    rows[i].grad = grad;
    rows[i].dzdt = -1 / (1 - poros) / rows[i].B * grad;   // m/s (tendencia, referencial)
    rows[i].tendencia = grad > 1e-6 ? 'erosión' : grad < -1e-6 ? 'depósito' : 'equilibrio';
  }
  return rows;
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
