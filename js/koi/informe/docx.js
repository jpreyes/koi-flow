// ─────────────────────────────────────────────────────────────────────────────
// docx.js — exportador a Word .docx REAL (koi-flow), 100% in-house.
// Un .docx es un ZIP (zipStore de cuenca/exportar.js, sin compresión — válido)
// con OOXML adentro. Este módulo convierte el HTML del informe (contenido() de
// informe.js, cuya estructura controlamos) a WordprocessingML:
//   · h1/h2 de portada → Título/Subtítulo · .h1–.h4 → Heading1–4 (numeración ya
//     viene en el texto) · p → párrafos con runs (b/i/sub/sup) · table → w:tbl
//   · .formula > <math> → ★ OMML ★ (la matemática NATIVA de Word): el conversor
//     MathML→OMML de abajo cubre el subconjunto del DSL de formulas.js
//     (mrow/mi/mn/mo/mtext/msub/msup/msubsup/mfrac/msqrt) → las ecuaciones
//     quedan EDITABLES en Word, no como imagen ni texto plano.
//   · <svg> (figuras) → rasterizado a PNG vía canvas (2×) e incrustado
//   · <img> (snapshot 3D, dataURL) → incrustado tal cual
// Solo navegador (DOMParser + canvas). Sin dependencias externas.
// ─────────────────────────────────────────────────────────────────────────────
import { zipStore } from '../cuenca/exportar.js?v=8';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const EMU_PX = 9525;                       // EMUs por pixel (96 dpi)

// ── MathML → OMML ─────────────────────────────────────────────────────────────
function mathmlAOmml(mathEl) {
  const run = (txt, italica) => txt.trim() === '' && txt !== ' ' ? '' :
    `<m:r>${italica ? '<m:rPr><m:sty m:val="i"/></m:rPr>' : '<m:rPr><m:sty m:val="p"/></m:rPr>'}<m:t xml:space="preserve">${esc(txt)}</m:t></m:r>`;
  const hijos = (el) => [...el.children].map(conv).join('');
  function conv(el) {
    switch (el.localName) {
      case 'mrow': return hijos(el);
      case 'mi': return run(el.textContent, true);
      case 'mn': case 'mo': return run(el.textContent, false);
      case 'mtext': return run(el.textContent, false);
      case 'mfrac': { const [a, b] = el.children; return `<m:f><m:num>${conv(a)}</m:num><m:den>${conv(b)}</m:den></m:f>`; }
      case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${hijos(el)}</m:e></m:rad>`;
      case 'msub': { const [a, b] = el.children; return `<m:sSub><m:e>${conv(a)}</m:e><m:sub>${conv(b)}</m:sub></m:sSub>`; }
      case 'msup': { const [a, b] = el.children; return `<m:sSup><m:e>${conv(a)}</m:e><m:sup>${conv(b)}</m:sup></m:sSup>`; }
      case 'msubsup': { const [a, b, c] = el.children; return `<m:sSubSup><m:e>${conv(a)}</m:e><m:sub>${conv(b)}</m:sub><m:sup>${conv(c)}</m:sup></m:sSubSup>`; }
      case 'mroot': { const [a, b] = el.children; return `<m:rad><m:radPr/><m:deg>${conv(b)}</m:deg><m:e>${conv(a)}</m:e></m:rad>`; }
      default: return run(el.textContent, false);   // fallback: texto plano
    }
  }
  return `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath>${hijos(mathEl)}</m:oMath></m:oMathPara>`;
}

// ── runs de texto con formato inline (b/strong, i/em, sub, sup) ───────────────
function runsDe(node) {
  let out = '';
  const walk = (n, fmt) => {
    if (n.nodeType === 3) {   // texto
      const t = n.textContent;
      if (!t) return;
      let pr = '';
      if (fmt.b) pr += '<w:b/>';
      if (fmt.i) pr += '<w:i/>';
      if (fmt.sub) pr += '<w:vertAlign w:val="subscript"/>';
      if (fmt.sup) pr += '<w:vertAlign w:val="superscript"/>';
      if (fmt.chico) pr += '<w:sz w:val="18"/><w:color w:val="5A707C"/>';
      out += `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
      return;
    }
    if (n.nodeType !== 1) return;
    const tag = n.localName;
    const f2 = { ...fmt };
    if (tag === 'b' || tag === 'strong') f2.b = true;
    if (tag === 'i' || tag === 'em') f2.i = true;
    if (tag === 'sub') f2.sub = true;
    if (tag === 'sup') f2.sup = true;
    for (const c of n.childNodes) walk(c, f2);
  };
  for (const c of node.childNodes) walk(c, {});
  return out;
}

const P = (runs, opts = {}) => {
  let pr = '';
  if (opts.estilo) pr += `<w:pStyle w:val="${opts.estilo}"/>`;
  if (opts.centro) pr += '<w:jc w:val="center"/>';
  if (opts.derecha) pr += '<w:jc w:val="right"/>';
  if (opts.saltoAntes) pr += '<w:pageBreakBefore/>';
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${runs}</w:p>`;
};
const Ptxt = (txt, opts) => P(`<w:r>${opts?.rpr || ''}<w:t xml:space="preserve">${esc(txt)}</w:t></w:r>`, opts);

// ── tabla HTML → w:tbl ────────────────────────────────────────────────────────
function tablaADocx(tbl) {
  const bordes = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((b) => `<w:${b} w:val="single" w:sz="4" w:color="D9E4EA"/>`).join('') + '</w:tblBorders>';
  // w:tblGrid es obligatorio según ECMA-376 (sin él, algunas versiones de Word
  // piden "reparar" el documento): una columna por celda de la fila más ancha.
  let nCols = 1;
  tbl.querySelectorAll('tr').forEach((tr) => {
    let n = 0; tr.querySelectorAll('th, td').forEach((c) => { n += +c.getAttribute('colspan') || 1; });
    if (n > nCols) nCols = n;
  });
  const grid = '<w:tblGrid>' + '<w:gridCol/>'.repeat(nCols) + '</w:tblGrid>';
  let out = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${bordes}</w:tblPr>${grid}`;
  const filas = tbl.querySelectorAll('tr');
  filas.forEach((tr) => {
    out += '<w:tr>';
    tr.querySelectorAll('th, td').forEach((cel, ci) => {
      const esTh = cel.localName === 'th';
      const span = +cel.getAttribute('colspan') || 1;
      const shd = esTh ? '<w:shd w:val="clear" w:fill="EAF3F6"/>' : '';
      const grid = span > 1 ? `<w:gridSpan w:val="${span}"/>` : '';
      // th: texto en negrita (contenido plano); td: runs con formato inline
      const runs = esTh
        ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(cel.textContent)}</w:t></w:r>`
        : (runsDe(cel) || '<w:r><w:t></w:t></w:r>');
      const jc = ci === 0 ? '' : '<w:pPr><w:jc w:val="right"/></w:pPr>';
      out += `<w:tc><w:tcPr>${grid}${shd}</w:tcPr><w:p>${jc}${runs}</w:p></w:tc>`;
    });
    out += '</w:tr>';
  });
  return out + '</w:tbl>';
}

// ── SVG → PNG (bytes) vía canvas ──────────────────────────────────────────────
async function svgAPng(svgEl, anchoPx = 520) {
  const vb = (svgEl.getAttribute('viewBox') || '0 0 400 300').split(/\s+/).map(Number);
  const w = vb[2] || 400, h = vb[3] || 300;
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = URL.createObjectURL(new Blob([clone.outerHTML], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const esc2 = 2;                                     // 2× para nitidez de impresión
    const cv = document.createElement('canvas');
    cv.width = w * esc2; cv.height = h * esc2;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), pxW: anchoPx, pxH: Math.round(anchoPx * h / w) };
  } finally { URL.revokeObjectURL(url); }
}
async function dataUrlAPng(img, anchoPx = 520) {
  const r = await fetch(img.src);
  const blob = await r.blob();
  // el <img> viene de un documento PARSEADO (DOMParser) → naturalWidth=0; se carga
  // la imagen de verdad para conocer el aspecto real.
  const real = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = img.src; });
  const ratio = real && real.naturalWidth ? real.naturalHeight / real.naturalWidth : 3 / 4;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), pxW: anchoPx, pxH: Math.round(anchoPx * ratio) };
}
function dibujoXml(rid, num, pxW, pxH) {
  const cx = pxW * EMU_PX, cy = pxH * EMU_PX;
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${num}" name="fig${num}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${num}" name="fig${num}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

// ── recorrido del HTML del informe → cuerpo WordprocessingML ─────────────────
async function cuerpoDe(root, media) {
  let body = '', nFig = 0;
  async function walk(node) {
    for (const el of [...node.children]) {
      const cls = el.className || '';
      const tag = el.localName;
      if (tag === 'h1') { body += Ptxt(el.textContent, { estilo: 'Titulo', centro: true }); continue; }
      if (/\bh1\b/.test(cls)) { body += P(runsDe(el), { estilo: 'Heading1', saltoAntes: true }); continue; }
      if (/\bh2\b/.test(cls)) { body += P(runsDe(el), { estilo: 'Heading2' }); continue; }
      if (/\bh3\b/.test(cls)) { body += P(runsDe(el), { estilo: 'Heading3' }); continue; }
      if (/\bh4\b/.test(cls)) { body += P(runsDe(el), { estilo: 'Heading4' }); continue; }
      if (tag === 'h2') { body += Ptxt(el.textContent, { estilo: 'Subtitulo', centro: true }); continue; }
      if (tag === 'table') { body += tablaADocx(el) + '<w:p/>'; continue; }
      if (/\bformula\b/.test(cls)) {
        const math = el.querySelector('math');
        if (math) body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${mathmlAOmml(math)}</w:p>`;
        const nota = el.querySelector('.eq-nota');
        if (nota && nota.textContent.trim()) body += Ptxt(nota.textContent, { centro: true, rpr: '<w:rPr><w:sz w:val="18"/><w:color w:val="5A707C"/></w:rPr>' });
        continue;
      }
      if (tag === 'svg') {
        try {
          const png = await svgAPng(el);
          nFig++;
          const rid = `rIdImg${nFig}`;
          media.push({ rid, name: `word/media/fig${nFig}.png`, bytes: png.bytes });
          body += dibujoXml(rid, nFig, png.pxW, png.pxH);
        } catch { /* figura no rasterizable: se omite */ }
        continue;
      }
      if (tag === 'img' && el.src?.startsWith('data:')) {
        try {
          const png = await dataUrlAPng(el);
          nFig++;
          const rid = `rIdImg${nFig}`;
          media.push({ rid, name: `word/media/fig${nFig}.png`, bytes: png.bytes });
          body += dibujoXml(rid, nFig, png.pxW, png.pxH);
        } catch { /* sin imagen */ }
        continue;
      }
      if (tag === 'img') continue;                       // logo por URL: se omite
      if (tag === 'p' || /\b(figcap|nd|lic|fecha|p-tipo)\b/.test(cls)) {
        const chico = /\b(figcap|nd|lic)\b/.test(cls);
        const centro = /\b(figcap|fecha|p-tipo)\b/.test(cls);
        if (!el.textContent.trim()) continue;
        if (chico) body += Ptxt(el.textContent, { centro, rpr: '<w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="6A7B85"/></w:rPr>' });
        else body += P(runsDe(el) || `<w:r><w:t xml:space="preserve">${esc(el.textContent)}</w:t></w:r>`, { centro });
        continue;
      }
      if (tag === 'ol' || tag === 'ul') {
        let i = 0;
        for (const li of el.querySelectorAll('li')) { i++; body += Ptxt(`${i}. ${li.textContent}`, {}); }
        continue;
      }
      if (tag === 'hr') { continue; }
      // contenedores (section/div/main…): recursión
      await walk(el);
    }
  }
  await walk(root);
  return body;
}

// ── piezas fijas del paquete OOXML ────────────────────────────────────────────
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
const RELS_RAIZ = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Titulo"><w:name w:val="Titulo"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="1800" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/><w:color w:val="12242E"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitulo"><w:name w:val="Subtitulo"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="30"/><w:color w:val="0D7A94"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/><w:color w:val="0D7A94"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="27"/><w:color w:val="0B3A4C"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="0D5A72"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:pPr><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="38596A"/></w:rPr></w:style>
</w:styles>`;

// ── API: HTML del informe → Blob .docx ────────────────────────────────────────
export async function informeADocx(htmlContenido) {
  const doc = new DOMParser().parseFromString(`<div id="raiz">${htmlContenido}</div>`, 'text/html');
  const media = [];
  const body = await cuerpoDe(doc.getElementById('raiz'), media);

  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const relsDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${media.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.name.replace('word/', '')}"/>`).join('\n')}
</Relationships>`;

  const archivos = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: RELS_RAIZ },
    { name: 'word/document.xml', data: documento },
    { name: 'word/_rels/document.xml.rels', data: relsDoc },
    { name: 'word/styles.xml', data: ESTILOS },
    ...media.map((m) => ({ name: m.name, data: m.bytes })),
  ];
  return zipStore(archivos, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
