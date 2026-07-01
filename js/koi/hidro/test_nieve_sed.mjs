// ─────────────────────────────────────────────────────────────────────────────
// test_nieve_sed.mjs — línea de nieve / áreas aportantes + transporte de sedimentos.
//   node js/koi/hidro/test_nieve_sed.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { lineaNieveTemperatura, lineaNieveLatitud, areasAportantes, areaPluvialDiseno } from './linea_nieve.js';
import { meyerPeterMuller, hayArrastre, velocidadCriticaArrastre, evaluar } from './sedimentos.js';

let fails = 0;
const approx = (got, exp, tol, msg) => {
  const ok = Math.abs(got - exp) <= tol;
  console.log(`  ${ok ? '✓' : '✗'} ${msg}: ${got.toFixed(2)} vs ${exp} (±${tol})`);
  if (!ok) fails++;
};
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

// ── 1) Línea de nieve por temperatura (Peña-Vidal) ──
console.log('── Línea de nieve por temperatura (gradiente 0.5°C/100m, umbral 1°C) ──');
// estación a 1000 msnm con 15.5°C → cota donde T=1°C: 1000 + (15.5-1)/0.5*100 = 3900
approx(lineaNieveTemperatura({ Href: 1000, Tref: 15.5 }), 3900, 1, 'H línea nieve [m]');
approx(lineaNieveLatitud(19), 3910, 1, 'Línea nieve latitud 19° (DGA 2.1, S17)');

// ── 2) Áreas aportantes con curva hipsométrica ──
console.log('\n── Áreas aportantes (bandas hipsométricas, Hnieve=3910) ──');
const bandas = [
  { cota_inf: 1200, cota_sup: 2000, area: 300 },
  { cota_inf: 2000, cota_sup: 3000, area: 400 },
  { cota_inf: 3000, cota_sup: 3910, area: 251.30 },  // toda bajo 3910
  { cota_inf: 3910, cota_sup: 4600, area: 0 },        // S17: sin área sobre la línea
];
const a = areasAportantes(bandas, 3910);
approx(a.areaTotal, 951.30, 0.01, 'Área total');
approx(a.areaPluvial, 951.30, 0.01, 'Área pluvial (toda bajo línea) = S17');
approx(a.areaNival, 0, 0.01, 'Área nival');

// banda cortada por la línea (prorrateo)
const corte = areasAportantes([{ cota_inf: 3000, cota_sup: 4000, area: 100 }], 3500);
approx(corte.areaPluvial, 50, 0.01, 'Prorrateo banda cortada (mitad pluvial)');

// criterio de diseño: adopta la línea MÁS ALTA para maximizar área pluvial
console.log('\n── areaPluvialDiseno: adopta línea más alta (maximiza Ap) ──');
const bandas2 = [
  { cota_inf: 1200, cota_sup: 3800, area: 700 },
  { cota_inf: 3800, cota_sup: 4200, area: 251.30 },
];
const dis = areaPluvialDiseno(bandas2, { latitud: 19, temperatura: { Href: 1000, Tref: 16 } }, 'pluvial');
ok(dis.lineaNieve.H >= 3910, `línea adoptada = más alta (${dis.lineaNieve.H.toFixed(0)} m, ${dis.lineaNieve.metodo})`);
ok(dis.areaPluvial > 700, `área pluvial maximizada = ${dis.areaPluvial.toFixed(1)} km²`);

// ── 3) Transporte de sedimentos (coherencia física) ──
console.log('\n── Transporte de sedimentos (MC-V3 3.707) ──');
// grava D50=20mm en crecida h=2m, J=0.02 → debe haber arrastre
const arr = hayArrastre(2.0, 0.02, 0.020);
ok(arr.arrastra, `arrastre con h=2m J=2% D50=20mm (τ0=${arr.tau0.toFixed(0)} > τc=${arr.tauc.toFixed(0)} N/m²)`);
const mpm = meyerPeterMuller(2.0, 0.02, 0.020);
ok(mpm.qsf > 0 && isFinite(mpm.qsf), `MPM gasto sólido de fondo = ${mpm.gsf.toFixed(2)} kg/s/m (qsf=${(mpm.qsf*1e3).toFixed(2)} L/s/m)`);
// sin arrastre: lecho grueso, flujo somero
const sin = hayArrastre(0.3, 0.005, 0.30);
ok(!sin.arrastra, `sin arrastre con bolón D50=30cm, h=0.3m, J=0.5%`);
// velocidad crítica creciente con D
ok(velocidadCriticaArrastre(0.05, 2) > velocidadCriticaArrastre(0.01, 2), 'Vc crece con el tamaño del sedimento');
// resumen integrado
const ev = evaluar({ h: 2.0, V: 3.5, J: 0.02, D50: 0.020, ancho: 30 });
console.log(`  resumen: modo=${ev.modo} (z=${ev.z.toFixed(2)}), Vc=${ev.Vcritica.toFixed(2)} m/s vs V=${ev.V}, Gfondo=${ev.gastoFondo_kg_s.toFixed(1)} kg/s en 30 m`);

console.log('\n' + (fails === 0 ? '✅ TODOS LOS TESTS NIEVE+SEDIMENTOS OK' : `❌ ${fails} ASERCIONES FALLARON`));
process.exit(fails === 0 ? 0 : 1);
