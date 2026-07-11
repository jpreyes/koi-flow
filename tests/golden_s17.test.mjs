// tests/golden_s17.test.mjs — CASO DORADO: el pipeline hidrológico del Sector 17
// (Quebrada Retamilla) debe reproducir los caudales adoptados del informe de validación.
// Es el test de CREDIBILIDAD COMPUTACIONAL: si un refactor mueve estos números, salta.
// Corre headless con el shim fetch→fs (tools/koi-node.mjs). node --test nativo.
import '../tools/koi-node.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CASO_S17 } from '../js/koi/hidro/casos.js';
import { correrHidrologia } from '../js/koi/hidro/pipeline.js';

// Golden de referencia (capturado del motor, gobernado por transposición fluviométrica).
const GOLDEN = { 2: 8.5464, 5: 20.7184, 10: 32.8905, 25: 53.7644, 50: 73.9130, 100: 98.3608, 200: 127.7810 };

test('S17: caudal adoptado T=100 ≈ 98.36 m³/s (gobierna la transposición)', async () => {
  const out = await correrHidrologia(CASO_S17);
  const ad = out.caudales.adopcion;
  assert.match(ad.gobiernaMetodo, /Transposici/, 'en zona árida gobierna la fluviometría');
  assert.ok(Math.abs(ad.adoptados[100] - GOLDEN[100]) < 0.05,
    `Q100=${ad.adoptados[100]}, esperado ${GOLDEN[100]}`);
});

test('S17: toda la curva T–Q reproduce el golden (tol 0.1%)', async () => {
  const out = await correrHidrologia(CASO_S17);
  const ad = out.caudales.adopcion.adoptados;
  for (const [T, q] of Object.entries(GOLDEN)) {
    const rel = Math.abs(ad[T] - q) / q;
    assert.ok(rel < 1e-3, `T=${T}: ${ad[T]} vs golden ${q} (err ${(rel * 100).toFixed(3)}%)`);
  }
});

test('S17: los caudales adoptados crecen con el periodo de retorno', async () => {
  const out = await correrHidrologia(CASO_S17);
  const ad = out.caudales.adopcion.adoptados;
  const Ts = Object.keys(ad).map(Number).sort((a, b) => a - b);
  for (let i = 1; i < Ts.length; i++) {
    assert.ok(ad[Ts[i]] > ad[Ts[i - 1]], `Q(T=${Ts[i]}) debe ser > Q(T=${Ts[i - 1]})`);
  }
});
