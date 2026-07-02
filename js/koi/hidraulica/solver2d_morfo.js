// ─────────────────────────────────────────────────────────────────────────────
// solver2d_morfo.js — MORFODINÁMICO 2D: Saint-Venant (solver2d_momentum.js) +
// Exner (evolución del lecho) acoplados, por volúmenes finitos (Tier4-Fase4).
// A diferencia de morfo1d.js (1D quasi-unsteady, por secciones), esto resuelve
// la cota de fondo z(x,y,t) celda a celda, con la VELOCIDAD REAL 2D (no el
// reparto 1D) — captura erosión/depósito localizados (curvas, aguas abajo de
// pilas, embudos de contracción) que un modelo 1D no puede ver.
//
//   ∂zb/∂t = -1/(1-p) · ∇·qs         (Exner)
//   qs = capacidad de arrastre de fondo (Meyer-Peter & Müller, sedimentos.js),
//        magnitud por celda (usa h,V del flujo y la pendiente de fricción de
//        Manning como pendiente de energía local) en la dirección de V; se
//        advecta a cada arista por UPWIND según el sentido del flujo de agua
//        (mismo criterio que popularizan los códigos 2D operativos: capacidad
//        de transporte "congelada" en la celda de origen, sin resolver un
//        Riemann de sedimento aparte).
//
// DOS modos de acople (a pedido, ambos disponibles):
//   'desacoplado' (por defecto): el lecho se actualiza cada `nPasosLecho` pasos
//     de flujo (asume que el fondo cambia mucho más lento que el agua — válido
//     en crecidas normales; es el estándar operativo, HEC-RAS/la mayoría de
//     códigos). El Δt efectivo de Exner es la SUMA de los dt de flujo desde la
//     última actualización (capacidad de transporte "congelada" en ese tramo).
//   'acoplado': el lecho se actualiza EN CADA paso junto con el flujo — más
//     riguroso pero mucho más lento; pensado para dam-break sobre lecho móvil
//     (donde el fondo puede cambiar tan rápido como el agua).
//
// Sin acorazamiento (a diferencia de degradacion.js, que sí lo modela para el
// largo plazo) ni transporte prescrito en los bordes (paredes/entrada/salida no
// aportan sedimento) — simplificaciones documentadas, coherentes con el resto
// del sistema (perfilTransporte 1D tampoco acoraza). Sin dependencias externas.
// ─────────────────────────────────────────────────────────────────────────────
import { prepararMallaFVM, prepararContextoFlujo, pasoFlujo, celdaANodo } from './solver2d_momentum.js';
import { meyerPeterMuller } from '../hidro/sedimentos.js';

// Aplica un paso de Exner sobre `zc` (mutado in-place) usando el estado de flujo
// actual y el Δt EFECTIVO acumulado desde la última actualización del lecho.
function aplicarExner(F, zc, estado, ctx, dtAcum, sedOpts) {
  const { D50mm = 1, s = 2.65, thetaC = 0.047, poros = 0.4, hmin = 0.01, dzMaxFrac = 0.3 } = sedOpts;
  const D = D50mm / 1000;
  const { nc, area, edges } = F;
  const { h, qx, qy } = estado;
  const { nManC } = ctx;

  // capacidad de arrastre por celda: magnitud (MPM, m³/s/m) en la dirección de V
  const qsx = new Float64Array(nc), qsy = new Float64Array(nc);
  for (let c = 0; c < nc; c++) {
    if (h[c] <= hmin) continue;
    const V = Math.hypot(qx[c], qy[c]) / h[c];
    if (V <= 1e-6) continue;
    const n = nManC[c];
    const J = (n * n * V * V) / Math.pow(h[c], 4 / 3);          // pendiente de fricción local (Manning)
    const r = meyerPeterMuller(h[c], J, D, { s, thetaC });
    if (!r.arrastra) continue;
    const ux = (qx[c] / h[c]) / V, uy = (qy[c] / h[c]) / V;      // dirección unitaria del flujo
    qsx[c] = r.qsf * ux; qsy[c] = r.qsf * uy;
  }

  // divergencia por arista (upwind según el sentido del AGUA, no del sedimento):
  // el volumen sólido que cruza viene de la celda de la que SALE el agua.
  const dVol = new Float64Array(nc);
  for (const e of edges) {
    const c0 = e.c0, c1 = e.c1;
    const h0 = h[c0], u0 = h0 > hmin ? qx[c0] / h0 : 0, v0 = h0 > hmin ? qy[c0] / h0 : 0;
    const un0 = u0 * e.nx + v0 * e.ny;                            // velocidad normal saliente de c0
    let qsxE = 0, qsyE = 0;
    if (un0 >= 0) { qsxE = qsx[c0]; qsyE = qsy[c0]; }
    else if (c1 >= 0) { qsxE = qsx[c1]; qsyE = qsy[c1]; }
    // borde (pared/entrada/salida) con flujo entrante: sin aporte de sedimento (simplificación, ver cabecera)
    const qsn = qsxE * e.nx + qsyE * e.ny;                        // caudal sólido normal SALIENTE de c0 [m³/s/m]
    const vol = qsn * e.len * dtAcum;                             // volumen sin poros [m³] que cruza en dtAcum
    dVol[c0] -= vol;
    if (c1 >= 0) dVol[c1] += vol;
  }

  // Limitador de cambio de lecho por actualización (salvaguarda de estabilidad,
  // práctica estándar en códigos operativos): sin él, un dtAcum grande (modo
  // 'desacoplado' con nPasosLecho alto) puede producir un Δz local tan grande que
  // crea un "acantilado" de fondo de un paso al otro → desestabiliza el flujo del
  // paso siguiente → más erosión artificial → retroalimentación positiva/explosión
  // numérica (visto en pruebas: hmax pasó de ~10 m a ~32 m con nPasosLecho=10 sin
  // limitador). Se acota |Δz| a una fracción del calado local h (dzMaxFrac, 0.3
  // por defecto) — el volumen que excede el límite se recorta (no se conserva
  // exactamente en ese paso; compensa robustez por exactitud, aceptable para uso
  // de ingeniería — igual que el resto de los solvers de koi frente a inestabilidad).
  let dzMax = 0;
  for (let c = 0; c < nc; c++) {
    let dz = dVol[c] / ((area[c] || 1e-9) * (1 - poros));         // Exner: Δzb = ΔVol / (Área·(1−p))
    const tope = dzMaxFrac * Math.max(h[c], hmin);
    if (dz > tope) dz = tope; else if (dz < -tope) dz = -tope;
    zc[c] += dz;
    if (Math.abs(dz) > dzMax) dzMax = Math.abs(dz);
  }
  return dzMax;
}

// Resuelve el morfodinámico 2D (flujo + lecho) hasta tSim.
//   mesh, opts (Q/entrada/salida/stageSalida/tSim/CFL/hmin/nMan/estadoInicial/
//   dtGuardar/onProgress): idénticos a resolverMomentum2D — MISMO flujo, con
//   sedimento acoplado. Extra:
//     D50mm (1mm def), s (2.65), thetaC (0.047 Shields), poros (0.4),
//     acople: 'desacoplado' (def) | 'acoplado', nPasosLecho (3 def, solo aplica
//     a 'desacoplado' — cada cuántos pasos de flujo se actualiza el lecho).
//     dzMaxFrac (0.3 def, límite de |Δz| por actualización como fracción de h).
//
// Compromiso N vs precisión (medido, canal de prueba): con el limitador de
// estabilidad activo (dzMaxFrac), un nPasosLecho más alto es más rápido pero el
// recorte de estabilidad se activa más seguido y SUBESTIMA el transporte total
// frente al acoplado (N=1≡acoplado exacto; N=3 ~30% menos volumen erosionado;
// N=10 ~60% menos). Si `dzMax` del resultado queda pegado al tope muchas veces
// (usar valores chicos de N para confirmar), bajar nPasosLecho.
export function resolverMorfo2D(mesh, opts = {}) {
  const {
    tSim = 3600, maxPasos = 200000, dtGuardar = 0, onProgress,
    D50mm = 1, s = 2.65, thetaC = 0.047, poros = 0.4,
    acople = 'desacoplado', nPasosLecho = 3,
  } = opts;
  const sedOpts = { D50mm, s, thetaC, poros };
  const F = prepararMallaFVM(mesh);
  const { nc, area } = F;
  const zc = F.zc.slice();                    // cota de fondo EVOLUTIVA (copia — F.zc queda intacto/original)
  const z0 = F.zc.slice();                     // referencia inicial (para reportar Δz acumulado)
  const ctx = prepararContextoFlujo(F, opts);
  const hmin = ctx.hmin;
  const acoplado = acople === 'acoplado';

  const estado = {
    h: opts.estadoInicial?.h ? Float64Array.from(opts.estadoInicial.h) : new Float64Array(nc),
    qx: opts.estadoInicial?.qx ? Float64Array.from(opts.estadoInicial.qx) : new Float64Array(nc),
    qy: opts.estadoInicial?.qy ? Float64Array.from(opts.estadoInicial.qy) : new Float64Array(nc),
  };

  const frames = [];
  let t = 0, paso = 0, proxGuardado = dtGuardar > 0 ? 0 : Infinity;
  let dtAcum = 0, dzMax = 0;
  for (; paso < maxPasos && t < tSim; paso++) {
    const dt = pasoFlujo(estado, ctx, zc, tSim - t, t);
    if (dt <= 0) break;
    t += dt; dtAcum += dt;

    const tocaActualizarLecho = acoplado || ((paso + 1) % nPasosLecho === 0) || t >= tSim;
    if (tocaActualizarLecho && dtAcum > 0) {
      const dz = aplicarExner(F, zc, estado, ctx, dtAcum, sedOpts);
      if (dz > dzMax) dzMax = dz;
      dtAcum = 0;
    }

    if (t >= proxGuardado) { frames.push({ t, h: estado.h.slice(), z: zc.slice() }); proxGuardado += dtGuardar; }
    if (onProgress && paso % 20 === 0) onProgress(t, tSim, paso);
  }
  if (dtGuardar > 0 && (!frames.length || frames[frames.length - 1].t < t - 1e-9)) frames.push({ t, h: estado.h.slice(), z: zc.slice() });

  const { h, qx, qy } = estado;
  const V = new Float64Array(nc), dz = new Float64Array(nc);
  let hmax = 0, Vmax = 0, nMoj = 0, masaTotal = 0, volErosion = 0, volDeposito = 0;
  for (let c = 0; c < nc; c++) {
    if (h[c] > hmin) { nMoj++; V[c] = Math.hypot(qx[c], qy[c]) / h[c]; }
    if (h[c] > hmax) hmax = h[c];
    if (V[c] > Vmax) Vmax = V[c];
    masaTotal += h[c] * area[c];
    dz[c] = zc[c] - z0[c];
    if (dz[c] < 0) volErosion += -dz[c] * area[c]; else volDeposito += dz[c] * area[c];
  }
  return {
    mallaF: F, h, qx, qy, V, zc, z0, dz, pasos: paso, t, hmax, Vmax, nMojados: nMoj, nCeldas: nc,
    masaTotal, volErosion, volDeposito, dzMax, acople, frames,
  };
}

export { celdaANodo };
