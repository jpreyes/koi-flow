// tests/koi_file.test.mjs — Round-trip del formato .koi (ZIP in-house + assets). node --test.
import '../tools/koi-node.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { escribirKoi, leerKoi } from '../js/koi/proyecto/koi_file.js';

test('.koi: round-trip preserva estructura y arrays tipados', async () => {
  const proyecto = {
    name: 'Test',
    puntos: [{ lon: -71.2, lat: -35.5, nombre: 'P1' }],
    // un TypedArray "pesado" (DEM/malla) — debe volver bit a bit idéntico
    dem: new Float32Array([0.5, 1.25, 2.75, -3.5, 100.125]),
    indices: new Int32Array([0, 1, 2, 3, 4, 5]),
  };
  const bytes = await escribirKoi(proyecto, { name: 'Test' });
  assert.ok(bytes.length > 0, 'escribe bytes');

  const { proyecto: p2, manifest } = await leerKoi(bytes);
  assert.equal(manifest.formato, 1);
  assert.equal(p2.name, 'Test');
  assert.equal(p2.puntos[0].nombre, 'P1');
  assert.ok(Math.abs(p2.puntos[0].lon - (-71.2)) < 1e-9);

  // los arrays tipados vuelven con el mismo tipo y contenido
  assert.ok(p2.dem instanceof Float32Array, 'dem sigue siendo Float32Array');
  assert.deepEqual(Array.from(p2.dem), Array.from(proyecto.dem));
  assert.ok(p2.indices instanceof Int32Array, 'indices sigue siendo Int32Array');
  assert.deepEqual(Array.from(p2.indices), Array.from(proyecto.indices));
});

test('.koi: sin koi.json lanza error claro', async () => {
  await assert.rejects(() => leerKoi(new Uint8Array([1, 2, 3, 4])));
});
