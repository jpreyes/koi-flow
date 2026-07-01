// ─────────────────────────────────────────────────────────────────────────────
// test_hidro.mjs — validación IDF + Tc + caudales contra el informe S17.
//   node js/koi/hidro/test_hidro.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { ppDiseno, intensidad, grunsky, cd } from './idf.js';
import * as TC from './tc.js';
import * as Q from './caudales.js';

const coef = JSON.parse(readFileSync(new URL('../../../data/coef_hidro.json', import.meta.url)));
const putre = coef.idf.estaciones.Putre;

let fails = 0;
const approx = (got, exp, tol, msg) => {
  const ok = Math.abs(got - exp) <= tol;
  if (!ok) { fails++; console.log(`  ✗ ${msg}: ${got.toFixed(2)} vs ${exp} (±${tol})`); }
  return ok;
};
const row = (arr) => arr.map((v) => (typeof v === 'number' ? v.toFixed(2) : v).padStart(8)).join('');

// ── 1) PP de diseño (Tabla 3-12): cuantil Pearson III × 1.10 ──
const ppPearson = { 2: 5.93, 5: 18.99, 10: 32.29, 25: 52.94, 50: 70.40, 100: 89.23, 150: 100.80, 200: 109.26 };
const ppDis = ppDiseno(ppPearson, coef.idf.factor_varas_sanchez);
const ppRefDis = { 2: 6.52, 5: 20.88, 10: 35.52, 25: 58.23, 50: 77.44, 100: 98.15, 150: 110.88, 200: 120.18 };
console.log('── PP de diseño (×1.10 Varas-Sánchez) vs Tabla 3-12 ──');
for (const T of Object.keys(ppRefDis)) approx(ppDis[T], ppRefDis[T], 0.05, `PP diseño T=${T}`);
console.log('  ok\n');

// ── 2) IDF (Tabla 3-14): intensidades mm/hr ──
console.log('── IDF: intensidad mm/hr vs Tabla 3-14 ──');
const idfRef = {  // [durMin]: {T: I}
  60:  { 2: 2.9, 100: 43.2 },
  120: { 2: 2.0, 100: 30.4 },
  1440:{ 2: 0.3, 100: 4.1 },
};
console.log('  dur(min)   T=2(koi/S17)   T=100(koi/S17)');
for (const d of [60, 120, 1440]) {
  const i2 = intensidad(ppDis[2], putre, d), i100 = intensidad(ppDis[100], putre, d);
  console.log(`  ${String(d).padStart(6)}     ${i2.toFixed(1)} / ${idfRef[d][2]}      ${i100.toFixed(1)} / ${idfRef[d][100]}`);
  approx(i2, idfRef[d][2], 0.15, `IDF d=${d} T=2`);
  approx(i100, idfRef[d][100], 0.6, `IDF d=${d} T=100`);
}
console.log('');

// ── 3) Tc (Tabla 3-20): morfometría Sector 17 ──
const morf = { L: 108.86, S: 0.03, A: 951.30, H: 3207 };
console.log('── Tc vs Tabla 3-20 (Sector 17) ──');
const k = TC.kirpich(morf), ne = TC.normasEspanolas(morf);
console.log(`  Kirpich:          koi ${k.tc.toFixed(2)} h   S17 9.54 h`);
console.log(`  Normas Españolas: koi ${ne.tc.toFixed(2)} h   S17 20.70 h`);
approx(k.tc, 9.54, 0.2, 'Kirpich');
approx(ne.tc, 20.70, 0.2, 'Normas Españolas');
const tc = TC.calcular(morf, { adopcion: 'max' });
console.log(`  Adoptado (máx): ${tc.adoptado.toFixed(2)} h  (válidos: ${tc.validos.map((m) => m.metodo).join(', ')})`);
approx(tc.adoptado, 20.70, 0.2, 'Tc adoptado');
console.log('');

// ── 4) Caudales (Tablas 3-21, 3-22, 3-25) ──
const Ts = [2, 5, 10, 25, 50, 100, 150, 200];
// I(tc) Grunsky a tc=20.70 h por cada T
const Itc = {}; for (const T of Ts) Itc[T] = grunsky(ppDis[T], 20.70);
const inputs = { A: 951.30, region: 'III', pp24: ppDis, Itc };
const res = Q.calcular(inputs, coef, Ts);

const vk = res.metodos.find((m) => m.metodo.startsWith('Verni'));
const dga = res.metodos.find((m) => m.metodo === 'DGA-AC');
const vkRef = { 2: 0.64, 5: 2.87, 10: 5.83, 25: 12.27, 50: 18.86, 100: 27.15, 150: 32.24, 200: 36.34 };

console.log('── Verni-King Q[m³/s] vs Tabla 3-22 ──');
console.log('  T:    ' + row(Ts));
console.log('  koi:  ' + row(Ts.map((T) => vk.valores[T].Q)));
console.log('  S17:  ' + row(Ts.map((T) => vkRef[T])));
for (const T of Ts) approx(vk.valores[T].Q, vkRef[T], 0.5, `Verni-King T=${T}`);

console.log(`\n  DGA-AC Q10: koi ${dga.Q10.toFixed(2)} m³/s   S17 2.62 m³/s`);
approx(dga.Q10, 2.62, 0.05, 'DGA-AC Q10');

console.log('\n  Métodos aplicables (A=951 km²): ' + res.aplicables.join(', '));

console.log('\n' + (fails === 0 ? '✅ TODOS LOS TESTS OK' : `❌ ${fails} ASERCIONES FALLARON`));
process.exit(fails === 0 ? 0 : 1);
