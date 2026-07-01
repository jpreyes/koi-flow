// ─────────────────────────────────────────────────────────────────────────────
// hecras.js — exportación a HEC-RAS (koi-flow, Fase 4).
//   • wktUTM        → texto .prj (WKT ESRI) para que HEC-RAS/RAS Mapper no "alegue".
//   • demArcASCII   → DEM en grilla Arc/Info ASCII (.asc) en UTM → terreno RAS Mapper.
//   • sdfGeometria  → "RAS GIS Import File" (.sdf): red + secciones (cut+surface).
//   • csvSecciones  → estación-elevación por sección (pegar en el editor de RAS).
// Todo en las COORDENADAS UTM originales del CAD (autoconsistentes con el .prj),
// de modo que la geometría entra georreferenciada aunque el huso "real" difiera.
// ─────────────────────────────────────────────────────────────────────────────

// .prj (WKT ESRI) WGS84 / UTM zona N/S.
export function wktUTM(zona = 19, sur = true) {
  const cm = zona * 6 - 183;
  const fn = sur ? 10000000 : 0;
  return `PROJCS["WGS_1984_UTM_Zone_${zona}${sur ? 'S' : 'N'}",GEOGCS["GCS_WGS_1984",`
    + `DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],`
    + `UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],`
    + `PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",${fn}.0],`
    + `PARAMETER["Central_Meridian",${cm}.0],PARAMETER["Scale_Factor",0.9996],`
    + `PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
}

// DEM métrico (interp.construirDEMmetrico) → Arc/Info ASCII Grid en UTM.
//   demM: { nx,ny,x0,y0,dx,dy,data(row0=sur) }.  Escribe filas norte→sur (formato .asc).
export function demArcASCII(demM, { nodata = -9999 } = {}) {
  const { nx, ny, x0, y0, dx, dy, data, mask } = demM;
  const cell = (dx + dy) / 2;                       // .asc asume celda cuadrada
  let out = `ncols ${nx}\nnrows ${ny}\nxllcorner ${x0.toFixed(3)}\nyllcorner ${y0.toFixed(3)}\n`
    + `cellsize ${cell.toFixed(4)}\nNODATA_value ${nodata}\n`;
  const lines = [];
  for (let r = ny - 1; r >= 0; r--) {              // norte primero
    const row = new Array(nx);
    for (let c = 0; c < nx; c++) {
      const i = r * nx + c;
      row[c] = (mask && !mask[i]) ? nodata : data[i].toFixed(2);
    }
    lines.push(row.join(' '));
  }
  return out + lines.join('\n') + '\n';
}

// Un segmento CSV estación-elevación (para el editor de secciones de HEC-RAS).
export function csvSeccion(sec) {
  let s = `Station,Elevation\n`;
  for (const p of sec.surface) s += `${p.s.toFixed(3)},${p.z.toFixed(3)}\n`;
  return s;
}

// CSV de todas las secciones (una tras otra, con encabezado por sección).
export function csvSecciones(secciones) {
  let s = '';
  for (const sec of secciones) {
    s += `# ${sec.nombre}  (station ${sec.station?.toFixed?.(1) ?? '-'} m)\n`;
    s += csvSeccion(sec);
    s += '\n';
  }
  return s;
}

// "RAS GIS Import File" (.sdf) con red de un cauce y las secciones transversales.
//   secciones: [{ nombre, station, cutXY:[{x,y}], surfXYZ:[{x,y,z}], surface:[{s,z}] }]
//   opts: { rio, reach, unidades:'METRIC' }
export function sdfGeometria(secciones, { rio = 'Rio', reach = 'Tramo', unidades = 'METRIC' } = {}) {
  // extensión espacial
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const s of secciones) for (const p of s.surfXYZ) {
    xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
    ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
  }
  // centerline = puntos medios de cada cut line, ordenados por station
  const secs = [...secciones].sort((a, b) => (a.station ?? 0) - (b.station ?? 0));
  const mids = secs.map((s) => {
    const a = s.cutXY[0], b = s.cutXY[s.cutXY.length - 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  });

  const nl = [];
  nl.push('# RAS Geometry Import File');
  nl.push('# Generado por koi-flow');
  nl.push('');
  nl.push('BEGIN HEADER:');
  nl.push(`  UNITS: ${unidades}`);
  nl.push('  DTM TYPE: TIN');
  nl.push('  STREAM LAYER: streams');
  nl.push('  CROSS-SECTION LAYER: XSCutLines');
  nl.push('  BEGIN SPATIALEXTENT:');
  nl.push(`    Xmin: ${xmin.toFixed(3)}`);
  nl.push(`    Ymin: ${ymin.toFixed(3)}`);
  nl.push(`    Xmax: ${xmax.toFixed(3)}`);
  nl.push(`    Ymax: ${ymax.toFixed(3)}`);
  nl.push('  END SPATIALEXTENT:');
  nl.push('  NUMBER OF REACHES: 1');
  nl.push(`  NUMBER OF CROSS-SECTIONS: ${secs.length}`);
  nl.push('END HEADER:');
  nl.push('');
  nl.push('BEGIN STREAM NETWORK:');
  const p0 = mids[0], p1 = mids[mids.length - 1];
  nl.push(`  ENDPOINT: ${p0.x.toFixed(3)} ${p0.y.toFixed(3)} 0 1`);
  nl.push(`  ENDPOINT: ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} 0 2`);
  nl.push('  REACH:');
  nl.push(`    STREAM ID: ${rio}`);
  nl.push(`    REACH ID: ${reach}`);
  nl.push('    FROM POINT: 1');
  nl.push('    TO POINT: 2');
  nl.push('    CENTERLINE:');
  for (const m of mids) nl.push(`      ${m.x.toFixed(3)} ${m.y.toFixed(3)}`);
  nl.push('  END:');
  nl.push('END STREAM NETWORK:');
  nl.push('');
  nl.push('BEGIN CROSS-SECTIONS:');
  for (const s of secs) {
    nl.push('  CROSS-SECTION:');
    nl.push(`    STREAM ID: ${rio}`);
    nl.push(`    REACH ID: ${reach}`);
    nl.push(`    STATION: ${(s.station ?? 0).toFixed(3)}`);
    nl.push('    NODE NAME: ');
    nl.push('    CUT LINE:');
    for (const p of s.cutXY) nl.push(`      ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
    nl.push('    SURFACE LINE:');
    for (const p of s.surfXYZ) nl.push(`      ${p.x.toFixed(3)} ${p.y.toFixed(3)} ${p.z.toFixed(3)}`);
    nl.push('  END:');
  }
  nl.push('END CROSS-SECTIONS:');
  nl.push('');
  return nl.join('\n');
}
