// ─────────────────────────────────────────────────────────────────────────────
// embalse.js — laminación de crecidas en un embalse (koi-flow). Reservoir routing
// tipo HEC-HMS: curva cota–área–volumen desde el DEM dentro del polígono del vaso,
// y ruteo por PISCINA NIVELADA (método de la indicación del almacenamiento / Puls
// modificado) de un hidrograma de entrada, con vertedero de descarga.
//   S2/Δt + O2/2 = (I1+I2)/2 + S1/Δt − O1/2 ;  O = Cd·L·h^{3/2}  (vertedero libre)
// ─────────────────────────────────────────────────────────────────────────────

function pip(lon, lat, poly) {
  let d = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) d = !d;
  }
  return d;
}

// Curva cota–área–volumen del vaso: celdas del DEM dentro del polígono.
export function curvaEmbalse(grid, poly, { nCotas = 24 } = {}) {
  const { nx, ny } = grid, b = grid.bbox;
  const mLon = 111320 * Math.cos((b.north + b.south) / 2 * Math.PI / 180), mLat = 110540;
  const cellA = ((b.east - b.west) / (nx - 1) * mLon) * ((b.north - b.south) / (ny - 1) * mLat);
  const zs = []; let zmin = Infinity, zmax = -Infinity;
  for (let r = 0; r < ny; r++) {
    const lat = b.north - r / (ny - 1) * (b.north - b.south);
    for (let c = 0; c < nx; c++) {
      const lon = b.west + c / (nx - 1) * (b.east - b.west);
      if (pip(lon, lat, poly)) { const z = grid.data[r * nx + c]; zs.push(z); if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    }
  }
  if (zs.length < 3) throw new Error('El polígono del embalse no cae sobre el DEM (o es muy chico).');
  const curva = [];
  for (let i = 0; i < nCotas; i++) {
    const cota = zmin + (i / (nCotas - 1)) * (zmax - zmin);
    let a = 0, v = 0; for (const z of zs) if (cota > z) { a += cellA; v += (cota - z) * cellA; }
    curva.push({ cota: +cota.toFixed(2), area_m2: +a.toFixed(0), vol_m3: +v.toFixed(0) });
  }
  return { curva, zmin: +zmin.toFixed(2), zmax: +zmax.toFixed(2), cellA, nCeldas: zs.length };
}

// Ruteo por piscina nivelada (Puls). inflow=[{t[s],Q[m³/s]}].
//   opts: { cotaVert, largoVert=10, Cd=1.7, cotaIni=cotaVert, dt=300 }
export function ruteoPuls(inflow, curva, opts = {}) {
  const { cotaVert, largoVert = 10, Cd = 1.7, dt = 300 } = opts;
  const cotaIni = opts.cotaIni ?? cotaVert;
  const interp = (arr, key, val, out) => {
    if (val <= arr[0][key]) return arr[0][out];
    for (let i = 1; i < arr.length; i++) if (val <= arr[i][key]) { const a = arr[i - 1], b = arr[i], f = (val - a[key]) / ((b[key] - a[key]) || 1); return a[out] + f * (b[out] - a[out]); }
    return arr[arr.length - 1][out];
  };
  const volDeCota = (c) => interp(curva, 'cota', c, 'vol_m3');
  const O = (c) => { const h = Math.max(0, c - cotaVert); return Cd * largoVert * Math.pow(h, 1.5); };
  const Qin = (t) => {
    if (t <= inflow[0].t) return inflow[0].Q;
    if (t >= inflow[inflow.length - 1].t) return inflow[inflow.length - 1].Q;
    for (let i = 1; i < inflow.length; i++) if (t <= inflow[i].t) { const a = inflow[i - 1], b = inflow[i], f = (t - a.t) / ((b.t - a.t) || 1); return a.Q + f * (b.Q - a.Q); }
    return 0;
  };
  let cota = cotaIni, V = volDeCota(cota), Oo = O(cota);
  const tEnd = inflow[inflow.length - 1].t * 1.5;   // deja vaciar la punta
  const out = [{ t: 0, Qin: Qin(0), Qout: Oo, cota, vol: V }];
  let QinPico = 0, QoutPico = Oo, cotaMax = cota;
  const cHi = curva[curva.length - 1].cota + 8;
  for (let t = 0; t < tEnd; t += dt) {
    const I1 = Qin(t), I2 = Qin(t + dt);
    const RHS = (I1 + I2) / 2 + V / dt - Oo / 2;
    // bisección de cota2: vol(c)/dt + O(c)/2 = RHS  (monótona creciente)
    let lo = curva[0].cota, hi = cHi, c2;
    const g = (c) => volDeCota(c) / dt + O(c) / 2 - RHS;
    if (g(hi) <= 0) c2 = hi; else { for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (g(m) > 0) hi = m; else lo = m; } c2 = (lo + hi) / 2; }
    cota = c2; V = volDeCota(c2); Oo = O(c2);
    QinPico = Math.max(QinPico, I2); QoutPico = Math.max(QoutPico, Oo); cotaMax = Math.max(cotaMax, cota);
    out.push({ t: t + dt, Qin: I2, Qout: Oo, cota, vol: V });
  }
  return { out, QinPico, QoutPico, cotaMax, atenuacion: QinPico > 0 ? 1 - QoutPico / QinPico : 0, cotaVert };
}

// Hidrograma triangular de diseño (SCS-like) a partir del caudal punta.
export function hidrogramaTriangular(Qpico, { Qbase = 0, tpico = 3600, tbase = 4 * 3600 } = {}) {
  return [{ t: 0, Q: Qbase }, { t: tpico, Q: Qpico }, { t: tbase, Q: Qbase }];
}
