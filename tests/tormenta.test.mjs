// tests/tormenta.test.mjs — Tormenta de diseño (bloques alternos). node --test nativo.
import '../tools/koi-node.mjs';   // shim fetch→fs (idempotente; algunos motores lo esperan)
import test from 'node:test';
import assert from 'node:assert/strict';
import { bloquesAlternos, uniforme, hietoIncremental } from '../js/koi/hidro/tormenta.js';

// Coeficientes de duración de ejemplo (CD = P(dur)/P(24h)), crecientes hasta 1 en 24 h.
const COEF = [[60, 0.18], [180, 0.34], [360, 0.50], [720, 0.72], [1440, 1.0]];
const PP24 = 80;   // mm

test('bloques alternos: conserva la masa (Σmmbloques = pp24·CD(24h))', () => {
  const t = bloquesAlternos(PP24, COEF, { TdMin: 1440, dtMin: 60, r: 0.5 });
  assert.equal(t.mm.length, 24);                        // 1440/60 bloques
  const suma = t.mm.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(suma - t.Ptotal) < 1e-9);
  assert.ok(Math.abs(t.Ptotal - PP24 * 1.0) < 1e-6);    // CD(1440)=1 → Ptotal = pp24
});

test('bloques alternos: el bloque pico es el máximo incremento', () => {
  const t = bloquesAlternos(PP24, COEF, { TdMin: 1440, dtMin: 60, r: 0.5 });
  const maxMm = Math.max(...t.mm);
  const iPico = t.mm.indexOf(maxMm);
  // con r=0.5 el pico va cerca del centro (índice ~11-12 de 24)
  assert.ok(iPico >= 10 && iPico <= 13, `pico en índice ${iPico}, esperado central`);
  // no hay incrementos negativos
  assert.ok(t.mm.every((v) => v >= 0));
});

test('bloques alternos: r mueve la posición del pico', () => {
  const iPico = (r) => { const t = bloquesAlternos(PP24, COEF, { dtMin: 60, r }); const mx = Math.max(...t.mm); return t.mm.indexOf(mx); };
  assert.ok(iPico(0.1) < iPico(0.5), 'r bajo → pico adelantado');
  assert.ok(iPico(0.9) > iPico(0.5), 'r alto → pico atrasado');
});

test('uniforme: mismo mm en cada bloque y masa consistente', () => {
  const t = uniforme(PP24, COEF, { TdMin: 1440, dtMin: 60 });
  assert.ok(t.mm.every((v) => Math.abs(v - t.mm[0]) < 1e-9));
  assert.ok(Math.abs(t.Ptotal - PP24 * 1.0) < 1e-6);
});

test('hietoIncremental devuelve una copia del vector mm', () => {
  const t = bloquesAlternos(PP24, COEF, { dtMin: 60 });
  const inc = hietoIncremental(t);
  assert.deepEqual(inc, t.mm);
  inc[0] = 999;
  assert.notEqual(t.mm[0], 999);   // es copia, no referencia
});
