# koi-flow — Matriz de verificación (QA manual)

Cada capacidad con la forma en que **debería** hacerse, en caso simple y múltiple.
Prueba en el app y anota en **Estado** / **Notas**. Convención de estado:

`⏳` sin probar · `✅` OK · `⚠️` funciona pero ajustar · `❌` falla

> Referencia rápida del menú **Análisis** (6 grupos): *Espacios de trabajo* (Cuenca, Hidrología,
> Hidráulica 1D/2D, Estructuras) · *Crecidas y tránsito* (Tormenta de diseño, Hidrograma HU, Muskingum,
> Embalse, Red de cuencas) · *Hidrología continua* (Continua+deshielo, Calibración, ModClark) ·
> *Obras hidráulicas* (Alcantarilla, Puente, Enrocado, Verificaciones, Sísmica de estribos) ·
> *Sedimentos y lecho* (Degradación, Lecho móvil 1D) · *Riesgo y rotura* (Colocar presa/depósito,
> Rotura de presa/relaves).
>
> **NO hay demo**: la app arranca vacía (el proyecto de muestra se quitó en R2). Se prueba creando un
> proyecto de cero: importar un cauce KMZ o pinchar un punto → delinear → analizar.

---

## 1 · Proyecto y datos

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Nuevo proyecto (vacío) | Archivo → Nuevo → lienzo vacío, árbol en (0) | Crear, guardar, seguir construyendo | ⏳ |  |
| Guardar / Abrir `.koi` (binario) | Guardar → descarga `.koi` (ZIP+DEFLATE, con DEM/mallas/resultados); Abrir → restaura idéntico | Guardar tras varias capas/análisis, cerrar, reabrir; nada se pierde (incl. presas, hidrogramas por objeto) | ⏳ | .koi guarda TypedArrays crudos |
| Importar KMZ/KML | Archivo → Importar → **las líneas se vuelven tramos** de primera clase (seleccionables) | KMZ con varias líneas → varios tramos; puntos/polígonos como referencia | ⏳ | R3 |
| Importar batimetría DXF | Importar batimetría → 1 DXF, colocar (arrastrar+auto-elevar) | Varias secciones/curvas DXF fusionadas en un DEM | ⏳ |  |
| Punto de análisis | Editar → Agregar punto → clic en mapa → 1 punto | Varios puntos; el indicador "Trabajando en: X" muestra el activo | ⏳ | R9 |
| Estaciones DGA/CR2 | Se cargan cerca del área; abrir HUD de 1 estación; **botón Descargar serie** si falta | Varias estaciones; elegir la de control | ⏳ | R1: fin del "Unexpected token '<'" |
| Configuración | Editar → Configuración → cambiar un parámetro global | — | ⏳ |  |

## 2 · Cuenca y morfometría

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Descargar relieve (DEM) | Panel cuenca → Descargar relieve del sector | Re-descargar a mayor resolución / otro tramo | ⏳ |  |
| Delineación D8 | Clic punto → Calcular cuenca aportante → cuenca + morfometría | Cuenca completa vs por-punto; varios puntos anidados | ⏳ |  |
| **Recalcular cuenca** | Árbol → cuenca → ↻ Recalcular → re-delinea con el snap actual | — | ⏳ | R9 (antes escondido) |
| Red de drenaje | Calcular red de drenaje (vista) | **Cauce en un punto**: clic → solo su árbol de afluentes; auto por zoom | ⏳ | R7 |
| Export cuenca | Exportar KMZ/GeoJSON/SHP de 1 cuenca (con suavizado) | Exportar varias cuencas/puntos | ⏳ |  |

## 3 · Hidrología (caudales de crecida)

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Análisis de frecuencia | Hidrología → 1 estación → serie + ajuste (T vs Q) | Comparar frecuencia entre estaciones | ⏳ |  |
| Crecidas históricas | Ver crecidas registradas de la estación | — | ⏳ |  |
| Caudal en el punto | **Transposición** (1 cuenca control) → Q(T) | Transposición vs Racional vs DGA-AC vs Verni-King (ADOPTADO) | ⏳ |  |
| Pipeline completo | ▶ Calcular pipeline completo en 1 punto | Pipeline en varios puntos | ⏳ |  |
| **Tormenta de diseño (hietograma)** | Análisis → Tormenta → bloques alternos desde la IDF → hietograma + Q pico | Adelantada/central/atrasada (r); cada cuenca la suya | ⏳ | R4 |
| Hidrograma HU (convolución) | Hidrograma de crecida (HU) → 1 tormenta → hidrograma | Distintas duraciones/tormentas | ⏳ |  |
| **Crecida POR OBJETO** | Fijar la crecida de la Cuenca A; seleccionar B → el global NO arrastra la de A | 2 cuencas, cada una su hidrograma; al seleccionar cambia | ⏳ | R9: matar el singleton |
| Embalse (laminación) | 1 hidrograma → atenuado por curva H-V-Q | Varios hidrogramas / operaciones | ⏳ |  |
| Tránsito Muskingum | 1 tramo → hidrograma entra→sale desfasado/atenuado | Varios tramos en serie | ⏳ |  |
| Red de cuencas (HMS-lite) | 2 subcuencas → 1 tramo → unión → Q cierre | Topología S1+S2→T1→unión con S3 | ⏳ |  |
| Continua + deshielo | 1 año sintético → hidrograma continuo + manto nival | Sensibilidad Cm/Tb; cuenca nivo-pluvial | ⏳ |  |
| Calibración Nelder-Mead | Modo gemelo → recupera Cm/Smax/kBase, NSE≈1 | Serie observada real pegada | ⏳ |  |
| ModClark grillado | Lluvia uniforme → hidrograma Clark | Lluvia variable por zonas de tiempo de viaje | ⏳ |  |

## 4 · Hidráulica 1D + batimetría

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Secciones desde DEM | Dibujar eje → 1 sección → SVG con cota; **clic en sección = seleccionar** | Varias secciones; el indicador muestra la activa (V/h) | ⏳ | R9 |
| Eje hidráulico 1D (Manning) | 📐 Calcular eje → WSE/V/Fr | Perfil a lo largo de todas las secciones | ⏳ |  |
| Remanso / régimen mixto | Perfil M1/M2 aguas arriba de un control | Régimen mixto (sub↔super) con resalto | ⏳ |  |
| Socavación 1D | 🕳️ Calcular socavación en 1 sección | Por franjas en varias secciones | ⏳ |  |
| Batimetría → HEC-RAS | Colocar DXF + DEM → export .sdf/.asc/.prj/CSV | Varias secciones fusionadas → set completo | ⏳ |  |

## 5 · Hidráulica 2D

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Malla 2D | Dibujar dominio + eje → Generar malla | Refinamiento en cauce + n cauce/planicie distintos | ⏳ |  |
| Onda difusiva 2D permanente | ▶ Simular 2D con Q → mancha, hmax/Vmax; tiempos por fase | Barrer Q sobre misma malla | ⏳ |  |
| **Solver lineal (banda/PCG/WASM)** | Cambiar backend → **mismo resultado** (con el fix Picard) | Malla grande auto-selecciona PCG; WASM ~persistente | ⏳ | R8; banda↔pcg↔wasm coinciden |
| **Avanzado Picard (θ relax)** | Defaults (θ=0.5) → reproducible y físico (~0.16 m) | θ=1 legacy (sobrestima 3-4×) vs 0.5; subir Picard máx | ⏳ | fix convergencia; θ=0.5 vs 1 difieren |
| **En segundo plano (worker)** | Marcar "En segundo plano" → no congela la UI (incl. WASM en worker) | Malla grande sin bloquear | ⏳ | R8b/c |
| **Momentum 2D (Saint-Venant/HLL)** | 🌊 Simular Momentum 2D → captura resaltos/supercrítico | Con crecida HU/rotura (Q variable en t) | ⏳ | bien-balanceado Audusse |
| **Morfo 2D (Exner)** | Simular morfodinámico → erosión/depósito Δz (mapa divergente) | Desacoplado (N=3) vs acoplado (rotura) | ⏳ |  |
| **Peligrosidad h·V** | Tras 2D → clases H1..H6 (ARR); export CSV/GeoJSON | — | ⏳ |  |
| 2D transiente | Hidrograma → animación h(t) | Distintos Q pico / tiempos | ⏳ |  |
| 2D → socavación en secciones | 📥 Muestrear V en 1 sección → socavación con V real (momentum o difusiva) | Muestrear todas | ⏳ |  |

## 6 · Estructuras y obras

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Alcantarilla HDS-5 | 1 alcantarilla → control entrada/salida, HW | Batería / varios diámetros | ⏳ |  |
| Puente presión/vertedero | 1 puente → curva descarga | Comparar tableros/luz | ⏳ |  |
| Enrocado / defensas (MC 3.708) | 1 tramo → tamaño de roca (prefija V/h del eje 1D) | Varias defensas | ⏳ | ojo default silencioso si no hay hidráulica |
| Verificaciones (T · revancha) | Chequear período de retorno + revancha | Varios puntos/estructuras | ⏳ |  |
| **Sísmica de estribos (Mononobe-Okabe)** | 1 estribo → KAE, empuje, FS desliz/volc; zona sísmica NCh433 | Comparar zonas/geometrías | ⏳ | nuevo |
| Estructura en 2D | Colocar 1 pila/puente → stamp terreno + pila en sección; ver 3D | Varias estructuras integradas 1D/2D | ⏳ |  |

## 7 · Sedimentos / morfología

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Transporte de sedimentos | Perfil de transporte en 1 tramo | — | ⏳ |  |
| Lecho móvil 1D (Exner) | 1 hidrograma triangular → erosión/depósito | Hidrograma completo; evolución temporal | ⏳ |  |
| Degradación a largo plazo | Estimar degradación en 1 tramo | Varios tramos | ⏳ |  |

## 8 · Riesgo: presa / rotura (minería)

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| **Colocar presa/depósito** | Riesgo → Colocar presa → clic en el muro → **vaso desde el DEM** (volumen + curva alt-vol) | Varias presas; cada una su vaso; se seleccionan | ⏳ | R9 T0.4; responde "dónde está el relave" |
| **Rotura de presa/relaves (Froehlich)** | Presa activa → Rotura → **prefija Vw/altura del vaso real**; agua o relave (reología) | Comparar Froehlich vs MLM; agua vs relave | ⏳ |  |
| **Rotura → 2D en el muro** | Marcar "Crecida" en Momentum 2D → la onda entra **en la posición de la presa** con su reología | — | ⏳ | G1/G2 |

## 9 · Selección, navegación y salida

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| **Objeto activo "Trabajando en: X"** | Seleccionar tramo/punto/cuenca/reach/sección/presa → indicador con tipo+color | Cambiar entre objetos; el árbol resalta el activo (mismo color) | ⏳ | R9 Tandas 0/1 |
| Chips "Resultados calculados" | Correr un análisis → chip en el árbol; clic reabre el HUD | Varios análisis → varios chips | ⏳ | R5 |
| "Insumos usados" en resultados | Cada resultado muestra sus insumos; defaults en ámbar | — | ⏳ | R5 |
| Informe PDF / Word (.docx) | Generar informe (fórmulas MathML, figura satelital de la cuenca) | Proyecto multi-cuenca/estructura → informe consolidado | ⏳ |  |
| Ver 2D / Relieve 3D | Alternar mapa 2D ↔ relieve 3D | 3D con varias capas/tramos | ⏳ |  |

---

## Pasada estática (sin navegador) — actualizada 2026-07-03

- ✅ Sintaxis de todos los módulos (`node --check`) — 0 errores
- ✅ Acciones del menú (index.html, incl. las nuevas: tormenta, sismo-estribo, breach, colocar-presa)
  con handler en `boot.js`
- ✅ Firmas `abrir*HUD(koi, huds)` calzan con las llamadas
- ✅ Motores corren headless en Node con `tools/koi-node.mjs` (pipeline S17 reproduce los caudales)
- ✅ Formato `.koi` round-trip verificado (Node + navegador; DEM/mallas/resultados bit-idénticos)
- ⚠️ **Demo removido** (R2): la app arranca vacía; `casos.js` (S17) queda SOLO como fixture de prueba,
  no cableado a ningún menú.

**Pendiente de despliegue** (no es bug de QA): bumpear el `?v=` global al publicar para que el
navegador recargue los módulos (solver 2D con el fix Picard θ=0.5, presa, selección, etc.).

---

_Checklist de QA. Actualiza Estado/Notas al probar; el feedback vuelve para corregir la matriz o abrir tareas._
