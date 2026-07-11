# tests/ — Tests de regresión de koi-flow (in-house, sin CI)

Tests del **motor** de koi-flow con el runner nativo `node --test` (viene con Node ≥ 18).
**Cero dependencias externas, sin bundler, sin package.json, sin GitHub Actions** — se corren
a mano cuando quieras, antes de un commit/deploy.

## Correr todo

```
node --test "tests/**/*.test.mjs"
```

(Las comillas hacen que **node** expanda el glob, así funciona igual en PowerShell y en bash.)
Correr uno solo: `node --test tests/golden_s17.test.mjs`

## Qué cubren

| Archivo | Qué valida |
|---|---|
| `golden_s17.test.mjs` | **Caso dorado**: el pipeline hidrológico del Sector 17 reproduce los caudales adoptados (T=100 → 98.36 m³/s, gobierna la transposición). Si un refactor mueve los números, salta. |
| `tormenta.test.mjs` | Bloques alternos: conservación de masa, posición del pico, efecto de `r`; uniforme. |
| `convolucion.test.mjs` | Pérdidas SCS-CN (valor a mano P=100/CN=80→50.54), Pe≤P, monotonía en CN; convolución conserva volumen. |
| `routing.test.mjs` | Muskingum: C0+C1+C2=1, atenuación del pico, conservación de volumen. |
| `distribuciones.test.mjs` | Normal estándar: normCdf/normInv, valores conocidos, round-trip, monotonía. |
| `koi_file.test.mjs` | Formato `.koi`: round-trip que preserva estructura y arrays tipados (Float32/Int32) bit a bit. |

## Cómo corren headless

Los motores ya son puros; lo único que asumen del navegador es `fetch('data/…')`. Cada test
importa primero `../tools/koi-node.mjs`, que shimea `fetch` → `fs` (lee del repo). Por eso el
caso S17 puede correr sin navegador.

## Agregar un test

1. Crea `tests/<modulo>.test.mjs`.
2. Primera línea: `import '../tools/koi-node.mjs';` (deja el `fetch` listo, es idempotente).
3. `import test from 'node:test';` + `import assert from 'node:assert/strict';`.
4. Importa el motor a probar desde `../js/koi/...` y afirma **invariantes** (conservación de
   masa/volumen, monotonía, valores a mano) o **golden** (números de referencia capturados del
   motor). Preferí invariantes: no se rompen con cambios legítimos de calibración.

## CI (opcional, más adelante)

No hay CI a propósito. Si algún día se quiere, GitHub Actions es **gratis e ilimitado en repos
públicos** como este; serían ~10 líneas de YAML corriendo el mismo `node --test`. No es necesario
para que los tests sirvan: su valor es correrlos antes de publicar.
