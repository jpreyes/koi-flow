# Bitácora de sesión — Fix de convergencia del solver 2D + consolidación

> Documento de traspaso para **fusionar a una sola sesión**. Describe qué se hizo en
> la sesión paralela (rama `claude/amazing-ptolemy-bdd2ef`), cómo se integró a `main`,
> qué queda pendiente, y cómo encaja en el roadmap. Fecha: 2026-07-03.

## 1 · Qué estábamos haciendo

Se investigó un reporte de **irreproducibilidad del solver 2D** (`js/koi/hidraulica/solver2d.js`,
onda difusiva): en mallas de pendiente casi uniforme, distintos solvers lineales
(Cholesky banda vs PCG) daban calados `h` muy distintos (~0.5–0.7 m) aunque `hmax`
global fuera parecido.

### Diagnóstico (root cause)
No era el gate `hmin` del frente húmedo ni falta de iteraciones Picard. **La iteración
de Picard no converge**: `D = (1/n)·h^{5/3}·|∇H|^{-1/2}` es fuertemente no lineal
(D→∞ al aplanarse ∇H) y con Picard puro (θ=1) la iteración oscila en un ciclo límite
indefinido (el residuo `max|H(k)−H(k−1)|` se queda en ~0.5–1.5 m para k hasta 12+).
Sin punto fijo, el resultado depende de dónde paró la iteración → cualquier diferencia
entre solvers lineales lo mueve mucho. **Además los calados quedaban sobrestimados 3–4×**
(hmax convergido ≈ 0.16 m vs 0.45–2.8 m no convergido).

### Descartado con evidencia (no re-litigar)
- **Subir el picard mínimo**: EMPEORA con θ=1 (más iteraciones = más oscilación).
- **Suavizar el frente húmedo** (smoothstep C¹ en el gate `hmin`): resultado idéntico
  al corte duro una vez que Picard converge → cero aporte. Se revirtió.

### El fix: sub-relajación de Picard
`H ← (1−θ)·H_iter + θ·sol` con **θ=0.5** (validado: 0.4–0.6 convergen, ≥0.7 re-oscila),
tope `picard=12` y corte por `picardTol=1e-3` (mallas fáciles convergen en ~5–6 iter,
lossless). Costo ~1.8× (≈5.5 factorizaciones/paso vs 3). `relax=1, picard=3, picardTol=0`
recupera el comportamiento legacy exacto.

## 2 · Verificación

Tests headless en Node (no navegador; el cambio es numérico interno). Contra el **PCG-IC0
real de main** vs Cholesky banda, malla 50×50 pendiente 0.008, Q=60:

| Config | max\|Δh\| banda vs PCG | hmax banda/pcg |
|---|---|---|
| Legacy (θ=1, pic=3) | **0.44 m** | 0.45 / 0.49 |
| Fix (θ=0.5, default) | **0.017 m** | 0.158 / 0.162 |

El fix colapsa la discrepancia ~27× y deja el calado físicamente correcto (~0.16 m).
Relevante ahora que `main` **auto-selecciona** banda↔pcg↔wasm por tamaño de malla
(`n > 20000 → pcg`): sin el fix, dos corridas de la misma malla con distinto backend
daban resultados distintos.

## 3 · Coordinación (por qué existía este documento)

Dos sesiones trabajaron el mismo repo en paralelo y **divergieron sobre los mismos
archivos** (`solver2d.js`, `bati_ui.js`):
- La sesión de `main` hizo 26 commits (~70 archivos): presa/rotura, momentum 2D,
  morfo 2D, sismo estribo, tormenta, peligrosidad h·V, y **los backends PCG/WASM**.
- Esta sesión hizo el fix de Picard sobre la base vieja (`fe04e95`).

No hubo pérdida de datos (git aísla worktrees), pero sí riesgo de conflicto. Se resolvió
adelantando esta rama a `main` (fast-forward) y **re-aplicando el fix sobre el
`solver2d.js` actual** (con sus backends), descartando el hook `solve` inyectable
(redundante con el `solverKind` de main).

## 4 · Pendientes (follow-ups) — CERRADOS 2026-07-03

- [x] **Controles Picard en el HUD 2D** (commit `a8234f3`): panel "⚙ Avanzado · convergencia
  no lineal (Picard)" en la difusiva 2D de `bati_ui.js` con `θ relax` (0.5), `Picard máx` (12)
  y `Picard tol` (1e-3); `_simular2D` los lee y pasa a `resolver2D`. Verificado: θ=1 legacy
  hmax=0.33 m vs θ=0.5 hmax=0.17 m (físico), picardTol corta 218 vs 360 solves.
- [x] **QA-matriz.md** (commit `f4ea14d`): actualizada con presa/rotura + onda al 2D, momentum
  2D, morfo 2D, peligrosidad h·V, sismo estribo, tormenta, crecida por-objeto, avanzado Picard,
  worker/WASM, selección "Trabajando en:", recalcular cuenca, cauce en un punto, KMZ→tramo, .koi.
  Corregido el demo (removido en R2 → app arranca vacía).
- [x] **Despliegue** (commit `4f4944e`): `tools/bump-version.mjs` — bump del `?v=` global en un
  comando (`node tools/bump-version.mjs`, con `--dry`). NO se corre ahora; es acción de deploy.
  Dry-run: v2→v3, 208 refs en 51 archivos, excluye worktrees/vendor/glue WASM.

## 5 · Encaje en el roadmap

- El fix cierra un bug de la **Hidráulica 2D (onda difusiva)** que estaba en "En curso"
  del `ROADMAP.md`, y es prerequisito para confiar en la Fase C (mancha/peligrosidad/export)
  y en el rain-on-grid.
- Refuerza el trabajo de solvers de la otra sesión (PCG/WASM): ahora los tres backends
  dan el mismo resultado.

## 6 · Estado de git al consolidar

- Fix integrado a `main` (commit de esta rama, fast-forward).
- Respaldo del trabajo previo (base vieja) en `~/AppData/Local/Temp/claude/koi-backup/`
  (`nuestro-fix.patch`, `picard-fix-sobre-main.patch`, copia de `QA-matriz.md`).
- Memoria del proyecto: `memory/solver2d-picard-relax.md`.
