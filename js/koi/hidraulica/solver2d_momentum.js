// ─────────────────────────────────────────────────────────────────────────────
// solver2d_momentum.js — flujo 2D por AGUAS SOMERAS COMPLETAS (momentum, no solo
// difusión) sobre la malla triangular (koi-flow, Fase 5C / Tier4-Fase2). A
// diferencia de solver2d.js (onda difusiva, implícita, sin inercia — válida para
// flujo lento/subcrítico), este resuelve las ecuaciones de Saint-Venant 2D
// completas por VOLÚMENES FINITOS (celda = triángulo), captura resaltos
// hidráulicos, flujo supercrítico y rotura de presa (dam-break) — el régimen que
// la difusiva NO puede representar.
//
//   ∂U/∂t + ∇·F(U) = S(U)      U = (h, hu, hv)ᵀ
//   F(U)·n = (hu·n, (hu·n)u + ½gh²n)ᵀ   (flujo normal a cada arista, rotado)
//   S = fricción (Manning, semi-implícita) + pendiente de fondo (vía
//       reconstrucción hidrostática, bien-balanceada: Audusse et al. 2004,
//       "A fast and stable well-balanced scheme with hydrostatic reconstruction")
//
// Esquema: Godunov de 1er orden, Riemann HLL (Toro 2001, con velocidades de onda
// para lecho seco), euler explícito con paso CFL-adaptativo. Sin dependencias
// externas — todo in-house, mismo espíritu que solver2d.js.
// ─────────────────────────────────────────────────────────────────────────────
const G = 9.81;

// ── Preprocesa la malla: geometría de celdas (triángulos) y aristas (internas +
// borde), normales salientes robustas ante el sentido de giro de cada triángulo. ─
export function prepararMallaFVM(mesh) {
  const nodes = mesh.nodes, tris = mesh.tris, nc = tris.length;
  const cx = new Float64Array(nc), cy = new Float64Array(nc), area = new Float64Array(nc), zc = new Float64Array(nc);
  const perim = new Float64Array(nc);
  for (let c = 0; c < nc; c++) {
    const [i, j, k] = tris[c];
    const A = nodes[i], B = nodes[j], C = nodes[k];
    const det = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
    area[c] = Math.abs(det) / 2;
    cx[c] = (A.x + B.x + C.x) / 3; cy[c] = (A.y + B.y + C.y) / 3;
    zc[c] = (A.z + B.z + C.z) / 3;
  }

  // aristas: clave "min_max" de índices de NODO → hasta 2 triángulos que la comparten
  const edgeMap = new Map();
  const edgeKey = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
  for (let c = 0; c < nc; c++) {
    const [i, j, k] = tris[c];
    for (const [a, b] of [[i, j], [j, k], [k, i]]) {
      const key = edgeKey(a, b);
      let e = edgeMap.get(key);
      if (!e) { e = { a, b, cells: [] }; edgeMap.set(key, e); }
      e.cells.push(c);
    }
  }

  const edges = []; // {a,b, c0,c1(-1 si borde), nx,ny, len}
  for (const e of edgeMap.values()) {
    const A = nodes[e.a], B = nodes[e.b];
    const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    // normal candidata perpendicular a la arista; se orienta "saliendo" de c0
    let nx = dy / len, ny = -dx / len;
    const c0 = e.cells[0], c1 = e.cells.length > 1 ? e.cells[1] : -1;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const toCentroid = (mx - cx[c0]) * nx + (my - cy[c0]) * ny;
    if (toCentroid < 0) { nx = -nx; ny = -ny; } // debe apuntar AFUERA de c0
    edges.push({ a: e.a, b: e.b, c0, c1, nx, ny, len });
    perim[c0] += len; if (c1 >= 0) perim[c1] += len;
  }

  return { nodes, tris, nc, cx, cy, area, zc, perim, edges };
}

// h,V (celda) → valor por NODO (promedio ponderado por área de las celdas incidentes).
// Deja compatible el resultado con map.showInundacion (que espera arreglos por nodo).
export function celdaANodo(mallaF, valCelda) {
  const { nodes, tris, area } = mallaF, n = nodes.length;
  const num = new Float64Array(n), den = new Float64Array(n);
  for (let c = 0; c < tris.length; c++) {
    const w = area[c] || 1e-9;
    for (const i of tris[c]) { num[i] += valCelda[c] * w; den[i] += w; }
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = den[i] > 0 ? num[i] / den[i] : 0;
  return out;
}

// Riemann HLL 1D en la dirección normal (Toro 2001), con velocidades de onda para
// lecho seco. hL,uL,hR,uR ya en el sistema LOCAL (normal). Devuelve {Fh, Fq} (flujo
// de masa y de cantidad de movimiento normal) por unidad de ancho.
function hllFlux(hL, uL, hR, uR, hmin) {
  const secoL = hL <= hmin, secoR = hR <= hmin;
  if (secoL && secoR) return { Fh: 0, Fq: 0 };
  const cL = Math.sqrt(G * Math.max(hL, 0)), cR = Math.sqrt(G * Math.max(hR, 0));
  let SL, SR;
  if (secoL) { SL = uR - 2 * cR; SR = uR + cR; }          // Toro: seco a la izquierda
  else if (secoR) { SL = uL - cL; SR = uL + 2 * cL; }     // Toro: seco a la derecha
  else { SL = Math.min(uL - cL, uR - cR); SR = Math.max(uL + cL, uR + cR); }
  const FhL = hL * uL, FqL = hL * uL * uL + 0.5 * G * hL * hL;
  const FhR = hR * uR, FqR = hR * uR * uR + 0.5 * G * hR * hR;
  if (SL >= 0) return { Fh: FhL, Fq: FqL };
  if (SR <= 0) return { Fh: FhR, Fq: FqR };
  const inv = 1 / (SR - SL);
  return {
    Fh: (SR * FhL - SL * FhR + SL * SR * (hR - hL)) * inv,
    Fq: (SR * FqL - SL * FqR + SL * SR * (hR * uR - hL * uL)) * inv,
  };
}

// ── Contexto de una corrida (aristas de entrada/salida, caudal unitario, Manning
// por celda) — se arma UNA vez y lo reusan pasoFlujo/resolverMomentum2D/
// resolverMorfo2D (Fase 4: el morfodinámico llama a pasoFlujo repetidamente con
// una cota de fondo EVOLUTIVA, sin repetir esta preparación cada paso). ─────────
export function prepararContextoFlujo(F, opts = {}) {
  const { Q = 0, entrada = [], salida = [], stageSalida, CFL = 0.4, hmin = 0.01, nMan = 0.04, hidrograma = null, reologia = null } = opts;
  const { nc, edges, tris, nodes } = F;
  const nManC = new Float64Array(nc);
  for (let c = 0; c < nc; c++) { const [i, j, k] = tris[c]; nManC[c] = ((nodes[i].n || nMan) + (nodes[j].n || nMan) + (nodes[k].n || nMan)) / 3; }

  // aristas de entrada/salida: ambos extremos marcados en entrada[]/salida[] y arista de borde (c1<0)
  const esEntradaNodo = new Uint8Array(nodes.length); for (const i of entrada) esEntradaNodo[i] = 1;
  const esSalidaNodo = new Uint8Array(nodes.length); for (const i of salida) esSalidaNodo[i] = 1;
  const edgesEntrada = [];
  let longEntrada = 0;
  for (const e of edges) {
    if (e.c1 >= 0) continue;
    if (esEntradaNodo[e.a] && esEntradaNodo[e.b]) { edgesEntrada.push(e); longEntrada += e.len; }
    else if (esSalidaNodo[e.a] && esSalidaNodo[e.b]) e.esSalida = true;
  }
  const qEntrada = longEntrada > 0 ? Q / longEntrada : 0;   // caudal unitario [m²/s] repartido por longitud

  // caudal VARIABLE en el tiempo (hidrograma [{t,Q}]): Qen(t) interpolado lineal —
  // habilita rutear una crecida/onda de rotura con el solver de momentum (antes solo Q fijo).
  let Qen = null;
  const hg = hidrograma && hidrograma.length ? hidrograma : null;
  if (hg && longEntrada > 0) {
    Qen = (t) => {
      if (t <= hg[0].t) return hg[0].Q / longEntrada;
      if (t >= hg[hg.length - 1].t) return hg[hg.length - 1].Q / longEntrada;
      for (let i = 1; i < hg.length; i++) if (t <= hg[i].t) { const a = hg[i - 1], b = hg[i], fr = (t - a.t) / ((b.t - a.t) || 1); return (a.Q + fr * (b.Q - a.Q)) / longEntrada; }
      return hg[hg.length - 1].Q / longEntrada;
    };
  }

  // REOLOGÍA NO-NEWTONIANA (relaves/barros/detritos) — modelo cuadrático de O'Brien
  // (el de FLO-2D): Sf = τy/(γm·h) + K·μ·V/(8·γm·h²) + n²·V²/h^{4/3}.
  //   reologia = { tauY [Pa], mu [Pa·s], Cv [–], K (resistencia laminar, 24 def) }
  //   γm = ρm·g con ρm = ρw(1−Cv) + ρs·Cv (mezcla). Sin reologia → agua clara (Manning solo).
  let reo = null;
  if (reologia && (reologia.tauY > 0 || reologia.mu > 0)) {
    const Cv = reologia.Cv ?? 0.3;
    const rhoM = 1000 * (1 - Cv) + 2650 * Cv;
    reo = {
      tauY: reologia.tauY || 0, rhoM,
      Kmu8: ((reologia.K ?? 24) * (reologia.mu || 0)) / (8 * rhoM),   // decel viscosa = Kmu8·q/h²
    };
  }

  return { F, edgesEntrada, qEntrada, nManC, hmin, CFL, stageSalida, Qen, reo };
}

// Un paso explícito de Saint-Venant (flujo + fricción), CFL-adaptativo — HLL +
// reconstrucción hidrostática bien-balanceada (Audusse 2004). Muta `estado`
// {h,qx,qy} in-place. `zc` es la cota de fondo POR CELDA a usar en este paso —
// separado de F.zc para que el morfodinámico (Fase 4) pueda pasar un fondo que
// evoluciona, sin que este paso de flujo lo sepa/dependa de ello. Devuelve dt.
export function pasoFlujo(estado, ctx, zc, tSimRestante = Infinity, tActual = 0) {
  const { F, edgesEntrada, nManC, hmin, CFL, stageSalida, Qen, reo } = ctx;
  const qEntrada = Qen ? Qen(tActual) : ctx.qEntrada;   // caudal unitario del instante (hidrograma) o fijo
  const { nc, area, edges } = F;
  const { h, qx, qy } = estado;

  // paso de tiempo CFL: dt = CFL * (2A/P) / (|u|+c) por celda, mínimo global
  let dt = Infinity;
  for (let c = 0; c < nc; c++) {
    if (h[c] <= hmin) continue;
    const u = qx[c] / h[c], v = qy[c] / h[c];
    const speed = Math.hypot(u, v) + Math.sqrt(G * h[c]);
    if (speed <= 0) continue;
    const Lc = (2 * area[c]) / (F.perim[c] || 1);
    const dtc = CFL * Lc / speed;
    if (dtc < dt) dt = dtc;
  }
  if (!isFinite(dt)) dt = 1;               // todo seco: paso nominal, no cambia nada
  if (dt > tSimRestante) dt = tSimRestante;
  if (dt <= 0) return 0;

  const dh = new Float64Array(nc), dqx = new Float64Array(nc), dqy = new Float64Array(nc);

  // flujos por arista (HLL + reconstrucción hidrostática bien-balanceada, Audusse 2004).
  // Borde: se arma un estado "fantasma" (h1,z1,un1,ut1) según el tipo de arista y se corre
  // el MISMO cálculo de flujo que una arista interna — evita duplicar la lógica por tipo.
  //   pared (default, reflectante): espejo del propio estado con velocidad normal invertida
  //     → Fh=0 exacto (sin masa cruzando la pared), Fq incluye la presión hidrostática y,
  //     si hay velocidad de impacto, el empuje dinámico adicional (correcto para HLL).
  //   salida CON stageSalida: nivel aguas abajo fijo, velocidad normal continua.
  //   salida SIN stageSalida (libre): estado fantasma = estado propio (transmisiva/Neumann),
  //     deja salir el flujo tal cual sin reflejarlo — si no, el agua nunca podría salir.
  for (const e of edges) {
    const c0 = e.c0, c1 = e.c1;
    const h0 = h[c0], z0 = zc[c0];
    const u0 = h0 > hmin ? qx[c0] / h0 : 0, v0 = h0 > hmin ? qy[c0] / h0 : 0;
    const un0 = u0 * e.nx + v0 * e.ny, ut0 = -u0 * e.ny + v0 * e.nx;
    let h1, z1, un1, ut1;
    if (c1 >= 0) {
      const h1v = h[c1], u1 = h1v > hmin ? qx[c1] / h1v : 0, v1 = h1v > hmin ? qy[c1] / h1v : 0;
      h1 = h1v; z1 = zc[c1]; un1 = u1 * e.nx + v1 * e.ny; ut1 = -u1 * e.ny + v1 * e.nx;
    } else if (e.esSalida && isFinite(stageSalida)) {
      h1 = Math.max(0, stageSalida - z0); z1 = z0; un1 = un0; ut1 = ut0;
    } else if (e.esSalida) {
      h1 = h0; z1 = z0; un1 = un0; ut1 = ut0;                 // libre/transmisiva
    } else {
      h1 = h0; z1 = z0; un1 = -un0; ut1 = ut0;                // pared reflectante
    }

    // reconstrucción hidrostática (Audusse 2004): cota de interfaz = máx bordes
    const zEdge = Math.max(z0, z1);
    const h0r = Math.max(0, h0 + z0 - zEdge), h1r = Math.max(0, h1 + z1 - zEdge);

    const { Fh, Fq } = hllFlux(h0r, un0, h1r, un1, hmin);
    const Ftan = Fh >= 0 ? Fh * ut0 : Fh * ut1;   // momento tangencial: upwind por el signo del flujo de masa

    // flujo global (x,y) rotado de vuelta: normal*(nx,ny) + tangencial*(-ny,nx)
    const Fx = Fq * e.nx - Ftan * e.ny, Fy = Fq * e.ny + Ftan * e.nx;

    const contrib = e.len;
    dh[c0] -= Fh * contrib; dqx[c0] -= Fx * contrib; dqy[c0] -= Fy * contrib;
    // corrección hidrostática del término de fondo en c0 (bien-balanceado, Audusse 2004):
    // net = -Fq_iface + srcN0 debe ser exactamente -½g·h0² (la propia presión de c0)
    // ⟹ srcN0 = Fq_iface - ½g·h0² = ½g·h0r² - ½g·h0²  (h0r² − h0², no al revés).
    const srcN0 = 0.5 * G * (h0r * h0r - h0 * h0);
    dqx[c0] += srcN0 * e.nx * contrib; dqy[c0] += srcN0 * e.ny * contrib;

    if (c1 >= 0) {
      dh[c1] += Fh * contrib; dqx[c1] += Fx * contrib; dqy[c1] += Fy * contrib;
      const srcN1 = 0.5 * G * (h1r * h1r - h1 * h1);
      dqx[c1] -= srcN1 * e.nx * contrib; dqy[c1] -= srcN1 * e.ny * contrib;
    }
  }

  // entrada: caudal PRESCRITO de forma exacta (no vía Riemann/estado fantasma — más
  // robusto al llenar una celda seca) → masa inyectada = Q·dt exacta, sin importar el
  // estado del arranque. El momento asociado es el que trae esa masa entrante.
  for (const e of edgesEntrada) {
    const c0 = e.c0;
    const h0m = Math.max(h[c0], hmin);
    const Fh = -qEntrada;                          // masa ENTRANDO (saliente negativo)
    const unIn = Fh / h0m;                          // velocidad normal asociada (negativa = hacia adentro)
    const u0 = h[c0] > hmin ? qx[c0] / h[c0] : 0, v0 = h[c0] > hmin ? qy[c0] / h[c0] : 0;
    const ut0 = -u0 * e.ny + v0 * e.nx;              // tangencial se conserva (continuidad simple)
    const Fq = Fh * unIn;
    const Fx = Fq * e.nx - Fh * ut0 * e.ny, Fy = Fq * e.ny + Fh * ut0 * e.nx;
    dh[c0] -= Fh * e.len; dqx[c0] -= Fx * e.len; dqy[c0] -= Fy * e.len;
  }

  // actualización explícita + fricción semi-implícita (Manning; con reología se
  // suman los términos de O'Brien: fluencia τy —explícita con parada del flujo,
  // que ES la física del esfuerzo de fluencia— y viscoso —lineal en q, va al
  // semi-implícito junto al turbulento—).
  for (let c = 0; c < nc; c++) {
    const invA = dt / (area[c] || 1e-9);
    let hN = h[c] + dh[c] * invA;
    let qxN = qx[c] + dqx[c] * invA;
    let qyN = qy[c] + dqy[c] * invA;
    if (hN < hmin) { hN = Math.max(hN, 0); qxN = 0; qyN = 0; }
    else {
      let qMag = Math.hypot(qxN, qyN);
      if (reo && qMag > 0) {
        // fluencia: desaceleración constante τy/ρm opuesta al movimiento; si en el
        // paso consumiría todo el momento, el flujo SE DETIENE (no invierte).
        const dq = dt * (reo.tauY / reo.rhoM);
        const sc = Math.max(0, 1 - dq / qMag);
        qxN *= sc; qyN *= sc; qMag *= sc;
      }
      const cfT = G * nManC[c] * nManC[c] * qMag / Math.pow(hN, 7 / 3);
      const cfV = reo ? reo.Kmu8 / (hN * hN) : 0;
      const fric = 1 / (1 + dt * (cfT + cfV));
      qxN *= fric; qyN *= fric;
    }
    h[c] = hN; qx[c] = qxN; qy[c] = qyN;
  }

  return dt;
}

// Resuelve el flujo 2D por momentum (Saint-Venant / aguas someras) hasta tSim.
//   mesh: {nodes:[{x,y,z,n}], tris}. opts:
//     Q (caudal de entrada m³/s), entrada:[idxNodo], salida:[idxNodo],
//     stageSalida (WSE fija en salida; si no, salida libre/supercrítica),
//     tSim (tiempo a simular, s), CFL (0.4 def), hmin, nMan (fallback Manning),
//     h0/estadoInicial, dtGuardar (s entre frames guardados — TIEMPO, no pasos: el
//     paso es CFL-adaptativo así que guardar "cada N pasos" daría frames despareja-
//     dos en el tiempo), onProgress(t,tSim,paso).
export function resolverMomentum2D(mesh, opts = {}) {
  const { tSim = 3600, maxPasos = 200000, dtGuardar = 0, onProgress } = opts;
  const F = prepararMallaFVM(mesh);
  const { nc, area, zc } = F;
  const ctx = prepararContextoFlujo(F, opts);
  const hmin = ctx.hmin;

  // estado inicial: seco (h=0), salvo estadoInicial provisto (continuar una corrida previa)
  const estado = {
    h: opts.estadoInicial?.h ? Float64Array.from(opts.estadoInicial.h) : new Float64Array(nc),
    qx: opts.estadoInicial?.qx ? Float64Array.from(opts.estadoInicial.qx) : new Float64Array(nc),
    qy: opts.estadoInicial?.qy ? Float64Array.from(opts.estadoInicial.qy) : new Float64Array(nc),
  };

  // tiempo de ARRIBO de la onda por celda (mapas de evacuación / rotura de presa):
  // primer instante en que el calado supera hArr (5 cm def). −1 = nunca llegó.
  const hArr = opts.hArr ?? 0.05;
  const tArr = new Float64Array(nc).fill(-1);

  const frames = [];
  let t = 0, paso = 0, proxGuardado = dtGuardar > 0 ? 0 : Infinity;
  for (; paso < maxPasos && t < tSim; paso++) {
    const dt = pasoFlujo(estado, ctx, zc, tSim - t, t);
    if (dt <= 0) break;
    t += dt;
    for (let c = 0; c < nc; c++) if (tArr[c] < 0 && estado.h[c] > hArr) tArr[c] = t;
    if (t >= proxGuardado) { frames.push({ t, h: estado.h.slice() }); proxGuardado += dtGuardar; }
    if (onProgress && paso % 20 === 0) onProgress(t, tSim, paso);
  }
  // frame final (el estado real con el que termina la corrida, para que la
  // animación no se quede corta si el último guardado no cayó justo en tSim).
  if (dtGuardar > 0 && (!frames.length || frames[frames.length - 1].t < t - 1e-9)) frames.push({ t, h: estado.h.slice() });

  const { h, qx, qy } = estado;
  const V = new Float64Array(nc);
  let hmax = 0, Vmax = 0, nMoj = 0, masaTotal = 0, tArrMin = Infinity;
  for (let c = 0; c < nc; c++) {
    if (h[c] > hmin) { nMoj++; V[c] = Math.hypot(qx[c], qy[c]) / h[c]; }
    if (h[c] > hmax) hmax = h[c];
    if (V[c] > Vmax) Vmax = V[c];
    if (tArr[c] >= 0 && tArr[c] < tArrMin) tArrMin = tArr[c];
    masaTotal += h[c] * area[c];
  }
  return { mallaF: F, h, qx, qy, V, tArr, tArrMin: isFinite(tArrMin) ? tArrMin : null, pasos: paso, t, hmax, Vmax, nMojados: nMoj, nCeldas: nc, masaTotal, frames };
}
