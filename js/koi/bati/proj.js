// ─────────────────────────────────────────────────────────────────────────────
// proj.js — geodesia / reproyección para batimetría CAD (koi-flow, Fase 4).
//
// Los DWG/DXF que entregan las empresas vienen en coordenadas PROYECTADAS (UTM),
// en husos 18S o 19S y en distintos datums (WGS84/SIRGAS moderno, o PSAD56 / SAD69
// antiguos). koi-flow trabaja en WGS84 geográficas (lon/lat) para el mapa y el DEM.
// Este módulo:
//   • utmInverse(E,N,{zona,sur,elipsoide})  → {lat,lon} en el elipsoide del datum
//   • datumAWGS84(lat,lon,datum)            → {lat,lon} en WGS84 (Helmert 3 par.)
//   • aWGS84({x,y}, sistema)                → {lon,lat} listo para el mapa
//   • detectarSistema(puntos)               → adivina huso/hemisferio por magnitud
//
// Nota honesta sobre "algunos no quedan bien": el datum shift de 3 parámetros deja
// error de pocos metros (y PSAD56 varía por zona). Por eso además se expone un
// AJUSTE FINO (dx,dy en metros) para calzar visualmente contra el DEM base — ver
// `aWGS84(..., {ajuste})`.
// ─────────────────────────────────────────────────────────────────────────────

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// Elipsoides (a = semieje mayor [m], f = achatamiento).
export const ELIPSOIDES = {
  WGS84:    { a: 6378137.0,   f: 1 / 298.257223563 },
  GRS80:    { a: 6378137.0,   f: 1 / 298.257222101 },   // ≈ SIRGAS
  INTL1924: { a: 6378388.0,   f: 1 / 297.0 },           // Hayford → PSAD56
  SAD69:    { a: 6378160.0,   f: 1 / 298.25 },           // Sudamericano 1969
};

// Datums: elipsoide + traslación geocéntrica a WGS84 (dx,dy,dz en metros).
// Los parámetros PSAD56/SAD69 son los usados oficialmente por el IGM Chile
// (rangos por latitud); acá se agrupan como presets. WGS84/SIRGAS = identidad.
export const DATUMS = {
  WGS84:          { elipsoide: 'WGS84', dx: 0,    dy: 0,    dz: 0    },
  SIRGAS:         { elipsoide: 'GRS80', dx: 0,    dy: 0,    dz: 0    },
  // PSAD56 Chile 19°S–43°S (EPSG:1198, el rango que cubre Tarapacá–Los Lagos)
  PSAD56_CL_S:    { elipsoide: 'INTL1924', dx: -270, dy: 188, dz: -388 },
  // PSAD56 norte (Perú/extremo N Chile, EPSG:1195)
  PSAD56_N:       { elipsoide: 'INTL1924', dx: -279, dy: 175, dz: -379 },
  // SAD69 Chile
  SAD69_CL:       { elipsoide: 'SAD69', dx: -59, dy: -11, dz: -52 },
};

export const NOMBRE_DATUM = {
  WGS84: 'WGS84 / SIRGAS (moderno)',
  SIRGAS: 'SIRGAS (GRS80)',
  PSAD56_CL_S: 'PSAD56 Chile 19°–43°S',
  PSAD56_N: 'PSAD56 Norte (Perú/N Chile)',
  SAD69_CL: 'SAD69 Chile',
};

// UTM → geográficas en el MISMO elipsoide (Snyder/USGS, precisión ~mm en la zona).
//   E,N en metros; zona 1..60; sur=true hemisferio sur; elip = {a,f}.
export function utmInverse(E, N, { zona, sur = true, elip = ELIPSOIDES.WGS84 }) {
  const { a, f } = elip;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const x = E - 500000;
  let y = N;
  if (sur) y -= 10000000;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sp = Math.sin(phi1), cp = Math.cos(phi1), tp = Math.tan(phi1);
  const C1 = ep2 * cp * cp;
  const T1 = tp * tp;
  const N1 = a / Math.sqrt(1 - e2 * sp * sp);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sp * sp, 1.5);
  const D = x / (N1 * k0);
  const lat = phi1 - (N1 * tp / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720
  );
  const lon0 = (zona * 6 - 183) * D2R;
  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120
  ) / cp;
  return { lat: lat * R2D, lon: lon * R2D };
}

// Geodésicas de un datum origen → WGS84 por traslación geocéntrica (Helmert 3 par.).
export function datumAWGS84(latDeg, lonDeg, datum) {
  if (datum.dx === 0 && datum.dy === 0 && datum.dz === 0
      && (datum.elipsoide === 'WGS84' || datum.elipsoide === 'GRS80')) {
    return { lat: latDeg, lon: lonDeg };   // ya es WGS84/SIRGAS
  }
  const src = ELIPSOIDES[datum.elipsoide];
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  const e2 = src.f * (2 - src.f);
  const N = src.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  // geodésicas (h=0) → ECEF origen
  const X = N * Math.cos(lat) * Math.cos(lon);
  const Y = N * Math.cos(lat) * Math.sin(lon);
  const Z = (N * (1 - e2)) * Math.sin(lat);
  // traslación a ECEF WGS84
  const Xw = X + datum.dx, Yw = Y + datum.dy, Zw = Z + datum.dz;
  // ECEF → geodésicas WGS84 (Bowring)
  const w = ELIPSOIDES.WGS84;
  const e2w = w.f * (2 - w.f);
  const b = w.a * (1 - w.f);
  const ep2 = (w.a * w.a - b * b) / (b * b);
  const p = Math.hypot(Xw, Yw);
  const th = Math.atan2(Zw * w.a, p * b);
  const lonW = Math.atan2(Yw, Xw);
  const latW = Math.atan2(
    Zw + ep2 * b * Math.sin(th) ** 3,
    p - e2w * w.a * Math.cos(th) ** 3
  );
  return { lat: latW * R2D, lon: lonW * R2D };
}

// Descripción de un sistema de coordenadas de entrada.
//   { tipo:'utm', zona:19, sur:true, datum:'WGS84' }  |  { tipo:'geo', datum:'WGS84' }
export function aWGS84(x, y, sistema, ajuste) {
  let ex = x, ny = y;
  if (ajuste) { ex += (ajuste.dx || 0); ny += (ajuste.dy || 0); }   // nudge en metros (UTM)
  const datum = DATUMS[sistema.datum] || DATUMS.WGS84;
  let latlon;
  if (sistema.tipo === 'utm') {
    latlon = utmInverse(ex, ny, { zona: sistema.zona, sur: sistema.sur !== false, elip: ELIPSOIDES[datum.elipsoide] });
  } else {
    latlon = { lat: ny, lon: ex };
  }
  const w = datumAWGS84(latlon.lat, latlon.lon, datum);
  return { lon: w.lon, lat: w.lat };
}

// Adivina huso/hemisferio a partir de la nube de coordenadas (por magnitud).
// Devuelve { tipo, zona, sur, confianza, motivo }.
export function detectarSistema(puntos) {
  let sx = 0, sy = 0, n = 0, minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of puntos) {
    if (!isFinite(p.x) || !isFinite(p.y)) continue;
    sx += p.x; sy += p.y; n++;
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
    miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }
  if (!n) return { tipo: 'geo', zona: 19, sur: true, confianza: 0, motivo: 'sin puntos' };
  const cx = sx / n, cy = sy / n;
  // geográficas: |x|<=180, |y|<=90
  if (Math.abs(maxx) <= 180 && Math.abs(minx) <= 180 && Math.abs(maxy) <= 90 && Math.abs(miny) <= 90) {
    return { tipo: 'geo', zona: null, sur: cy < 0, confianza: 0.9, motivo: 'valores en rango lon/lat' };
  }
  // UTM: easting 100k–900k, northing grande. Sur si ~6–8 millones (10e6 - lat).
  const sur = cy > 3_000_000;
  // El huso no es recuperable solo de E (E se resetea por huso). Chile norte ≈ 19S,
  // centro/sur ≈ 18S/19S. Por defecto 19S (Tarapacá); el usuario puede corregir.
  const zona = 19;
  return {
    tipo: 'utm', zona, sur, confianza: 0.4,
    motivo: `E∈[${(minx / 1e3).toFixed(0)}k,${(maxx / 1e3).toFixed(0)}k], N∈[${(miny / 1e6).toFixed(2)}M,${(maxy / 1e6).toFixed(2)}M] → UTM ${sur ? 'S' : 'N'} (huso a confirmar)`,
    bbox: { minx, maxx, miny, maxy, cx, cy },
  };
}
