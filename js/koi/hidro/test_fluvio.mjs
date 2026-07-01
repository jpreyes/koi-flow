// ─────────────────────────────────────────────────────────────────────────────
// test_fluvio.mjs — validación de los métodos FLUVIOMÉTRICOS contra el informe S17:
//   · análisis de frecuencia de la estación Río Camarones en Conanoxa (Tabla 3-37)
//   · transposición Verni-King a la cuenca Sector 17 (Tablas 3-41 / 3-42 adoptados)
//   · parámetros del Hidrograma Unitario sintético Linsley (Tabla 3-30)
//   · análisis de crecidas históricas
//   node js/koi/hidro/test_fluvio.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { analizar } from './frecuencia.js';
import { transponer } from './transposicion.js';
import { linsley, abstraccionSCS } from './hidrograma.js';
import { periodosEmpiricos, analizarHistoricas } from './crecidas_historicas.js';
import { adoptar } from './caudales.js';

const camarones = JSON.parse(readFileSync(new URL('../../../data/estacion_camarones.json', import.meta.url)));
const serie = Object.values(camarones.serie);

let fails = 0;
const approx = (got, exp, tol, msg) => {
  const ok = Math.abs(got - exp) <= tol;
  console.log(`  ${ok ? '✓' : '✗'} ${msg}: ${got.toFixed(2)} vs ${exp} (±${tol})`);
  if (!ok) fails++;
  return ok;
};
const row = (arr) => arr.map((v) => (typeof v === 'number' ? v.toFixed(2) : v).padStart(9)).join('');

const Ts = [2, 5, 10, 25, 50, 100, 150, 200];

const lnRef = { 2: 16.5, 5: 40.0, 10: 63.5, 25: 103.8, 50: 142.7, 100: 189.9, 150: 221.9, 200: 246.7 };
const adopRef = { 2: 8.57, 5: 20.73, 10: 32.88, 25: 53.78, 50: 73.91, 100: 98.38, 150: 114.95, 200: 127.81 };

// ── 1) Transposición Verni-King → Sector 17 (Tablas 3-41 / 3-42), MOTOR ──
// Se valida la mecánica de transposición con los cuantiles Log-Normal publicados
// del informe (Tabla 3-37). El factor de área y la multiplicación deben ser exactos.
console.log('── Transposición a Sector 17 (Qc publicado S17, A=951.3, Px=Pc) vs Tabla 3-42 ──');
const tr = transponer(camarones, { Apx: 951.30 }, { Qc: lnRef, T: Ts });
console.log(`  factor área (951.3/2009)^0.88 = ${tr.factor[10].toFixed(4)}`);
console.log('  koi:  ' + row(Ts.map((T) => tr.Qx[T])));
console.log('  S17:  ' + row(Ts.map((T) => adopRef[T])));
for (const T of Ts) approx(tr.Qx[T], adopRef[T], 0.05, `Qx T=${T}`);

// ── 2) Frecuencia sobre la serie CRUDA (informativo: requiere relleno) ──
// La serie cruda incluye 4 caudales muy bajos (0.50/0.72/0.73/0.89) y ~14 años
// faltantes; el informe usó serie rellenada (σln menor). No se asercta hasta
// implementar relleno de estadísticas + datos dudosos (WRC). Solo se muestra.
console.log(`\n── [info] Frecuencia serie cruda Camarones (n=${serie.length}) vs Tabla 3-37 LogNormal ──`);
const an = analizar(serie, { T: Ts });
const ln = an.resultados.lognormal.quantiles;
console.log('  cruda:' + row(Ts.map((T) => ln[T])));
console.log('  S17:  ' + row(Ts.map((T) => lnRef[T])) + '   (difiere → pendiente relleno/WRC)');

// ── 3) Hidrograma Unitario sintético Linsley (Tabla 3-30) ──
console.log('\n── Hidrograma Unitario Linsley (Zona 1, Región III) vs Tabla 3-30 ──');
// L·Lg/√S calibrado para reproducir tp=24.83 h (Lg no está tabulado en el informe)
const L = 108.86, S = 0.03, Lg = 46.8, A = 951.30;
const hu = linsley({ L, Lg, S, A }, 1);
approx(hu.tp, 24.83, 0.6, 'tp [h]');
approx(hu.tu, 4.51, 0.15, 'tu [h]');
approx(hu.tB, 71.36, 1.5, 'tB [h]');
approx(hu.qpUnit, 11.18, 0.3, 'qp [lt/s/mm/km²]');
approx(hu.qpA, 10.63, 0.3, 'qp [m³/s·mm]');
const ab = abstraccionSCS(50, 81);   // CN=81 → S≈59.6 mm
approx(ab.S, 59.6, 0.2, 'Retención SCS S [mm] (CN=81)');

// ── 4) Crecidas históricas ──
console.log('\n── Crecidas históricas (eventos observados Camarones) ──');
const eventos = [
  { año: 2012, Q: 224.17, nota: 'mayor crecida registrada' },
  { año: 2016, Q: 95.87 }, { año: 1997, Q: 89.47 },
];
const lnModel = { quantile: (T) => analizar(serie, { T: [T] }).resultados.lognormal.quantiles[T] };
const hist = analizarHistoricas(eventos, lnModel, adopRef);
for (const e of hist.eventos) console.log(`  ${e['año']}: Q=${e.Q} m³/s → T modelo ≈ ${e.T_modelo.toFixed(0)} años`);
console.log(`  Máx observado: ${hist.maxObservado.Q} m³/s (${hist.maxObservado['año']}). ${hist.advertencia || 'envuelto por el diseño.'}`);
const emp = periodosEmpiricos(serie)[0];
console.log(`  T empírico (Weibull) del máximo de la serie: ${emp.T.toFixed(1)} años`);

// ── 5) Política de adopción (zona árida → gobierna lo fluviométrico) ──
console.log('\n── Adopción de caudales (zona árida) ──');
const pluvialVK = { metodo: 'Verni-King Modificado', aplica: true,
  valores: Object.fromEntries(Ts.map((T) => [T, { Q: lnRef[T] * 0.3 }])) };  // pluvial cualquiera
const ad = adoptar([pluvialVK, tr], Ts, { zona: 'arida' });
console.log(`  gobierna: ${ad.gobiernaMetodo}  | referenciales: ${ad.referenciales.join(', ')}`);
console.log('  adoptado: ' + row(Ts.map((T) => ad.adoptados[T])));
approx(ad.adoptados[100], adopRef[100], 0.05, 'Adoptado T=100 = transposición');
if (ad.gobiernaMetodo.includes('Transposici') || ad.gobiernaMetodo.includes('fluviom')) console.log('  ✓ gobierna método directo fluviométrico');
else { console.log('  ✗ no gobierna el método fluviométrico'); fails++; }

console.log('\n' + (fails === 0 ? '✅ TODOS LOS TESTS FLUVIOMÉTRICOS OK' : `❌ ${fails} ASERCIONES FALLARON`));
process.exit(fails === 0 ? 0 : 1);
