// tests/manning.test.mjs — GOLDEN ANALÍTICO de la hidráulica 1D (Manning).
// Un canal RECTANGULAR tiene A, P, R exactos conocidos, así que validamos la
// geometría de la sección (propiedades) y la fórmula de Manning contra el cálculo
// analítico independiente, y la inversión (nivelNormal) como round-trip.
import '../tools/koi-node.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { propiedades, caudalManning, nivelNormal } from '../js/koi/hidraulica/manning.js';

// Canal rectangular: paredes verticales en s=0 y s=B, fondo en z=0, alto H.
const B = 10, H = 6;
const rect = [{ s: 0, z: H }, { s: 0, z: 0 }, { s: B, z: 0 }, { s: B, z: H }];

test('propiedades: canal rectangular da A, P, R exactos', () => {
  const y = 2;
  const pr = propiedades(rect, y);
  assert.ok(Math.abs(pr.A - B * y) < 1e-9, `A=${pr.A}, esperado ${B * y}`);       // A = B·y = 20
  assert.ok(Math.abs(pr.P - (B + 2 * y)) < 1e-9, `P=${pr.P}, esperado ${B + 2 * y}`); // P = B+2y = 14
  assert.ok(Math.abs(pr.B - B) < 1e-9, `B=${pr.B}, esperado ${B}`);                 // ancho superficial = B
  assert.ok(Math.abs(pr.R - (B * y) / (B + 2 * y)) < 1e-9, `R=${pr.R}`);            // R = 20/14
});

test('caudalManning: coincide con la fórmula analítica Q=(1/n)A R^(2/3)√J', () => {
  const y = 2, n = 0.03, J = 0.001;
  const A = B * y, R = A / (B + 2 * y);
  const Qteorico = (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(J);   // ≈ 26.74 m³/s
  const Qcodigo = caudalManning(rect, y, n, J);
  assert.ok(Math.abs(Qcodigo - Qteorico) / Qteorico < 1e-9, `Q=${Qcodigo}, teórico ${Qteorico}`);
});

test('nivelNormal: invierte Q → profundidad normal (round-trip)', () => {
  const y = 2, n = 0.03, J = 0.001;
  const Q = caudalManning(rect, y, n, J);
  const nn = nivelNormal(rect, { Q, n, J });
  assert.ok(Math.abs(nn.WSE - y) < 1e-3, `WSE=${nn.WSE}, esperado ${y}`);
  assert.ok(Math.abs(nn.profMax - y) < 1e-3, `profMax=${nn.profMax}, esperado ${y}`);
  // continuidad: V = Q/A
  assert.ok(Math.abs(nn.V - Q / (B * y)) < 1e-3, `V=${nn.V}`);
});

test('nivelNormal: régimen sub/supercrítico consistente con Froude', () => {
  const n = 0.03;
  // pendiente suave → subcrítico; pendiente fuerte → supercrítico
  const suave = nivelNormal(rect, { Q: 30, n, J: 0.0005 });
  const fuerte = nivelNormal(rect, { Q: 30, n, J: 0.05 });
  assert.equal(suave.Fr < 1, true, `Fr suave=${suave.Fr} debería ser <1`);
  assert.equal(fuerte.Fr > 1, true, `Fr fuerte=${fuerte.Fr} debería ser >1`);
  assert.match(suave.regimen, /sub/);
  assert.match(fuerte.regimen, /super/);
});
