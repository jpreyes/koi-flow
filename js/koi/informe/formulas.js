// ─────────────────────────────────────────────────────────────────────────────
// formulas.js — fórmulas del informe PRERRENDERIZADAS en MathML (koi-flow).
// Las formulaciones son las del Manual de Carreteras / referencias clásicas y NO
// cambian: se escriben una vez, bien tipografiadas, y el informe las inserta tal
// cual. MathML Core es nativo en Chrome/Edge/Firefox/Safari (sin librerías).
// El DSL de abajo (i, n, o, frac, sub, …) solo compacta la escritura; el export
// es el diccionario F con el markup final.
// ─────────────────────────────────────────────────────────────────────────────

// ── mini-DSL MathML ───────────────────────────────────────────────────────────
const R = (...x) => `<mrow>${x.join('')}</mrow>`;
const i = (x) => `<mi>${x}</mi>`;
const it = (x) => `<mi mathvariant="italic">${x}</mi>`;     // texto multi-letra en itálica
const tx = (x) => `<mtext>${x}</mtext>`;
const n = (x) => `<mn>${x}</mn>`;
const o = (x) => `<mo>${x}</mo>`;
const sub = (a, b) => `<msub>${R(a)}${R(b)}</msub>`;
const sup = (a, b) => `<msup>${R(a)}${R(b)}</msup>`;
const subsup = (a, b, c) => `<msubsup>${R(a)}${R(b)}${R(c)}</msubsup>`;
const frac = (a, b) => `<mfrac>${R(a)}${R(b)}</mfrac>`;
const sq = (a) => `<msqrt>${R(a)}</msqrt>`;
const par = (...x) => R(o('('), ...x, o(')'));
const cor = (...x) => R(o('['), ...x, o(']'));
const abs = (...x) => R(o('|'), ...x, o('|'));
const M = (body) => `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">${R(body)}</math>`;
const cdot = o('·'), eq = o('='), mas = o('+'), menos = o('−'), aprox = o('≈'), pm = o('±');
const g2 = frac(sup(i('V'), n(2)), R(n(2), i('g')));         // V²/2g

// ── diccionario de fórmulas ───────────────────────────────────────────────────
export const F = {

  // ═ Hidrología ═
  grubbs: M(R(sub(i('x'), R(i('H'), o(','), i('L'))), eq, sup(n(10), par(sub(o('x̄'), tx('log')), pm, sub(i('K'), i('N')), cdot, sub(i('s'), tx('log')))))),
  normal: M(R(sub(i('x'), i('T')), eq, o('x̄'), mas, sub(i('z'), i('T')), cdot, i('s'))),
  lognormal: M(R(tx('ln '), sub(i('x'), i('T')), eq, sub(i('μ'), tx('ln')), mas, sub(i('z'), i('T')), cdot, sub(i('σ'), tx('ln')))),
  pearson3: M(R(sub(i('x'), i('T')), eq, o('x̄'), mas, sub(i('K'), i('T')), par(sub(i('C'), i('s'))), cdot, i('s'))),
  logpearson3: M(R(tx('log '), sub(i('x'), i('T')), eq, sub(o('x̄'), tx('log')), mas, sub(i('K'), i('T')), par(sub(i('C'), R(i('s'), o(','), tx('log')))), cdot, sub(i('s'), tx('log')))),
  gumbel: M(R(sub(i('x'), i('T')), eq, o('x̄'), mas, frac(i('s'), sub(i('S'), i('n'))), cdot, cor(menos, frac(sq(n(6)), i('π')), par(n('0.5772'), mas, tx('ln'), par(tx('ln'), frac(i('T'), R(i('T'), menos, n(1))))), menos, sub(i('Y'), i('n'))))),
  gamma: M(R(i('f'), par(i('x')), eq, frac(R(sup(i('x'), R(i('α'), menos, n(1))), cdot, sup(i('e'), R(menos, i('x'), o('/'), i('β')))), R(sup(i('β'), i('α')), cdot, i('Γ'), par(i('α')))))),
  r2: M(R(sup(i('R'), n(2)), eq, n(1), menos, frac(R(o('Σ'), par(sub(i('x'), i('i')), menos, sub(o('x̂'), i('i')), sup(tx(''), n(2)))), R(o('Σ'), par(sub(i('x'), i('i')), menos, o('x̄'), sup(tx(''), n(2))))))),
  chi2: M(R(sup(i('χ'), n(2)), eq, o('Σ'), frac(sup(par(sub(i('O'), i('i')), menos, sub(i('E'), i('i'))), n(2)), sub(i('E'), i('i'))))),
  idf: M(R(i('i'), par(i('t'), o(','), i('T')), eq, frac(R(sub(i('P'), R(n(24), o(','), i('T'))), cdot, sub(i('C'), i('D')), par(i('t'))), i('t')))),
  racional: M(R(i('Q'), eq, frac(R(i('C'), cdot, i('i'), cdot, i('A')), n('3.6')))),
  verniking: M(R(sub(i('Q'), i('T')), eq, i('C'), cdot, sup(i('A'), n('0.88')), cdot, subsup(i('P'), n(24), n('1.24')))),
  dgaQmd: M(R(subsup(i('Q'), n(10), it('md')), eq, i('a'), cdot, sup(i('A'), i('b')), cdot, sup(it('PP'), i('c')))),
  dgaInst: M(R(subsup(i('Q'), i('T'), it('inst')), eq, subsup(i('Q'), n(10), it('md')), cdot, par(sub(i('Q'), i('T')), o('/'), sub(i('Q'), n(10))), cdot, sub(i('f'), it('inst')))),
  linsley: M(R(sub(i('t'), i('p')), eq, sub(i('C'), i('t')), cdot, sup(par(frac(R(i('L'), cdot, sub(i('L'), i('g'))), sq(i('S')))), i('n')), o(';'), o('&#8195;'), sub(i('q'), i('p')), eq, frac(R(sub(i('C'), i('p')), cdot, i('A')), sub(i('t'), i('p'))))),
  transposicion: M(R(sub(i('Q'), i('x')), eq, sub(i('Q'), i('c')), cdot, sup(par(frac(sub(i('A'), it('px')), sub(i('A'), it('pc')))), n('0.88')), cdot, sup(par(frac(sub(i('P'), R(i('x'), n(24))), sub(i('P'), R(i('c'), n(24))))), n('1.24')))),
  kc: M(R(sub(i('K'), i('c')), eq, n('0.28'), cdot, frac(i('P'), sq(i('A'))))),
  kf: M(R(sub(i('K'), i('f')), eq, frac(i('A'), sup(i('L'), n(2))))),
  tcCalifornia: M(R(sub(i('t'), i('c')), eq, n('0.95'), cdot, sup(par(frac(sup(i('L'), n(3)), i('H'))), n('0.385')))),
  tcGiandotti: M(R(sub(i('t'), i('c')), eq, frac(R(n(4), sq(i('A')), mas, n('1.5'), i('L')), R(n('0.8'), sq(sub(i('H'), i('m')))))),),
  tcNormas: M(R(sub(i('t'), i('c')), eq, n('0.3'), cdot, sup(par(frac(i('L'), sup(i('S'), n('0.25')))), n('0.76')))),
  tcSCS: M(R(sub(i('t'), i('c')), eq, frac(R(sup(par(n('3.28'), cdot, i('L')), n('0.8')), cdot, sup(par(frac(n(1000), it('CN')), menos, n(9)), n('0.7'))), R(n(1140), cdot, subsup(i('S'), o('%'), n('0.5')))))),
  tcKirpich: M(R(sub(i('t'), i('c')), eq, n('0.0195'), cdot, subsup(i('L'), i('m'), n('0.77')), cdot, sup(i('S'), R(menos, n('0.385'))))),
  scsCN: M(R(sub(i('P'), i('e')), eq, frac(sup(par(i('P'), menos, n('0.2'), i('S')), n(2)), R(i('P'), mas, n('0.8'), i('S'))), o(';'), o('&#8195;'), i('S'), eq, frac(n(25400), it('CN')), menos, n(254))),
  convolucion: M(R(sub(i('Q'), i('k')), eq, o('Σ'), sub(i('P'), R(i('e'), o(','), i('j'))), cdot, sub(i('U'), R(i('k'), menos, i('j'), mas, n(1))))),
  muskingum: M(R(sub(i('O'), n(2)), eq, sub(i('C'), n(0)), sub(i('I'), n(2)), mas, sub(i('C'), n(1)), sub(i('I'), n(1)), mas, sub(i('C'), n(2)), sub(i('O'), n(1)))),
  cunge: M(R(i('K'), eq, frac(o('Δ'), i('c')), tx(' con '), i('c'), eq, frac(n(5), n(3)), i('V'), o(';'), o('&#8195;'), i('x'), eq, frac(n(1), n(2)), menos, frac(i('Q'), R(n(2), cdot, i('B'), cdot, sub(i('S'), n(0)), cdot, i('c'), cdot, o('Δ'), i('x'))))),
  puls: M(R(frac(R(n(2), sub(i('S'), n(2))), R(o('Δ'), i('t'))), mas, sub(i('O'), n(2)), eq, sub(i('I'), n(1)), mas, sub(i('I'), n(2)), mas, frac(R(n(2), sub(i('S'), n(1))), R(o('Δ'), i('t'))), menos, sub(i('O'), n(1)))),
  clark: M(R(sub(i('O'), i('k')), eq, sub(i('C'), i('A')), cdot, sub(i('I'), i('k')), mas, sub(i('C'), i('B')), cdot, sub(i('O'), R(i('k'), menos, n(1))), tx(' con '), sub(i('C'), i('A')), eq, frac(R(o('Δ'), i('t')), R(i('R'), mas, n('0.5'), o('Δ'), i('t'))))),
  gradoDia: M(R(i('M'), eq, sub(i('C'), i('m')), cdot, tx('máx'), par(i('T'), menos, sub(i('T'), i('b')), o(','), n(0)))),
  nse: M(R(it('NSE'), eq, n(1), menos, frac(R(o('Σ'), sup(par(sub(i('Q'), it('obs')), menos, sub(i('Q'), it('sim'))), n(2))), R(o('Σ'), sup(par(sub(i('Q'), it('obs')), menos, sub(o('Q̄'), it('obs'))), n(2)))))),

  // ═ Hidráulica ═
  manning: M(R(i('V'), eq, frac(n(1), i('n')), cdot, subsup(i('R'), i('h'), R(n(2), o('/'), n(3))), cdot, sup(i('J'), R(n(1), o('/'), n(2))), o(';'), o('&#8195;'), sub(i('h'), i('f')), eq, i('L'), cdot, sup(par(frac(R(i('Q'), cdot, i('n')), R(i('A'), cdot, subsup(i('R'), i('h'), R(n(2), o('/'), n(3)))))), n(2)))),
  contraccion: M(R(sub(i('h'), i('e')), eq, i('C'), cdot, abs(frac(R(subsup(i('V'), n(2), n(2)), menos, subsup(i('V'), n(1), n(2))), R(n(2), i('g'))))),),
  energia: M(R(i('E'), eq, i('z'), mas, i('y'), mas, g2, o(';'), o('&#8195;'), it('Fr'), eq, frac(i('V'), sq(R(i('g'), cdot, i('A'), o('/'), i('B')))))),
  difusiva: M(R(frac(R(o('∂'), i('H')), R(o('∂'), i('t'))), eq, o('∇'), cdot, par(i('D'), o('∇'), i('H')), mas, i('S'), tx(' con '), i('D'), eq, frac(n(1), i('n')), sup(i('h'), R(n(5), o('/'), n(3))), sup(abs(o('∇'), i('H')), R(menos, n(1), o('/'), n(2))))),
  saintvenant: M(R(frac(R(o('∂'), i('U')), R(o('∂'), i('t'))), mas, o('∇'), cdot, i('F'), par(i('U')), eq, i('S'), par(i('U')), tx(' con '), i('U'), eq, sup(par(i('h'), o(','), it('hu'), o(','), it('hv')), i('T')))),
  hazard: M(R(it('D·V'), eq, i('h'), cdot, i('V'), tx('  [m²/s] → clases H1…H6 (ARR)'))),

  // ═ Obras: alcantarillas / puente / enrocado ═
  hds5entrada: M(R(frac(it('HW'), i('D')), eq, i('c'), cdot, sup(par(frac(R(sub(i('K'), i('u')), cdot, i('Q')), R(i('A'), cdot, sup(i('D'), n('0.5'))))), n(2)), mas, i('Y'), mas, sub(i('K'), i('s')), cdot, i('S'))),
  hds5salida: M(R(it('HW'), eq, it('TW'), mas, par(n(1), mas, sub(i('k'), i('e'))), cdot, g2, mas, sub(i('h'), i('f')), menos, i('L'), cdot, i('S'))),
  orificio: M(R(i('Q'), eq, sub(i('C'), i('d')), cdot, i('A'), cdot, sq(R(n(2), i('g'), cdot, o('Δ'), i('h'))))),
  vertedero: M(R(i('Q'), eq, sub(i('C'), i('w')), cdot, i('L'), cdot, sup(i('H'), R(n(3), o('/'), n(2))), tx(' · Villemonte: '), sub(i('k'), i('s')), eq, sup(par(n(1), menos, sup(par(frac(sub(i('H'), n(2)), sub(i('H'), n(1)))), n('1.5'))), n('0.385')))),
  isbash: M(R(sub(i('D'), n(50)), eq, frac(sup(i('V'), n(2)), R(n(2), i('g'), cdot, sup(i('C'), n(2)), cdot, par(i('s'), menos, n(1)))))),
  maynord: M(R(sub(i('d'), n(50)), eq, sub(i('S'), i('f')), cdot, sub(i('C'), i('s')), cdot, sub(i('C'), i('v')), cdot, i('d'), cdot, sup(cor(frac(i('V'), R(sq(R(sub(i('K'), n(1)), cdot, i('g'), cdot, i('d')))))), n('2.5')))),
  hec23: M(R(sub(i('D'), n(50)), eq, frac(R(n('0.692'), cdot, sup(par(i('K'), cdot, i('V')), n(2))), R(par(i('s'), menos, n(1)), cdot, n(2), i('g'))))),

  // ═ Socavación / sedimentos / lecho ═
  lischtvan: M(R(sub(i('d'), i('s')), eq, sup(cor(frac(R(i('α'), cdot, sup(i('h'), R(n(5), o('/'), n(3)))), R(n('0.68'), cdot, i('β'), cdot, subsup(i('D'), n(50), n('0.28'))))), frac(n(1), R(n(1), mas, i('x'))))),),
  neill: M(R(sub(i('V'), i('c')), eq, i('k'), cdot, sup(i('h'), R(n(1), o('/'), n(6))), cdot, sup(i('D'), R(n(1), o('/'), n(3))), o(';'), o('&#8195;'), sub(i('d'), i('s')), eq, sup(cor(i('q'), o('/'), i('k')), R(n(6), o('/'), n(7))), menos, i('h'))),
  hec18pila: M(R(sub(i('y'), i('s')), eq, n('2.0'), cdot, sub(i('y'), n(1)), cdot, sub(i('K'), n(1)), sub(i('K'), n(2)), sub(i('K'), n(3)), cdot, sup(par(frac(i('a'), sub(i('y'), n(1)))), n('0.65')), cdot, subsup(it('Fr'), n(1), n('0.43')))),
  froehlichEstribo: M(R(sub(i('y'), i('s')), eq, n('2.27'), cdot, sub(i('K'), n(1)), sub(i('K'), n(2)), cdot, sup(par(frac(sup(i('L'), o('′')), sub(i('y'), i('a')))), n('0.43')), cdot, sup(it('Fr'), n('0.61')), cdot, sub(i('y'), i('a')), mas, sub(i('y'), i('a')))),
  hireEstribo: M(R(sub(i('y'), i('s')), eq, n(4), cdot, sub(i('y'), n(1)), cdot, frac(sub(i('K'), n(1)), n('0.55')), cdot, sub(i('K'), n(2)), cdot, sup(it('Fr'), n('0.33')))),
  shields: M(R(sup(i('τ'), o('*')), eq, frac(sub(i('τ'), n(0)), R(par(i('s'), menos, n(1)), cdot, i('ρ'), i('g'), cdot, i('D'))), tx(' con '), sub(i('τ'), n(0)), eq, i('ρ'), i('g'), cdot, i('h'), cdot, i('J'))),
  mpm: M(R(i('φ'), eq, n(8), cdot, sup(par(sup(i('τ'), o('*')), menos, subsup(i('τ'), i('c'), o('*'))), R(n(3), o('/'), n(2))), o(';'), o('&#8195;'), sub(i('q'), i('s')), eq, i('φ'), cdot, sq(R(par(i('s'), menos, n(1)), cdot, i('g'), cdot, sup(i('D'), n(3)))))),
  engelund: M(R(i('φ'), eq, frac(R(n('0.1'), cdot, sup(i('θ'), R(n(5), o('/'), n(2)))), sup(i('f'), o('′'))), tx(' con '), sup(i('f'), o('′')), eq, frac(R(n(2), i('g'), cdot, i('h'), cdot, i('J')), sup(i('V'), n(2))))),
  exner: M(R(frac(R(o('∂'), sub(i('z'), i('b'))), R(o('∂'), i('t'))), eq, frac(R(menos, n(1)), R(n(1), menos, i('p'))), cdot, o('∇'), cdot, sub(o('q⃗'), i('s')))),
  pendEquilibrio: M(R(sub(i('S'), i('e')), eq, sub(i('S'), n(0)), cdot, sup(i('r'), R(n(1), o('/'), i('m'))), o(';'), o('&#8195;'), o('Δ'), i('z'), eq, par(sub(i('S'), n(0)), menos, sub(i('S'), i('e'))), cdot, i('L'))),
  coraza: M(R(o('Δ'), sub(i('z'), it('cor')), eq, n(2), cdot, sub(i('D'), i('c')), cdot, par(frac(n(1), sub(i('P'), i('c'))), menos, n(1)))),

  // ═ Minería / rotura ═
  froehlichBrecha: M(R(sub(i('B'), it('avg')), eq, n('0.27'), cdot, sub(i('K'), i('o')), cdot, subsup(i('V'), i('w'), n('0.32')), cdot, subsup(i('h'), i('b'), n('0.04')), o(';'), o('&#8195;'), sub(i('t'), i('f')), eq, n('63.2'), cdot, sq(frac(sub(i('V'), i('w')), R(i('g'), cdot, subsup(i('h'), i('b'), n(2)))))),),
  froehlichQp: M(R(sub(i('Q'), i('p')), eq, n('0.607'), cdot, subsup(i('V'), i('w'), n('0.295')), cdot, subsup(i('h'), i('w'), n('1.24')))),
  obrien: M(R(sub(i('S'), i('f')), eq, frac(sub(i('τ'), i('y')), R(sub(i('γ'), i('m')), cdot, i('h'))), mas, frac(R(i('K'), cdot, i('μ'), cdot, i('V')), R(n(8), cdot, sub(i('γ'), i('m')), cdot, sup(i('h'), n(2)))), mas, frac(R(subsup(i('n'), it('td'), n(2)), cdot, sup(i('V'), n(2))), sup(i('h'), R(n(4), o('/'), n(3))))),),

  // ═ Sísmica (Mononobe-Okabe) ═
  moKae: (() => {
    const cosf = (x) => R(tx('cos'), par(x));
    const senf = (x) => R(tx('sen'), par(x));
    const num = sup(cosf(R(i('φ'), menos, i('ψ'), menos, i('θ'))), n(2));
    const raiz = sq(frac(
      R(senf(R(i('φ'), mas, i('δ'))), cdot, senf(R(i('φ'), menos, i('ψ'), menos, i('β')))),
      R(cosf(R(i('δ'), mas, i('θ'), mas, i('ψ'))), cdot, cosf(R(i('β'), menos, i('θ'))))));
    const den = R(cosf(i('ψ')), cdot, sup(cosf(i('θ')), n(2)), cdot, cosf(R(i('δ'), mas, i('θ'), mas, i('ψ'))), cdot, sup(cor(n(1), mas, raiz), n(2)));
    return M(R(sub(i('K'), it('AE')), eq, frac(num, den)));
  })(),
  moPae: M(R(sub(i('P'), it('AE')), eq, frac(n(1), n(2)), cdot, i('γ'), cdot, sup(i('H'), n(2)), cdot, par(n(1), menos, sub(i('k'), i('v'))), cdot, sub(i('K'), it('AE')), tx(' con '), i('ψ'), eq, tx('arctan'), par(frac(sub(i('k'), i('h')), R(n(1), menos, sub(i('k'), i('v')))))),),
  moKh: M(R(sub(i('k'), i('h')), eq, frac(sub(i('A'), n(0)), R(n(2), cdot, i('g'))))),
};
export default F;
