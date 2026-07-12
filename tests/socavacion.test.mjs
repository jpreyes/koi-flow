// tests/socavacion.test.mjs — GOLDEN de socavación (MC / HEC-18).
// Fórmulas cerradas → golden analítico independiente + sanidad física.
import '../tools/koi-node.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { betaFrecuencia, alfaLL, velocidadCompetente, socavacionLocalPila, socavacionGeneralNeill } from '../js/koi/hidraulica/socavacion.js';
import { nivelNormal } from '../js/koi/hidraulica/manning.js';

const G = 9.81;
const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

test('betaFrecuencia: β = 0.7929 + 0.0973·log10(T), acotado [0.77, 1.07]', () => {
  assert.ok(close(betaFrecuencia(100), 0.7929 + 0.0973 * 2, 1e-6), `β(100)=${betaFrecuencia(100)}`);   // 0.9875
  assert.equal(betaFrecuencia(1e6), 1.07);   // clamp superior
});

test('alfaLL: α = Q / (Hm^(5/3)·Be·μ)', () => {
  const Q = 100, Hm = 2.5, Be = 30, mu = 1.05;
  assert.ok(close(alfaLL({ Q, Hm, Be, mu }), Q / (Math.pow(Hm, 5 / 3) * Be * mu)), 'α analítica');
});

test('velocidadCompetente (Neill): Vc = 1.58·√((s−1)gD)·(h/D)^(1/6)', () => {
  const h = 3, D50mm = 20, s = 2.65, D = D50mm / 1000;
  const Vc = 1.58 * Math.sqrt((s - 1) * G * D) * Math.pow(h / D, 1 / 6);   // ≈ 2.07 m/s
  assert.ok(close(velocidadCompetente(h, D50mm, { s }), Vc), `Vc=${velocidadCompetente(h, D50mm, { s })}`);
});

test('socavacionLocalPila (HEC-18/CSU): ys = 2·K1·K2·K3·y1·(a/y1)^0.65·Fr1^0.43', () => {
  const a = 1.5, y1 = 3, Fr1 = 0.4, K3 = 1.1;
  const ysTeo = 2.0 * 1.0 * 1.0 * K3 * y1 * Math.pow(a / y1, 0.65) * Math.pow(Fr1, 0.43);   // circular ≈ 2.84 m
  const r = socavacionLocalPila({ a, y1, Fr1, forma: 'circular', K3 });
  assert.ok(close(r.ys, ysTeo, 1e-9), `ys=${r.ys}, teórico ${ysTeo}`);
  assert.equal(r.K1, 1.0);
});

test('socavacionLocalPila: pila CUADRADA socava más que CIRCULAR (K1 1.1 vs 1.0)', () => {
  const base = { a: 1.5, y1: 3, Fr1: 0.4, K3: 1.1 };
  const circ = socavacionLocalPila({ ...base, forma: 'circular' }).ys;
  const cuad = socavacionLocalPila({ ...base, forma: 'cuadrada' }).ys;
  assert.ok(cuad > circ, `cuadrada ${cuad} debe > circular ${circ}`);
  assert.ok(close(cuad / circ, 1.1, 1e-9), 'la razón es exactamente K1_cuad/K1_circ = 1.1');
});

test('socavacionGeneralNeill: la socavación crece con el caudal de diseño', () => {
  const rect = [{ s: 0, z: 6 }, { s: 0, z: 0 }, { s: 10, z: 0 }, { s: 10, z: 6 }];
  const sec = nivelNormal(rect, { Q: 40, n: 0.03, J: 0.001 });
  const s20 = socavacionGeneralNeill(sec, rect, { Q: 20, D50mm: 20 }).socav;
  const s60 = socavacionGeneralNeill(sec, rect, { Q: 60, D50mm: 20 }).socav;
  assert.ok(s60 > s20, `socav(Q=60)=${s60} debe > socav(Q=20)=${s20}`);
  assert.ok(s20 >= 0 && s60 >= 0, 'socavación no negativa');
});
