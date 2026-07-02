// ─────────────────────────────────────────────────────────────────────────────
// red.js — Modelo de RED de cuencas (koi-flow, HMS-lite). Encadena elementos:
//   • subcuenca: genera su hidrograma (convolución del HU) — es una fuente.
//   • tramo:     transita por Muskingum/Muskingum-Cunge la suma de sus aportes.
//   • union:     suma los hidrogramas que llegan (confluencia).
// Cada elemento apunta a su nodo de AGUAS ABAJO; se resuelve en orden topológico y
// se entrega el hidrograma en el punto de cierre (el elemento sin aguas abajo).
// Todos los hidrogramas se llevan a una grilla temporal común (paso dt).
// ─────────────────────────────────────────────────────────────────────────────
import { hidrogramaTormenta } from './convolucion.js';
import { muskingum, muskingumCunge } from './routing.js';

const zeros = (n) => new Array(n).fill(0);
const sumar = (a, b) => a.map((v, i) => v + (b[i] || 0));

// Lleva un hidrograma [{t,Q}] a la grilla (dt, n). Tras el final sostiene el último (base).
function aGrid(hg, dt, n) {
  const tMax = hg[hg.length - 1].t, qEnd = hg[hg.length - 1].Q;
  const interp = (t) => {
    if (t <= hg[0].t) return hg[0].Q;
    if (t >= tMax) return qEnd;
    for (let i = 1; i < hg.length; i++) if (t <= hg[i].t) { const a = hg[i - 1], b = hg[i], r = (t - a.t) / ((b.t - a.t) || 1); return a.Q + r * (b.Q - a.Q); }
    return qEnd;
  };
  return Array.from({ length: n }, (_, i) => interp(i * dt));
}

// Simula la red. elementos: [{ id, tipo, aguasAbajo, ...params }].
//   subcuenca: { morfo, Ptotal, durH, CN, zona, patron, baseflow }
//   tramo:     { metodo:'cunge'|'musk', L,So,n,B  |  K(h),x }
//   union/salida: (sin params)
export function simularRed(elementos, { dt = 600 } = {}) {
  const byId = Object.fromEntries(elementos.map((e) => [e.id, e]));
  // 1) hidrogramas propios de subcuencas y horizonte temporal común
  const propio = {};
  let tEnd = 0;
  for (const e of elementos) if (e.tipo === 'subcuenca') {
    const h = hidrogramaTormenta(e.morfo, { Ptotal: e.Ptotal, durH: e.durH, CN: e.CN, zona: e.zona, patron: e.patron, baseflow: e.baseflow || 0 });
    propio[e.id] = h.out; tEnd = Math.max(tEnd, h.out[h.out.length - 1].t);
  }
  const n = Math.max(10, Math.ceil((tEnd * 1.6) / dt));
  // 2) resuelve outflow por nodo (recursivo, memoizado, orden topológico implícito)
  const memo = {}, enCurso = {};
  const outflow = (id) => {
    if (memo[id]) return memo[id];
    if (enCurso[id]) throw new Error('Ciclo en la red en el nodo ' + id);
    enCurso[id] = true;
    const el = byId[id];
    let inflow = zeros(n);
    for (const u of elementos) if (u.aguasAbajo === id) inflow = sumar(inflow, outflow(u.id));
    let out;
    if (el.tipo === 'subcuenca') out = sumar(inflow, aGrid(propio[id], dt, n));
    else if (el.tipo === 'tramo') {
      const r = el.metodo === 'musk'
        ? muskingum(inflow, { K: (el.K || 1) * 3600, x: el.x ?? 0.2, dt })
        : muskingumCunge(inflow, { L: el.L, So: el.So, n: el.n, B: el.B, dt });
      out = r.O;
    } else out = inflow;               // union / salida
    enCurso[id] = false;
    memo[id] = out;
    return out;
  };
  const salida = elementos.find((e) => !e.aguasAbajo || !byId[e.aguasAbajo]);
  if (!salida) throw new Error('La red no tiene punto de cierre (un elemento sin aguas abajo).');
  const outSal = outflow(salida.id);
  const picos = {};
  for (const e of elementos) picos[e.id] = Math.max(...memo[e.id] || outflow(e.id));
  return {
    salida: salida.id, dt, n,
    out: outSal.map((Q, i) => ({ t: i * dt, Q })),
    Qpico: Math.max(...outSal), picos,
  };
}
