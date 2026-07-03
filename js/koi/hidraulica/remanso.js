// ─────────────────────────────────────────────────────────────────────────────
// remanso.js — eje hidráulico 1D por REMANSO / paso estándar (koi-flow, Fase 4).
// Flujo gradualmente variado permanente entre varias secciones (lo que hace el 1D
// de HEC-RAS): resuelve el perfil de la superficie del agua balanceando la ENERGÍA
// entre secciones adyacentes, con pérdidas por fricción (Manning) y por
// expansión/contracción. Régimen sub o supercrítico (control aguas abajo o arriba).
//   H = WSE + V²/2g   (energía total, datum absoluto)
//   H_arriba = H_abajo + hf + he   (subcrítico, se marcha aguas arriba)
//   hf = Sf̄·Δx ,  Sf = (Q·n / (A·R^{2/3}))² ,  he = Ce·|V²/2g arriba − abajo|
// ─────────────────────────────────────────────────────────────────────────────
import { propiedades, nivelNormal } from './manning.js?v=3';
import { puentePresion } from './puente_presion.js?v=3';

const G = 9.81;
const zBed = (pts) => Math.min(...pts.map((p) => p.z));

// ÁREAS INEFECTIVAS (HEC-RAS): bajo la cota gatillo `elev`, solo conduce el tramo
// [sL,sR] (el resto almacena pero no conduce → se recorta la geometría de conveyance).
function ptsEfectivos(pts, inef, WSE) {
  if (!inef) return pts;
  const { sL, sR, elev } = inef;
  if (elev != null && WSE >= elev) return pts;               // sobre el gatillo: todo efectivo
  const zAt = (s) => { for (let i = 1; i < pts.length; i++) if (s <= pts[i].s) { const a = pts[i - 1], b = pts[i], r = (s - a.s) / ((b.s - a.s) || 1); return a.z + r * (b.z - a.z); } return pts[pts.length - 1].z; };
  const out = [{ s: sL, z: zAt(sL) }];
  for (const p of pts) if (p.s > sL && p.s < sR) out.push(p);
  out.push({ s: sR, z: zAt(sR) });
  return out.length >= 2 ? out : pts;
}

// Estado hidráulico de una sección a un nivel WSE, para caudal Q y rugosidad n.
// `inef` (opcional) recorta la conveyance por áreas inefectivas.
function estado(pts, WSE, Q, n, inef) {
  const p = propiedades(ptsEfectivos(pts, inef, WSE), WSE);
  if (p.A <= 0) return null;
  const V = Q / p.A;
  const Sf = Math.pow((Q * n) / (p.A * Math.pow(p.R, 2 / 3)), 2);
  const Dh = p.B > 0 ? p.A / p.B : 0;
  const Fr = Dh > 0 ? V / Math.sqrt(G * Dh) : 0;
  const vh = (V * V) / (2 * G);
  return { ...p, V, Sf, Fr, vh, WSE, H: WSE + vh };
}

// Fuerza específica / función momento M = Q²/(g·A) + ∫(WSE−z)²/2 ds  [m³] (por ρg).
// Se conserva en un resalto hidráulico → sirve para ubicarlo y hallar tirantes conjugados.
export function fuerzaEspecifica(pts, WSE, Q) {
  let A = 0, mom = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const x1 = pts[i].s, z1 = pts[i].z, x2 = pts[i + 1].s, z2 = pts[i + 1].z;
    const d1 = WSE - z1, d2 = WSE - z2;
    if (d1 <= 0 && d2 <= 0) continue;
    let xa = x1, xb = x2, ha = d1, hb = d2;
    if (d1 < 0) { const t = d1 / (d1 - d2); xa = x1 + t * (x2 - x1); ha = 0; }
    if (d2 < 0) { const t = d1 / (d1 - d2); xb = x1 + t * (x2 - x1); hb = 0; }
    const dx = xb - xa;
    A += 0.5 * (ha + hb) * dx;
    mom += dx * (ha * ha + ha * hb + hb * hb) / 6;   // ∫ h²/2 ds (empuje hidrostático)
  }
  return A > 0 ? (Q * Q) / (G * A) + mom : Infinity;
}

// Profundidad/nivel CRÍTICO: WSE tal que Fr=1  ⇔  Q²·B/(g·A³)=1.
export function nivelCritico(pts, Q, inef) {
  const zMin = zBed(pts), zMax = Math.max(...pts.map((p) => p.z));
  const fr2 = (WSE) => { const p = propiedades(ptsEfectivos(pts, inef, WSE), WSE); return (p.A <= 0 || p.B <= 0) ? Infinity : (Q * Q * p.B) / (G * Math.pow(p.A, 3)); };
  let lo = zMin + 1e-4, hi = zMax;
  const rango = (zMax - zMin) || 1;
  for (let k = 0; k < 50 && fr2(hi) > 1; k++) hi += rango;   // crítico por sobre el borde (Q alto)
  for (let i = 0; i < 90; i++) { const m = (lo + hi) / 2; if (fr2(m) > 1) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// Resuelve WSE en una sección para energía total objetivo H, en la rama pedida
// (subcrítica: WSE>zc ; supercrítica: zBed<WSE<zc). H es monótona en cada rama.
function wseParaH(pts, Q, n, Htarget, zc, subcritico, inef) {
  const Hof = (WSE) => { const s = estado(pts, WSE, Q, n, inef); return s ? s.H : null; };
  if (subcritico) {
    let lo = zc, hi = zc + 1;
    for (let k = 0; k < 60 && (Hof(hi) ?? -Infinity) < Htarget; k++) hi += Math.max(0.5, (Htarget - zc));
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; const H = Hof(m); if (H == null || H < Htarget) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  // supercrítica: WSE ∈ (zBed, zc); H decrece al subir WSE hacia el crítico
  let lo = zBed(pts) + 1e-4, hi = zc;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; const H = Hof(m); if (H == null || H > Htarget) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// Resuelve el WSE de la sección incógnita a partir de la conocida (paso estándar),
// con PÉRDIDAS LOCALIZADAS: contracción/expansión (Cc/Ce según el flujo acelere o
// desacelere, como HEC-RAS) + pérdida puntual de la sección (kLoc·V²/2g:
// obstrucciones, pilas, curvas, estructuras). Devuelve el estado + el desglose.
function paso(secInc, estConoc, dx, { Q, n, Cc, Ce, subcritico }) {
  const inef = secInc.inef;
  const zc = nivelCritico(secInc.pts, Q, inef);
  const kLoc = secInc.kLoc || 0;
  let WSE = estConoc.WSE, prev = NaN, desg = null;
  for (let it = 0; it < 40; it++) {
    const gi = estado(secInc.pts, WSE, Q, n, inef);
    const Sf = gi ? gi.Sf : estConoc.Sf;
    const vh = gi ? gi.vh : estConoc.vh;
    // vh aguas arriba/abajo del PAR (dn = aguas abajo del par)
    const vhUp = subcritico ? vh : estConoc.vh;
    const vhDn = subcritico ? estConoc.vh : vh;
    const hf = ((estConoc.Sf + Sf) / 2) * dx;
    const he = (vhDn > vhUp ? Cc : Ce) * Math.abs(vhDn - vhUp);   // contracción vs expansión
    const hloc = kLoc * vh;                                        // pérdida puntual local
    const Htarget = subcritico ? estConoc.H + hf + he + hloc : estConoc.H - hf - he - hloc;
    WSE = wseParaH(secInc.pts, Q, n, Htarget, zc, subcritico, inef);
    desg = { hf, he, hloc, tipo: vhDn > vhUp ? 'contracción' : 'expansión' };
    if (Math.abs(WSE - prev) < 1e-4) break;
    prev = WSE;
  }
  const s = estado(secInc.pts, WSE, Q, n, inef);
  return { ...s, perdidas: desg };
}

// Eje hidráulico por remanso sobre varias secciones.
//   secciones: [{ pts:[{s,z}], station (m, CRECIENTE aguas ABAJO), nombre? }]
//   opts: { Q, n=0.035, Ce=0.1, regimen:'auto'|'sub'|'super', wseAguasAbajo?, wseAguasArriba? }
export function ejeRemanso(secciones, opts = {}) {
  const { Q, n = 0.035 } = opts;
  const Cc = opts.Cc ?? 0.1;                 // coef. de contracción (flujo acelera)
  const Ce = opts.Ce ?? 0.3;                 // coef. de expansión (flujo desacelera)
  const secs = [...secciones].sort((a, b) => a.station - b.station);   // 0 = aguas arriba
  const N = secs.length;
  if (N < 2) throw new Error('El remanso necesita al menos 2 secciones.');

  // pendiente media del lecho (para condición de borde por profundidad normal y régimen)
  const L = secs[N - 1].station - secs[0].station || 1;
  const J = Math.max(1e-4, (zBed(secs[0].pts) - zBed(secs[N - 1].pts)) / L);

  // régimen
  let subcritico;
  if (opts.regimen === 'sub') subcritico = true;
  else if (opts.regimen === 'super') subcritico = false;
  else {
    const ctrl = secs[Math.floor(N / 2)];
    const zn = nivelNormal(ctrl.pts, { Q, n, J }).WSE;
    const zc = nivelCritico(ctrl.pts, Q);
    subcritico = zn > zc;                                 // pendiente suave → subcrítico
  }

  const perfil = new Array(N);
  const fill = (sec, s) => ({
    station: sec.station, nombre: sec.nombre, WSE: s.WSE, profMax: s.WSE - zBed(sec.pts),
    A: s.A, B: s.B, R: s.R, V: s.V, Fr: s.Fr, E: s.H, Sf: s.Sf, vh: s.vh,
    perdidas: s.perdidas || null, kLoc: sec.kLoc || 0,
    regimen: s.Fr >= 1 ? 'supercrítico' : 'subcrítico',
  });

  if (subcritico) {
    const WSE0 = opts.wseAguasAbajo ?? nivelNormal(secs[N - 1].pts, { Q, n, J }).WSE;
    let cur = estado(secs[N - 1].pts, WSE0, Q, n, secs[N - 1].inef);
    perfil[N - 1] = fill(secs[N - 1], cur);
    for (let i = N - 2; i >= 0; i--) {
      const dn = cur;                                   // estado aguas abajo (tailwater del puente)
      cur = paso(secs[i], cur, secs[i + 1].station - secs[i].station, { Q, n, Cc, Ce, subcritico: true });
      // PUENTE: si la sección lo lleva, la WSE aguas arriba = máx(energía, presión/vertedero).
      if (secs[i].puente) {
        const pr = puentePresion({ ...secs[i].puente, Zinvert: zBed(secs[i].pts), Q, TW: dn.WSE });
        if (pr.presuriza && pr.Eu > cur.WSE) { const e = estado(secs[i].pts, pr.Eu, Q, n, secs[i].inef); if (e) cur = e; cur._pr = pr; }
        perfil[i] = fill(secs[i], cur);
        perfil[i].puente = resumenPuente(secs[i].puente, cur._pr, cur.WSE);
      } else {
        perfil[i] = fill(secs[i], cur);
      }
    }
  } else {
    const WSE0 = opts.wseAguasArriba ?? nivelNormal(secs[0].pts, { Q, n, J }).WSE;
    let cur = estado(secs[0].pts, WSE0, Q, n);
    perfil[0] = fill(secs[0], cur);
    for (let i = 1; i < N; i++) {
      cur = paso(secs[i], cur, secs[i].station - secs[i - 1].station, { Q, n, Cc, Ce, subcritico: false });
      perfil[i] = fill(secs[i], cur);
    }
  }

  const puente = perfil.find((p) => p.puente)?.puente || null;
  return { perfil, subcritico, regimen: subcritico ? 'subcrítico' : 'supercrítico', Q, n, J, pendienteMedia: J, Cc, Ce, puente };
}

// Resumen del estado del puente para la fila del perfil (régimen, reparto, afección).
function resumenPuente(spec, pr, wse) {
  if (!pr || !pr.presuriza) return { regimen: 'libre', gobierna: 'energía', WSE: wse };
  return {
    regimen: pr.regimen, gobierna: 'presión/vertedero', WSE: pr.Eu,
    Qpresion: pr.Qpresion, Qvertedero: pr.Qvertedero, afeccion: pr.afeccion,
    sobreRasante: pr.sobreRasante, revancha: pr.revancha, Vvano: pr.Vvano,
  };
}

// Eje hidráulico de FLUJO MIXTO con RESALTO: corre el perfil supercrítico desde
// aguas arriba y el subcrítico desde aguas abajo, y los une donde se igualan las
// fuerzas específicas (el resalto). Es lo que hace el régimen "mixed flow" de
// HEC-RAS: útil en quebradas empinadas con control aguas abajo.
export function ejeMixto(secciones, opts = {}) {
  const { Q, n = 0.035 } = opts;
  const Cc = opts.Cc ?? 0.1, Ce = opts.Ce ?? 0.3;
  const secs = [...secciones].sort((a, b) => a.station - b.station);
  const N = secs.length;
  if (N < 2) throw new Error('El flujo mixto necesita al menos 2 secciones.');
  const L = secs[N - 1].station - secs[0].station || 1;
  const J = Math.max(1e-4, (zBed(secs[0].pts) - zBed(secs[N - 1].pts)) / L);

  // perfil SUPERCRÍTICO desde aguas arriba (control: profundidad normal SUPER si el
  // canal es empinado, si no el crítico; nunca justo el crítico, que es singular).
  const ynUp = nivelNormal(secs[0].pts, { Q, n, J }).WSE, ycUp = nivelCritico(secs[0].pts, Q);
  const sup = new Array(N);
  sup[0] = estado(secs[0].pts, opts.wseAguasArriba ?? Math.min(ynUp, ycUp - 1e-3), Q, n);
  for (let i = 1; i < N; i++) sup[i] = paso(secs[i], sup[i - 1], secs[i].station - secs[i - 1].station, { Q, n, Cc, Ce, subcritico: false });
  // perfil SUBCRÍTICO desde aguas abajo (control: WSE dado, o el mayor entre normal y crítico)
  const ynDn = nivelNormal(secs[N - 1].pts, { Q, n, J }).WSE, ycDn = nivelCritico(secs[N - 1].pts, Q);
  const sub = new Array(N);
  sub[N - 1] = estado(secs[N - 1].pts, opts.wseAguasAbajo ?? Math.max(ynDn, ycDn + 1e-3), Q, n);
  for (let i = N - 2; i >= 0; i--) sub[i] = paso(secs[i], sub[i + 1], secs[i + 1].station - secs[i].station, { Q, n, Cc, Ce, subcritico: true });

  const fill = (sec, s, rama) => ({
    station: sec.station, nombre: sec.nombre, WSE: s.WSE, profMax: s.WSE - zBed(sec.pts),
    A: s.A, B: s.B, R: s.R, V: s.V, Fr: s.Fr, E: s.H, Sf: s.Sf, rama,
    regimen: s.Fr >= 1 ? 'supercrítico' : 'subcrítico',
  });

  // combina por FUERZA ESPECÍFICA: super manda donde su M es mayor; si no, sub.
  const perfil = new Array(N);
  let jumpAt = -1;
  for (let i = 0; i < N; i++) {
    const Msup = sup[i] ? fuerzaEspecifica(secs[i].pts, sup[i].WSE, Q) : -Infinity;
    const Msub = sub[i] ? fuerzaEspecifica(secs[i].pts, sub[i].WSE, Q) : Infinity;
    const useSup = Msup >= Msub && sup[i];
    perfil[i] = fill(secs[i], useSup ? sup[i] : sub[i], useSup ? 'super' : 'sub');
    if (i > 0 && perfil[i - 1].rama === 'super' && !useSup && jumpAt < 0) jumpAt = i;
  }

  // detalle del resalto (entre jumpAt-1 super y jumpAt sub)
  let resalto = null;
  if (jumpAt > 0) {
    const a = sup[jumpAt - 1];                     // estado supercrítico justo antes del resalto
    const pts = secs[jumpAt - 1].pts, zb = zBed(pts);
    const y1 = a.WSE - zb;
    // tirante CONJUGADO (subcrítico) por igual fuerza específica → momento conservado
    const M1 = fuerzaEspecifica(pts, a.WSE, Q);
    const zc = nivelCritico(pts, Q);
    let lo = zc, hi = zc + Math.max(2, y1 * 6);
    for (let k = 0; k < 40 && fuerzaEspecifica(pts, hi, Q) < M1; k++) hi += 2;
    for (let i = 0; i < 70; i++) { const m = (lo + hi) / 2; if (fuerzaEspecifica(pts, m, Q) < M1) lo = m; else hi = m; }
    const WSE2 = (lo + hi) / 2, y2 = WSE2 - zb;
    const E1 = a.H, E2 = WSE2 + Math.pow(Q / propiedades(pts, WSE2).A, 2) / (2 * G);
    resalto = {
      station: (secs[jumpAt - 1].station + secs[jumpAt].station) / 2,
      entre: [secs[jumpAt - 1].nombre || secs[jumpAt - 1].station, secs[jumpAt].nombre || secs[jumpAt].station],
      y1: +y1.toFixed(3), y2: +y2.toFixed(3), Fr1: +a.Fr.toFixed(2),
      altura: +(y2 - y1).toFixed(3), perdidaEnergia: +Math.max(0, E1 - E2).toFixed(3),
    };
  }
  return { perfil, jumpAt, resalto, mixto: true, Q, n, J, pendienteMedia: J, Cc, Ce };
}
