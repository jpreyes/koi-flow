// ─────────────────────────────────────────────────────────────────────────────
// dxf_export.js — exporta TODO el estudio a DXF (koi-flow). Genera un DXF ASCII
// (LWPOLYLINE/LINE/TEXT, AC1015) en METROS locales (equirectangular centrado en la
// geometría, scale-true para CAD): planta (eje, cut lines de secciones + etiquetas,
// dominio 2D, estructuras, mancha de inundación 2D) + perfiles transversales
// (terreno + WSE + línea de socavación) + eje hidráulico longitudinal.
// ─────────────────────────────────────────────────────────────────────────────

class DXF {
  constructor() { this.e = []; }
  poly(pts, layer, closed = false) {
    if (!pts || pts.length < 2) return;
    this.e.push('0', 'LWPOLYLINE', '8', layer, '90', String(pts.length), '70', closed ? '1' : '0');
    for (const [x, y] of pts) this.e.push('10', x.toFixed(3), '20', y.toFixed(3));
  }
  line(x1, y1, x2, y2, layer) { this.e.push('0', 'LINE', '8', layer, '10', x1.toFixed(3), '20', y1.toFixed(3), '11', x2.toFixed(3), '21', y2.toFixed(3)); }
  text(x, y, h, str, layer) { this.e.push('0', 'TEXT', '8', layer, '10', x.toFixed(3), '20', y.toFixed(3), '40', h.toFixed(2), '1', String(str)); }
  build() {
    return ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES', ...this.e, '0', 'ENDSEC', '0', 'EOF'].join('\n');
  }
}

export function exportarDXF(bati) {
  const estrs = window.__koi?.estr?.estructuras || [];
  const secs = bati.secciones || [];
  // 1) origen local (centroide de toda la geometría lon/lat)
  const all = [];
  const add = (a) => { for (const p of (a || [])) all.push(p); };
  add(bati.eje); add(bati.dominio);
  for (const s of secs) add(s.linea);
  for (const e of estrs) add(e.planta);
  if (bati.mesh2d) for (const n of bati.mesh2d.nodes) all.push([n.lon, n.lat]);
  if (!all.length) throw new Error('No hay geometría para exportar (dibuja eje, secciones o dominio).');
  let lo = 0, la = 0; for (const [x, y] of all) { lo += x; la += y; } lo /= all.length; la /= all.length;
  const mx = 111320 * Math.cos(la * Math.PI / 180), my = 110540;
  const XY = ([x, y]) => [(x - lo) * mx, (y - la) * my];

  const d = new DXF();
  // ── PLANTA ──
  if (bati.eje) d.poly(bati.eje.map(XY), 'EJE_CAUCE');
  if (bati.dominio) d.poly(bati.dominio.map(XY), 'DOMINIO_2D', true);
  secs.forEach((s, i) => {
    d.poly(s.linea.map(XY), 'SECCIONES');
    const m = XY(s.linea[0]); d.text(m[0], m[1], 3, s.nombre || ('S' + (i + 1)), 'SECCIONES_TXT');
  });
  for (const e of estrs) { const poly = e.planta || (e.center ? [e.center] : null); if (poly && poly.length >= 2) d.poly(poly.map(XY), 'ESTRUCTURAS', true); }
  // mancha de inundación 2D → triángulos mojados como polilíneas cerradas
  const mesh = bati.mesh2d, r2 = bati.result2d;
  if (mesh && r2?.h) {
    for (const t of mesh.tris) {
      const hm = (r2.h[t[0]] + r2.h[t[1]] + r2.h[t[2]]) / 3; if (hm <= 0.02) continue;
      const P = t.map((k) => XY([mesh.nodes[k].lon, mesh.nodes[k].lat]));
      d.poly([...P, P[0]], 'INUNDACION_2D', true);
    }
  }

  // ── PERFILES TRANSVERSALES (a la derecha de la planta) ──
  let maxX = -Infinity, minY = Infinity;
  for (const [x, y] of all.map(XY)) { if (x > maxX) maxX = x; if (y < minY) minY = y; }
  const ox = (isFinite(maxX) ? maxX : 0) + 60; let oy = isFinite(minY) ? minY : 0; const gap = 40;
  for (const s of secs) {
    if (!s.pts?.length || !s.res) continue;
    const zmin = Math.min(...s.pts.map((p) => p.z));
    const to = (p) => [ox + p.s, oy + (p.z - zmin)];   // terreno relativo a su mínimo
    d.poly(s.pts.map(to), 'PERFIL_TERRENO');
    // WSE
    const sMax = s.pts[s.pts.length - 1].s;
    d.line(ox, oy + (s.res.WSE - zmin), ox + sMax, oy + (s.res.WSE - zmin), 'PERFIL_WSE');
    // socavación por franjas
    const fr = s.soc?.franjas?.franjas || [];
    if (fr.length) d.poly(fr.map((p) => [ox + p.s, oy + (p.zFondo - zmin)]), 'PERFIL_SOCAVACION');
    d.text(ox, oy - 4, 3, s.nombre, 'PERFIL_TXT');
    oy += (Math.max(...s.pts.map((p) => p.z)) - zmin) + gap;
  }

  // ── EJE HIDRÁULICO LONGITUDINAL (debajo de la planta) ──
  const r = bati._remanso;
  if (r?.perfil?.length) {
    const pf = r.perfil.map((p) => ({ st: p.station, wse: p.WSE, bed: p.WSE - p.profMax })).sort((a, b) => a.st - b.st);
    const zmin = Math.min(...pf.map((p) => p.bed));
    const lx = 0, ly = minY - 120;   // área bajo la planta
    d.poly(pf.map((p) => [lx + p.st, ly + (p.bed - zmin)]), 'EJEHID_LECHO');
    d.poly(pf.map((p) => [lx + p.st, ly + (p.wse - zmin)]), 'EJEHID_WSE');
    d.text(lx, ly - 4, 3, 'Eje hidraulico (lecho + WSE)', 'EJEHID_TXT');
  }
  return d.build();
}
