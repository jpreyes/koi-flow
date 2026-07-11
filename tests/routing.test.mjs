// tests/routing.test.mjs — Tránsito en cauce (Muskingum). node --test nativo.
import '../tools/koi-node.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { muskingum } from '../js/koi/hidro/routing.js';

const INFLOW = [0, 5, 15, 30, 45, 30, 18, 10, 5, 2, 0];   // hidrograma triangular [m³/s]

test('Muskingum: coeficientes C0+C1+C2 = 1 (invariante)', () => {
  const r = muskingum(INFLOW, { K: 3600, x: 0.2, dt: 1800 });
  assert.ok(Math.abs(r.C0 + r.C1 + r.C2 - 1) < 1e-12, `C0+C1+C2=${r.C0 + r.C1 + r.C2}`);
});

test('Muskingum: el pico de salida se atenúa (Qout ≤ Qin)', () => {
  const r = muskingum(INFLOW, { K: 3600, x: 0.2, dt: 1800 });
  assert.ok(r.QoutPico <= r.IinPico + 1e-9, 'pico atenuado');
  assert.ok(r.atenuacion >= -1e-9, 'atenuación no negativa');
});

test('Muskingum: x=0.5 (traslación pura) casi no atenúa el pico', () => {
  const r = muskingum(INFLOW, { K: 1800, x: 0.5, dt: 1800 });
  assert.ok(r.atenuacion < 0.15, `atenuación ${r.atenuacion} debería ser baja con x=0.5`);
});

test('Muskingum: conserva volumen aproximadamente (Σout ≈ Σin)', () => {
  const r = muskingum(INFLOW, { K: 3600, x: 0.2, dt: 1800 });
  const sIn = INFLOW.reduce((a, b) => a + b, 0);
  const sOut = r.O.reduce((a, b) => a + b, 0);
  // conservación no perfecta por los bordes; tolerancia amplia relativa
  assert.ok(Math.abs(sOut - sIn) / sIn < 0.15, `Σin=${sIn} Σout=${sOut}`);
});
