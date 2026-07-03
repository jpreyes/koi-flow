# koi-flow — Matriz de verificación (QA manual)

Cada capacidad con la forma en que **debería** hacerse, en caso simple y múltiple.
Prueba en el app y anota en **Estado** / **Notas**. Convención de estado:

`⏳` sin probar · `✅` OK · `⚠️` funciona pero ajustar · `❌` falla

> Referencia rápida de entradas del menú: **Archivo** (proyecto/import/informe) ·
> **Editar** (puntos/config) · **Ver** (2D/3D/tema) · **Análisis** (cuenca, hidrología,
> hidráulica, estructuras, embalse, HU, red, continuo, calibración, ModClark, Muskingum,
> alcantarilla, puente, enrocado, verificaciones, degradación, lecho móvil 1D).

---

## 1 · Proyecto y datos

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Nuevo / Demo Tarapacá | Archivo → Cargar demo → carga cuenca+capas de ejemplo | Nuevo → construir de cero e ir guardando | ⏳ |  |
| Abrir / Guardar proyecto | Guardar → archivo; Abrir → restaura estado idéntico | Guardar, cerrar, reabrir tras varias capas/análisis; nada se pierde | ⏳ |  |
| Importar KMZ/KML | Archivo → Importar → 1 polígono aparece como capa | KMZ con varias geometrías → todas al árbol con toggles | ⏳ |  |
| Importar batimetría DXF | Archivo → Importar batimetría → 1 DXF, colocar (arrastrar+auto-elevar) | Varias secciones/curvas DXF colocadas y fusionadas en un DEM | ⏳ |  |
| Punto de análisis | Editar → Agregar punto → clic en mapa → 1 punto | Varios puntos (aguas arriba/abajo) listados; cambiar entre ellos | ⏳ |  |
| Estaciones DGA/CR2 | Se cargan automáticas cerca del área; abrir HUD de 1 estación | Varias estaciones; elegir la de control (Q. Tarapacá en Sibaya) | ⏳ |  |
| Configuración | Editar → Configuración → cambiar un parámetro global | — | ⏳ |  |

## 2 · Cuenca y morfometría

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Descargar relieve (DEM) | Panel cuenca → Descargar relieve del sector | Re-descargar a mayor resolución / otro tramo | ⏳ |  |
| Delineación D8 | Clic punto → Calcular cuenca aportante → cuenca + morfometría | Cuenca aportante **completa** vs por-punto; varios puntos anidados | ⏳ |  |
| Red de drenaje | Calcular red de drenaje (vista) sobre la cuenca | — | ⏳ |  |
| Export cuenca | Exportar KMZ/GeoJSON/SHP de 1 cuenca (con suavizado) | Exportar varias cuencas/puntos a la vez | ⏳ |  |

## 3 · Hidrología (caudales de crecida)

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Análisis de frecuencia | Hidrología → 1 estación → serie + ajuste (T vs Q) | Comparar frecuencia entre varias estaciones | ⏳ |  |
| Crecidas históricas | Ver crecidas registradas de la estación | — | ⏳ |  |
| Caudal en el punto | Método **Transposición (1 cuenca control)** → Q(T) | Comparar Transposición vs Racional Modif. vs DGA-AC vs Verni-King (tabla ADOPTADO) | ⏳ |  |
| Pipeline completo | ▶ Calcular pipeline completo en 1 punto | Pipeline en varios puntos de la cuenca | ⏳ |  |
| Hidrograma HU (convolución) | Análisis → Hidrograma de crecida (HU) → 1 tormenta → hidrograma | Distintas duraciones/tormentas → familia de hidrogramas | ⏳ |  |
| Embalse (laminación) | 1 hidrograma → sale atenuado por curva H-V-Q | Varios hidrogramas / operaciones | ⏳ |  |
| Tránsito Muskingum | 1 tramo → hidrograma entra→sale desfasado/atenuado | Varios tramos en serie | ⏳ |  |
| Red de cuencas (HMS-lite) | 2 subcuencas → 1 tramo → unión → Q cierre | Topología S1+S2→T1→unión con S3; picos por nodo | ⏳ |  |
| Continua + deshielo | 1 año sintético → hidrograma continuo + manto nival | Sensibilidad Cm/Tb; cuenca nivo-pluvial | ⏳ |  |
| Calibración Nelder-Mead | Modo gemelo (obs+ruido) → recupera Cm/Smax/kBase, NSE≈1 | Serie observada real pegada → calibra | ⏳ |  |
| ModClark grillado | Lluvia uniforme → hidrograma Clark | Lluvia variable por zonas de tiempo de viaje (cerca→pico antes) | ⏳ |  |

## 4 · Hidráulica 1D + batimetría

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Secciones desde DEM | Dibujar eje → 1 sección → SVG con cota | Varias secciones a lo largo del eje | ⏳ |  |
| Eje hidráulico 1D (Manning) | 📐 Calcular eje → WSE/V/Fr en 1 sección | Perfil a lo largo de todas las secciones | ⏳ |  |
| Remanso / régimen mixto | Perfil M1/M2 aguas arriba de un control | Régimen mixto (sub↔super) con resalto | ⏳ |  |
| Socavación 1D | 🕳️ Calcular socavación en 1 sección | Socavación por franjas en varias secciones | ⏳ |  |
| Batimetría → HEC-RAS | Colocar DXF + DEM (TIN/curvas) → export .sdf/.asc/.prj/CSV | Varias secciones fusionadas → export set completo | ⏳ |  |

## 5 · Hidráulica 2D

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Malla 2D | Dibujar dominio + eje → Generar malla | Malla con refinamiento en cauce + n cauce/planicie distintos | ⏳ |  |
| Onda difusiva 2D permanente | ▶ Simular 2D con Q → mancha inundación, hmax/Vmax | Barrer Q (varios caudales) sobre misma malla | ⏳ |  |
| Avanzado Picard (nuevo) | Sim con defaults (θ=0.5) → resultado reproducible | θ=1 (legacy, puede sobrestimar) vs θ=0.5; subir iter máx | ⏳ |  |
| 2D transiente | Hidrograma triangular → animación h(t) | Distintos Q pico / tiempos → comparar manchas | ⏳ |  |
| 2D → socavación en secciones | 📥 Muestrear v en 1 sección → socavación con V real | Muestrear todas las secciones | ⏳ |  |

## 6 · Estructuras

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Alcantarilla HDS-5 | 1 alcantarilla → control entrada/salida, HW | Batería de alcantarillas / varios diámetros | ⏳ |  |
| Puente presión/vertedero | 1 puente → curva descarga (presión + vertedero) | Comparar tableros/luz | ⏳ |  |
| Enrocado / defensas (MC 3.708) | 1 tramo → tamaño de roca | Varias defensas a lo largo del cauce | ⏳ |  |
| Estructura en 2D | Colocar 1 pila/puente → stamp terreno + pila en sección; ver 3D | Varias estructuras integradas al análisis 1D/2D | ⏳ |  |

## 7 · Sedimentos / morfología

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Transporte de sedimentos | Perfil de transporte en 1 tramo | — | ⏳ |  |
| Lecho móvil 1D (Exner) | 1 hidrograma triangular → erosión/depósito (déficit r0.3→erosión) | Hidrograma de crecida completo; evolución temporal | ⏳ |  |
| Degradación a largo plazo | Estimar degradación en 1 tramo | Varios tramos | ⏳ |  |

## 8 · Verificaciones y salida

| Capacidad | Caso simple | Caso múltiple | Estado | Notas |
|---|---|---|---|---|
| Verificaciones (T · revancha) | Chequear período de retorno + revancha en 1 punto | Varios puntos/estructuras contra normativa | ⏳ |  |
| Informe PDF / Word | Generar informe con lo analizado (7 secciones) | Proyecto multi-cuenca/estructura → informe consolidado | ⏳ |  |
| Ver 2D / Relieve 3D | Alternar mapa 2D ↔ relieve 3D | 3D con varias capas/tramos activos | ⏳ |  |

---

## Pasada estática (sin navegador) — 2026-07-03

Barrido mecánico del código antes del recorrido en vivo. **Todo limpio** en las clases
de bug que se detectan sin ejecutar, así que los fallos del recorrido serán de
**comportamiento/numéricos**, no de wiring:

- ✅ Sintaxis de todos los módulos (`node --check`) — 0 errores
- ✅ Las 33 acciones del menú (index.html) tienen handler en `boot.js`
- ✅ Firmas `abrir*HUD(koi, huds)` calzan con las llamadas
- ✅ Selectores `querySelector('#id')` calzan con el markup (0 reales; 6 falsos positivos por helpers `f()`/refs cross-file)
- ✅ Métodos `this._x()` definidos (0 reales; el scanner falla con default args `= new Set()`)
- ✅ Archivos de datos del demo presentes (`data/tramos_str1695.geojson`, `data/dem_tramo3.json`)
- ✅ Claves de `window.__koi` consistentes (`hidrogramaCrecida` se setea en convolución y se lee con guarda)

**Pendiente de despliegue** (no es bug de QA): bumpear el `?v=` global al publicar para
que el navegador recargue el solver 2D corregido (θ=0.5).

---

_Generado como checklist de QA. Actualiza Estado/Notas al probar; el feedback vuelve a Claude para corregir la matriz o abrir tareas._
