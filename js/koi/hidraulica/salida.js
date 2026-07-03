// ─────────────────────────────────────────────────────────────────────────────
// salida.js — salida completa por sección tipo HEC-RAS (koi-flow, Fase 4).
// Toma el perfil del eje (remanso/mixto) + la GRANULOMETRÍA del lecho y arma, por
// sección: hidráulica (WSE, energía, crítico, V, Fr, R, τ, potencia), TRANSPORTE de
// sedimentos (Shields, velocidad crítica, modo, gasto de fondo) y SOCAVACIÓN
// general (Lischtvan-Lebediev) + local en pila (HEC-18) + total. Exportable a CSV.
// ─────────────────────────────────────────────────────────────────────────────
import { nivelCritico } from './remanso.js?v=4';
import { evaluar as evalSed } from '../hidro/sedimentos.js?v=4';
import { socavacionGeneral, socavacionLocalPila } from './socavacion.js?v=4';

const RHO = 1000, G = 9.81;

// Análisis completo por sección.
//   perfil: salida de ejeRemanso/ejeMixto (con WSE, A, B, R, V, Fr, Sf, profMax…).
//   secciones: [{ station, nombre, pts:[{s,z}] }] (para crítico/socavación/sedimentos).
//   opts: { Q, D50mm, D84mm, s=2.65, T=100, pila:{a,forma,K3}, cohesivo, gammaS }.
export function analisisCompleto(perfil, secciones, opts = {}) {
  const { Q, D50mm = 20, s = 2.65, T = 100, pila = null, cohesivo = false, gammaS = 1.5 } = opts;
  const byStation = new Map(secciones.map((sec) => [sec.station, sec]));
  return perfil.map((p) => {
    const sec = byStation.get(p.station) || secciones.find((x) => x.nombre === p.nombre);
    const pts = sec?.pts || [];
    const h = p.profMax, J = Math.max(p.Sf, 1e-6), R = p.R, V = p.V, B = p.B;
    const tau0 = RHO * G * R * J;                       // esfuerzo de corte [N/m²]
    const zc = pts.length ? nivelCritico(pts, Q) : null;
    const sed = pts.length ? evalSed({ h, V, J, D50: D50mm / 1000, ancho: B, s }) : null;
    const gen = pts.length ? socavacionGeneral(p, pts, { Q, D50mm, T, cohesivo, gammaS }) : null;
    let local = null, total = gen ? gen.socavMax : 0;
    if (pila && pila.a > 0) {
      local = socavacionLocalPila({ a: pila.a, y1: h, Fr1: p.Fr, forma: pila.forma || 'circular', K3: pila.K3 ?? 1.1 });
      total = (gen ? gen.socavMax : 0) + local.ys;      // envolvente general + local
    }
    return {
      station: p.station, nombre: p.nombre, rama: p.rama,
      WSE: p.WSE, zCritico: zc, E: p.E, prof: h, A: p.A, B, R, V, Fr: p.Fr, Sf: J,
      regimen: p.regimen, tau0, potencia: tau0 * V,      // potencia de corriente [W/m²]
      sedModo: sed ? sed.modo : null, Vcritica: sed ? sed.Vcritica : null,
      arrastra: sed ? sed.arrastra : null, gastoFondo_kg_s: sed ? sed.gastoFondo_kg_s : null,
      shields: sed ? sed.taux : null,
      socavGeneral: gen ? gen.socavMax : null, socavLocal: local ? local.ys : null, socavTotal: total,
      zLechoSocavado: gen ? gen.zLechoMin : null,
    };
  });
}

// CSV con todas las columnas (salida tipo HEC-RAS + sedimentos + socavación).
export function salidaCSV(filas, meta = {}) {
  const cols = [
    ['Seccion', (r) => r.nombre || r.station.toFixed(1)],
    ['Station_m', (r) => r.station.toFixed(2)],
    ['WSE_m', (r) => f(r.WSE)], ['WSEcrit_m', (r) => f(r.zCritico)], ['E_energia_m', (r) => f(r.E)],
    ['Prof_m', (r) => f(r.prof)], ['Area_m2', (r) => f(r.A)], ['Ancho_m', (r) => f(r.B)], ['R_m', (r) => f(r.R)],
    ['V_m_s', (r) => f(r.V)], ['Froude', (r) => f(r.Fr)], ['Sf', (r) => f6(r.Sf)], ['Regimen', (r) => r.regimen],
    ['Tau_N_m2', (r) => f(r.tau0)], ['Potencia_W_m2', (r) => f(r.potencia)], ['Shields', (r) => f(r.shields)],
    ['Vcritica_m_s', (r) => f(r.Vcritica)], ['Arrastra', (r) => (r.arrastra ? 'si' : 'no')], ['ModoSedim', (r) => r.sedModo],
    ['GastoFondo_kg_s', (r) => f(r.gastoFondo_kg_s)],
    ['SocavGeneral_m', (r) => f(r.socavGeneral)], ['SocavLocal_m', (r) => f(r.socavLocal)], ['SocavTotal_m', (r) => f(r.socavTotal)],
    ['CotaLechoSocavado_m', (r) => f(r.zLechoSocavado)],
  ];
  const head = cols.map((c) => c[0]).join(',');
  const body = filas.map((r) => cols.map((c) => c[1](r)).join(',')).join('\n');
  const cab = `# koi-flow salida hidráulica  Q=${meta.Q ?? ''} m3/s  n=${meta.n ?? ''}  D50=${meta.D50mm ?? ''} mm  T=${meta.T ?? ''} anos\n`;
  return cab + head + '\n' + body + '\n';
}

const f = (v) => (v == null || !isFinite(v) ? '' : (+v).toFixed(3));
const f6 = (v) => (v == null || !isFinite(v) ? '' : (+v).toFixed(6));
