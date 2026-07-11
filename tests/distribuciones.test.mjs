// tests/distribuciones.test.mjs — Estadística de frecuencia (normal). node --test nativo.
import '../tools/koi-node.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normInv, normCdf } from '../js/koi/hidro/distribuciones.js';

test('normal estándar: normCdf(0)=0.5, normInv(0.5)=0', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(normInv(0.5)) < 1e-6);
});

test('normal estándar: valores conocidos (P90 ≈ 1.2816)', () => {
  assert.ok(Math.abs(normInv(0.90) - 1.2816) < 2e-3);
  assert.ok(Math.abs(normCdf(1.6449) - 0.95) < 2e-3);   // P95 ≈ 1.6449
});

test('normInv y normCdf son inversas (round-trip)', () => {
  for (const z of [-2, -0.7, 0.3, 1.5, 2.3]) {
    assert.ok(Math.abs(normInv(normCdf(z)) - z) < 1e-4, `round-trip falla en z=${z}`);
  }
});

test('normCdf es monótona creciente', () => {
  let prev = -1;
  for (let z = -3; z <= 3; z += 0.5) { const p = normCdf(z); assert.ok(p > prev); prev = p; }
});
