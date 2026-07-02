// ─────────────────────────────────────────────────────────────────────────────
// continuo.js — Simulación hidrológica CONTINUA (koi-flow, HMS-lite). Balance diario
// de humedad de suelo + DESHIELO por índice de temperatura (grado-día), relevante en
// cuencas nivo-pluviales andinas del sur de Chile.
//   Nieve (grado-día):  si T≤Tb la P cae como nieve (acumula SWE); si T>Tb funde
//     M = Cm·(T−Tb) [mm/d] (limitado por SWE) y el agua = lluvia + fusión.
//   Suelo (balde):  entra agua, sale ET, percola a subterráneo y escurre por exceso
//     de saturación (S>Smax).  Subterráneo = reservorio lineal → flujo base.
//   Q [mm/d] = escorrentía directa + flujo base ; a m³/s: Q·A/86.4.
// Autocontenido (sin imports) para test en Node. Series diarias.
// ─────────────────────────────────────────────────────────────────────────────

// Serie diaria sintética (T sinusoidal, P estacional en invierno) para un año.
export function serieSintetica({ Panual = 1500, Tmedia = 5, amplitudT = 8, nDias = 365, diaFrio = 200 } = {}) {
  const w = [], serie = [];
  for (let i = 0; i < nDias; i++) w.push(Math.max(0, 1 + 1.2 * Math.cos((2 * Math.PI * (i - diaFrio)) / 365)));
  // pulsos de lluvia cada 3 días, ponderados por estación
  let sumW = 0; for (let i = 0; i < nDias; i++) if (i % 3 === 0) sumW += w[i];
  for (let i = 0; i < nDias; i++) {
    const T = Tmedia - amplitudT * Math.cos((2 * Math.PI * (i - diaFrio)) / 365);
    const P = (i % 3 === 0 && sumW > 0) ? (Panual * w[i]) / sumW : 0;
    serie.push({ dia: i, P: +P.toFixed(2), T: +T.toFixed(2) });
  }
  return serie;
}

// Balance continuo. serie=[{P,T}] diaria. Devuelve series de Q, SWE, aportes.
export function simularContinuo(serie, o = {}) {
  const { area = 300, Tb = 0, Cm = 4, Smax = 100, kPerc = 0.06, kBase = 0.03, PET = 2, S0 = 40, swe0 = 0 } = o;
  let SWE = swe0, S = S0, GW = 0;
  const out = [];
  let volDir = 0, volBase = 0, volFus = 0, sweMax = 0;
  for (const d of serie) {
    let agua;                                   // agua disponible al suelo [mm]
    let fusion = 0;
    if (d.T <= Tb) { SWE += d.P; agua = 0; }     // nieve: acumula
    else { fusion = Math.min(SWE, Cm * (d.T - Tb)); SWE -= fusion; agua = d.P + fusion; }
    sweMax = Math.max(sweMax, SWE); volFus += fusion;
    // suelo
    S += agua;
    const et = Math.min(S, PET * Math.max(0, d.T) / 10);   // ET simple ligada a T
    S -= et;
    const perc = kPerc * S; S -= perc; GW += perc;          // percolación a subterráneo
    let dir = 0;
    if (S > Smax) { dir = S - Smax; S = Smax; }              // escorrentía por saturación
    const base = kBase * GW; GW -= base;                     // recesión del subterráneo
    const Qmm = dir + base;
    const Qcms = (Qmm * area) / 86.4;
    volDir += dir; volBase += base;
    out.push({ dia: d.dia, T: d.T, P: d.P, SWE: +SWE.toFixed(1), fusion: +fusion.toFixed(2), Q: +Qcms.toFixed(2), Qmm: +Qmm.toFixed(2) });
  }
  const Qs = out.map((r) => r.Q);
  return {
    serie: out, area, Qmax: Math.max(...Qs), Qmin: Math.min(...Qs),
    Qmedia: Qs.reduce((a, b) => a + b, 0) / Qs.length,
    sweMax: +sweMax.toFixed(1), volFusion_mm: +volFus.toFixed(0),
    fraccionNival: volDir + volBase > 0 ? volFus / (volDir + volBase + volFus) : 0,
  };
}
