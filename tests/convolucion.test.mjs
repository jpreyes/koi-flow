// tests/convolucion.test.mjs — Pérdidas SCS-CN y convolución. node --test nativo.
import '../tools/koi-node.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { efectivaIncremental, convolucion } from '../js/koi/hidro/convolucion.js';

test('SCS-CN: valor a mano (P=100 mm, CN=80 → Pe≈50.54 mm)', () => {
  // S = 25400/80 - 254 = 63.5 ; Ia = 0.2·S = 12.7
  // Pe = (100-12.7)² / (100-12.7+63.5) = 87.3²/150.8 = 50.539 mm
  const pe = efectivaIncremental([100], 80);
  assert.equal(pe.length, 1);
  assert.ok(Math.abs(pe[0] - 50.539) < 0.01, `Pe=${pe[0]}, esperado ≈50.54`);
});

test('SCS-CN: la escorrentía nunca supera la lluvia y es no negativa', () => {
  const hieto = [5, 12, 30, 18, 6];
  const pe = efectivaIncremental(hieto, 75);
  const Ptot = hieto.reduce((a, b) => a + b, 0);
  const Petot = pe.reduce((a, b) => a + b, 0);
  assert.ok(Petot <= Ptot + 1e-9, 'Pe total ≤ P total');
  assert.ok(pe.every((v) => v >= -1e-12), 'sin escorrentía negativa');
});

test('SCS-CN: lluvia bajo la abstracción inicial → escorrentía nula', () => {
  // CN=70 → S=108.86, Ia=21.77 ; una lluvia total de 10 mm < Ia ⇒ Pe=0
  const pe = efectivaIncremental([4, 3, 3], 70);
  assert.ok(pe.reduce((a, b) => a + b, 0) < 1e-9);
});

test('SCS-CN: más CN ⇒ más escorrentía (monótono)', () => {
  const tot = (cn) => efectivaIncremental([20, 30, 25], cn).reduce((a, b) => a + b, 0);
  assert.ok(tot(60) < tot(80), 'CN 80 escurre más que CN 60');
  assert.ok(tot(80) < tot(95));
});

test('convolución: conserva volumen (Σsalida = Σpe · Σu)', () => {
  const pe = [2, 5, 3], u = [0, 1, 2, 1, 0];
  const Q = convolucion(pe, u);
  const sQ = Q.reduce((a, b) => a + b, 0);
  const esperado = pe.reduce((a, b) => a + b, 0) * u.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sQ - esperado) < 1e-9);
  assert.equal(Q.length, pe.length + u.length - 1);
});
