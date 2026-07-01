// ─────────────────────────────────────────────────────────────────────────────
// test_frecuencia.mjs — validación del motor de frecuencia contra el informe S17
// (estación Camiña, Tabla 3-9 parámetros y Tabla 3-10 cuantiles). Ejecuta:
//   node js/koi/hidro/test_frecuencia.mjs
// Estilo de test de wind-shm: script Node autónomo que asevera contra valores
// de referencia y aborta con código ≠0 si algo se aleja de la tolerancia.
// ─────────────────────────────────────────────────────────────────────────────
import { Modelos } from './distribuciones.js';
import { analizar } from './frecuencia.js';

let fails = 0;
const approx = (got, exp, tol, msg) => {
  const ok = Math.abs(got - exp) <= tol;
  if (!ok) { fails++; console.log(`  ✗ ${msg}: obtuvo ${got.toFixed(2)}, esperaba ${exp} (±${tol})`); }
  return ok;
};

// ── Momentos publicados en S17 (Tabla 3-9), estación Camiña ──
const M = { mean: 12.61, std: 18.42, meanLn: 1.96, stdLn: 1.07, Yn: 0.54, Sn: 1.12 };
const T = [2, 5, 10, 25, 50, 100, 200];

// ── Cuantiles esperados (Tabla 3-10) ──
const REF = {
  normal:    [12.6, 28.1, 36.2, 44.9, 50.5, 55.5, 60.1],
  lognormal: [7.1, 17.5, 28.0, 46.3, 64.0, 85.6, 111.8],
  gumbel:    [9.8, 28.5, 40.9, 56.6, 68.2, 79.7, 91.2],
  gamma:     [5.4, 20.6, 34.6, 54.6, 70.4, 86.7, 103.3],
};

console.log('── Validación distribuciones vs informe S17 (Tabla 3-10) ──\n');

const modelos = {
  normal: Modelos.normal({ mean: M.mean, std: M.std }),
  lognormal: Modelos.lognormal({ meanLn: M.meanLn, stdLn: M.stdLn }),
  gumbel: Modelos.gumbel({ mean: M.mean, std: M.std, Yn: M.Yn, Sn: M.Sn }),
  gamma: Modelos.gamma({ mean: M.mean, std: M.std }),
};

for (const [name, model] of Object.entries(modelos)) {
  console.log(`${name.toUpperCase()}`);
  console.log('  T:      ' + T.map((t) => String(t).padStart(7)).join(''));
  const got = T.map((t) => model.quantile(t));
  console.log('  koi:    ' + got.map((v) => v.toFixed(1).padStart(7)).join(''));
  console.log('  S17:    ' + REF[name].map((v) => v.toFixed(1).padStart(7)).join(''));
  T.forEach((t, i) => approx(got[i], REF[name][i], name === 'lognormal' ? 0.6 : 0.4, `${name} T=${t}`));
  console.log('');
}

// Gamma: verifica que los parámetros calculados = Tabla 3-9 (a=0.47, b=26.91)
const gp = modelos.gamma.params;
approx(gp.k, 0.47, 0.01, 'gamma k (a)');
approx(gp.theta, 26.91, 0.1, 'gamma θ (b)');

// ── Pearson III: deriva el Cs que reproduce la columna S17 y verifica consistencia ──
const REFp3 = [5.9, 19.0, 32.3, 52.9, 70.4, 89.2, 109.3];
let bestCs = 0, bestErr = Infinity;
for (let Cs = 0.5; Cs <= 3.5; Cs += 0.001) {
  const mdl = Modelos.pearson3({ mean: M.mean, std: M.std, skew: Cs });
  const err = T.reduce((a, t, i) => a + (mdl.quantile(t) - REFp3[i]) ** 2, 0);
  if (err < bestErr) { bestErr = err; bestCs = Cs; }
}
const p3 = Modelos.pearson3({ mean: M.mean, std: M.std, skew: bestCs });
console.log(`PEARSON III  (Cs ajustado = ${bestCs.toFixed(3)}, RMSE = ${Math.sqrt(bestErr / T.length).toFixed(2)} mm)`);
console.log('  koi:    ' + T.map((t) => p3.quantile(t).toFixed(1).padStart(7)).join(''));
console.log('  S17:    ' + REFp3.map((v) => v.toFixed(1).padStart(7)).join(''));
approx(Math.sqrt(bestErr / T.length), 0, 2.0, 'pearson3 RMSE (un solo Cs reproduce la columna)');
console.log('');

// ── Pipeline completo sobre la serie cruda de Camiña (1981-2019) ──
const serie = [2.0, 2.0, 4.0, 26.0, 3.0, 23.0, 35.0, 0.0, 6.7, 95.5, 4.0, 5.5, 1.5, 0.5, 4.0, 16.0, 18.5, 0.0, 15.0, 7.0, 10.0, 15.0, 5.0, 7.0, 5.0, 4.0, 4.0, 9.0, 0.0, 2.0, 33.0, 48.0, 13.6, 5.2, 6.5, 0.0, 0.7, 2.5, 10.5];
const res = analizar(serie, { T });
console.log('── Pipeline sobre serie CRUDA Camiña (n=' + res.stats.n + ', media=' + res.stats.mean.toFixed(2) + ', s=' + res.stats.std.toFixed(2) + ') ──');
console.log('  (la media difiere de 12.61 del informe porque S17 rellenó años faltantes)\n');
console.log('  Dist          ' + T.map((t) => ('T' + t).padStart(7)).join('') + '    χ²   crít  ok   R²');
for (const [name, r] of Object.entries(res.resultados)) {
  const row = T.map((t) => r.quantiles[t].toFixed(1).padStart(7)).join('');
  console.log(`  ${name.padEnd(13)}${row}  ${r.chi2.toFixed(2).padStart(5)} ${r.critico.toFixed(2).padStart(5)}  ${r.aceptado ? '✓' : '✗'}  ${r.r2.toFixed(3)}`);
}
console.log(`\n  Mejor ajuste (menor χ² entre aceptadas): ${res.mejor.toUpperCase()}`);

console.log('\n' + (fails === 0 ? '✅ TODOS LOS TESTS OK' : `❌ ${fails} ASERCIONES FALLARON`));
process.exit(fails === 0 ? 0 : 1);
