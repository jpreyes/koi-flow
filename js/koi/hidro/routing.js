// ─────────────────────────────────────────────────────────────────────────────
// routing.js — Tránsito de crecidas en cauce (koi-flow). Complementa el ruteo por
// piscina nivelada (Puls, embalse.js) con tránsito hidrológico en cauce:
//   • Muskingum: O(i)=C0·I(i)+C1·I(i−1)+C2·O(i−1), coeficientes de K y x.
//   • Muskingum-Cunge: deriva K y x de la geometría e hidráulica del tramo (físico,
//     sin calibrar) usando la celeridad cinemática c=(5/3)·V.
// Unidades SI. K [s], dt [s], Q [m³/s]. inflow = [{t,Q}] o arreglo de Q con dt fijo.
// ─────────────────────────────────────────────────────────────────────────────

const G = 9.81;

function serieQ(inflow) {
  if (Array.isArray(inflow) && inflow.length && typeof inflow[0] === 'object') return inflow.map((p) => p.Q);
  return inflow.slice();
}

// Tránsito de Muskingum con K y x dados. Devuelve la serie de salida y métricas.
export function muskingum(inflow, { K, x, dt, Q0 } = {}) {
  const I = serieQ(inflow);
  const den = K - K * x + 0.5 * dt;
  const C0 = (-K * x + 0.5 * dt) / den;
  const C1 = (K * x + 0.5 * dt) / den;
  const C2 = (K - K * x - 0.5 * dt) / den;
  const O = new Array(I.length);
  O[0] = Q0 != null ? Q0 : I[0];
  for (let i = 1; i < I.length; i++) O[i] = C0 * I[i] + C1 * I[i - 1] + C2 * O[i - 1];
  return metricas(I, O, dt, { C0, C1, C2, K, x });
}

// Muskingum-Cunge: K, x desde geometría (tramo ancho rectangular B, pendiente So,
// Manning n). Qref = caudal de referencia (peak del inflow por defecto).
export function muskingumCunge(inflow, { L, So, n, B, dt, Qref, Q0 } = {}) {
  const I = serieQ(inflow);
  const Qr = Qref || Math.max(...I) || 1;
  // tirante normal en canal ancho: Qr = (1/n)·B·y·(y)^{2/3}·√So → y desde Manning.
  const y = Math.pow((Qr * n) / (B * Math.sqrt(So)), 3 / 5);
  const V = Qr / (B * y);
  const c = (5 / 3) * V;                 // celeridad cinemática
  const K = L / c;
  const x = 0.5 * (1 - Qr / (B * So * c * L));
  const r = muskingum(I, { K, x, dt, Q0 });
  return { ...r, K, x, c, y, V, Qref: Qr, celeridad: c };
}

function metricas(I, O, dt, extra) {
  const Ipk = Math.max(...I), Opk = Math.max(...O);
  const iPk = I.indexOf(Ipk), oPk = O.indexOf(Opk);
  const out = I.map((q, i) => ({ t: i * dt, I: q, O: O[i] }));
  return {
    out, O, IinPico: Ipk, QoutPico: Opk,
    atenuacion: Ipk > 0 ? (Ipk - Opk) / Ipk : 0,
    desfaseHoras: ((oPk - iPk) * dt) / 3600,
    ...extra,
  };
}

// Suma un flujo base (constante o recesión exponencial) a una serie de salida.
export function agregarFlujoBase(out, { base = 0, k = 0, dt = 0 } = {}) {
  return out.map((p, i) => ({ ...p, O: p.O + (k > 0 ? base * Math.exp(-k * i * dt / 3600) : base) }));
}
