// tests/dga_ac.test.mjs — GOLDEN del método DGA-AC (Manual DGA 1995, §3.1).
// Reproduce los DOS ejemplos resueltos del manual con las 23 zonas homogéneas:
//   · Pocuro en el Sifón — zona Lp, V Región (Aconcagua), α=1.67 → Q100 inst = 187 m³/s
//   · Chillán en Esperanza — zona Sp, VIII Región (Itata), α=1.37 → Q100 inst = 466 m³/s
import '../tools/koi-node.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dgaAC } from '../js/koi/hidro/caudales.js';

const coef = JSON.parse(readFileSync(fileURLToPath(new URL('../data/coef_hidro.json', import.meta.url)), 'utf8'));
const TS = [2, 5, 10, 20, 25, 50, 75, 100];   // T tabulados en el manual
// P24_10 se usa a través de pp24['10']; el resto de T no interviene en el Q10.
const pp = (p10) => ({ '10': p10 });
const close = (a, b, tol) => Math.abs(a - b) <= tol;

test('DGA-AC · Q10 regional Pocuro (V·Aconcagua): 5.42e-8·134^0.915·90^3.432 ≈ 24.4', () => {
  const r = dgaAC({ A: 134, pp24: pp(90), zona: 'Lp' }, coef, TS);
  assert.equal(r.region, 'V-RM-VI');
  assert.ok(close(r.Q10, 24.4, 0.2), `Q10=${r.Q10.toFixed(2)} (manual 24.4)`);
  assert.equal(r.alfa, 1.67);
});

test('DGA-AC · Pocuro Q(T) instantáneo vs Tabla 3.34 del manual', () => {
  const r = dgaAC({ A: 134, pp24: pp(90), zona: 'Lp' }, coef, TS);
  // Tabla 3.34: 6.5, 21.2, 40.7, 68.8, 80.3, 125.5, 159.3, 187.0
  const esperado = { 2: 6.5, 5: 21.2, 10: 40.7, 20: 68.8, 25: 80.3, 50: 125.5, 75: 159.3, 100: 187.0 };
  for (const T of TS) assert.ok(close(r.valores[T].Q, esperado[T], 1.0),
    `T=${T}: ${r.valores[T].Q.toFixed(1)} (manual ${esperado[T]})`);
});

test('DGA-AC · Q10 regional Chillán (VIII·Itata): 2e-3·224^0.973·175^1.224 ≈ 215.4', () => {
  const r = dgaAC({ A: 224, pp24: pp(175), zona: 'Sp' }, coef, TS);
  assert.equal(r.region, 'VII-IX');
  assert.ok(close(r.Q10, 215.4, 1.5), `Q10=${r.Q10.toFixed(1)} (manual 215.4)`);
  assert.equal(r.alfa, 1.37);
});

test('DGA-AC · Chillán Q(T) instantáneo vs Tabla 3.39 del manual', () => {
  const r = dgaAC({ A: 224, pp24: pp(175), zona: 'Sp' }, coef, TS);
  // Tabla 3.39: 159.4, 242.0, 295.1, 348.3, 363.0, 416.1, 445.7, 466.3
  const esperado = { 2: 159.4, 5: 242.0, 10: 295.1, 20: 348.3, 25: 363.0, 50: 416.1, 75: 445.7, 100: 466.3 };
  for (const T of TS) assert.ok(close(r.valores[T].Q, esperado[T], 2.5),
    `T=${T}: ${r.valores[T].Q.toFixed(1)} (manual ${esperado[T]})`);
});

test('DGA-AC · las 23 zonas homogéneas existen y tienen curva de 8 puntos + α', () => {
  const zonas = Object.keys(coef.dga_ac.zonas);
  assert.equal(zonas.length, 23, `zonas=${zonas.length}`);
  for (const z of zonas) {
    const zz = coef.dga_ac.zonas[z];
    assert.equal(zz.curva.length, 8, `${z}: curva de ${zz.curva.length} puntos`);
    assert.ok(zz.alfa > 1 && zz.alfa < 4, `${z}: α=${zz.alfa}`);
    assert.ok(coef.dga_ac.Q10_por_region[zz.region], `${z}: región ${zz.region} sin fórmula`);
    assert.ok(close(zz.curva[2], 1.00, 1e-9), `${z}: Q10/Q10 debe ser 1.00`);
  }
});

test('DGA-AC · zona inexistente → sinZona, sin romper', () => {
  const r = dgaAC({ A: 100, pp24: pp(60), zona: 'ZZ' }, coef, TS);
  assert.equal(r.sinZona, true);
  assert.equal(r.aplica, false);
  assert.equal(r.valores[100].Q, null);
});

test('DGA-AC · T>100 extrapola log-lineal y se marca extrapolado', () => {
  const r = dgaAC({ A: 134, pp24: pp(90), zona: 'Lp' }, coef, [10, 100, 200, 300]);
  assert.equal(r.extrapolado, true);
  assert.equal(r.valores[100].extrap, false);
  assert.equal(r.valores[200].extrap, true);
  // monótona creciente: Q(300) > Q(200) > Q(100)
  assert.ok(r.valores[300].Q > r.valores[200].Q, 'Q(300)>Q(200)');
  assert.ok(r.valores[200].Q > r.valores[100].Q, 'Q(200)>Q(100)');
});
