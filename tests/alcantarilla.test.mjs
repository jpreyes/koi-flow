// tests/alcantarilla.test.mjs — GOLDEN de alcantarillas (FHWA HDS-5).
// Geometría con valores cerrados conocidos + sanidad hidráulica del diseño.
import '../tools/koi-node.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { areaLlena, radioLleno, geomBarril, tiranteCritico, disenarAlcantarilla } from '../js/koi/hidraulica/alcantarilla.js';

const G = 9.81;
const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

test('areaLlena: circular = πD²/4 · cajón = B·D', () => {
  assert.ok(close(areaLlena('circular', { D: 1.2 }), Math.PI * 1.2 * 1.2 / 4), 'círculo');
  assert.ok(close(areaLlena('cajon', { D: 1.5, B: 2 }), 3), 'cajón 2×1.5 = 3 m²');
});

test('radioLleno: circular = D/4 (A/P) · cajón = B·D/(2(B+D))', () => {
  assert.ok(close(radioLleno('circular', { D: 2 }), 0.5), 'R lleno circular = D/4');
  assert.ok(close(radioLleno('cajon', { D: 1.5, B: 2 }), (2 * 1.5) / (2 * (2 + 1.5))), 'R lleno cajón');
});

test('geomBarril cajón: A=B·y, T=B, P=B+2y', () => {
  const g = geomBarril('cajon', 0.8, { D: 1.5, B: 2 });
  assert.ok(close(g.A, 2 * 0.8) && close(g.T, 2) && close(g.P, 2 + 1.6), `A=${g.A},T=${g.T},P=${g.P}`);
});

test('tiranteCritico cajón: yc = (q²/g)^(1/3), q=Q/B', () => {
  const Q = 8, B = 2, D = 3;
  const yc = Math.cbrt((Q / B) * (Q / B) / G);       // ≈ 1.177 m
  assert.ok(close(tiranteCritico('cajon', Q, { D, B }), yc), `yc=${tiranteCritico('cajon', Q, { D, B })}`);
});

test('disenarAlcantarilla: la carga de agua (HW) crece con el caudal', () => {
  const base = { tipo: 'horm-recto', D: 1.2, L: 20, S: 0.02 };
  const a = disenarAlcantarilla({ ...base, Q: 2 });
  const b = disenarAlcantarilla({ ...base, Q: 4 });
  assert.ok(b.HW > a.HW, `HW(Q=4)=${b.HW} debe > HW(Q=2)=${a.HW}`);
  assert.ok(a.HW > 0 && ['entrada', 'salida'].includes(a.control), 'reporta control gobernante');
});

test('disenarAlcantarilla: dos barriles bajan la HW frente a uno (mismo Q)', () => {
  const base = { tipo: 'horm-recto', D: 1.2, L: 20, S: 0.02, Q: 5 };
  const uno = disenarAlcantarilla({ ...base, nBarriles: 1 });
  const dos = disenarAlcantarilla({ ...base, nBarriles: 2 });
  assert.ok(dos.HW < uno.HW, `HW 2 barriles ${dos.HW} debe < 1 barril ${uno.HW}`);
});
