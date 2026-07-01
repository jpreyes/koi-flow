# koi-flow — Roadmap

Estado de módulos y extensiones futuras. koi-flow: PWA en el navegador (JS ES modules
+ Three.js + Leaflet, sin build, `serve.py` en :8765) para estudios hidrológico-
hidráulicos de puentes/inundación en Chile (Manual de Carreteras, DGA).

## Hecho
- **Hidrología**: análisis de frecuencia, PP de diseño, IDF, Tc, caudales (Racional,
  Verni-King, DGA-AC, HU sintético) y — lo que gobierna en zona árida —
  **transposición fluviométrica** + regional multi-donante + crecidas históricas + línea de nieve.
- **Datos DGA/CR2**: descarga de series pluvio/fluviométricas (`tools/fetch_dga.py`).
- **Cuencas**: delineación D8 en el navegador (DEM Terrarium adaptativo), snap al cauce,
  morfometría, suavizado, export KMZ/GeoJSON/SHP; **red de drenaje (afluentes)**; híbrido
  con **HydroBASINS** para el área aportante total de ríos grandes (`tools/fetch_hydrobasins.py`).
- **Batimetría CAD**: import DXF, colocación scale-true (arrastrar + auto-elevar), DEM por
  TIN/curvas, **fusión con el DEM base**, export HEC-RAS (.sdf/.asc/.prj/CSV).
- **Hidráulica 1D**: secciones desde DEM/CAD → eje por **remanso (paso estándar)** con
  pérdidas por fricción + **localizadas (contracción/expansión + K local)** → **flujo mixto
  con resalto** → **transporte de sedimentos + socavación general (LL) y local (HEC-18)** con
  **granulometría del lecho** → **salida completa tipo HEC-RAS (CSV 24 col)**, **multi-cauce**.
- **UI**: dock derecho con pestañas (DEM/Cuenca/Hidrología/Hidráulica/Socavación/Batimetría),
  árbol de capas con borrar/listas, estaciones DGA automáticas, redimensionable.

## En curso
- **Hidráulica 2D — onda difusiva** (implícita, SPD, reusando meshers/solvers de
  `portico-core` vendorizados en `js/lib/portico/`). Ver `memory/hidraulica-2d-plan.md`.
  - Fase A: dominio = **polígono dibujado** en el mapa → malla triangular refinada en el
    cauce → z del DEM fusionado + n por zona.
  - Fase B: solver difusivo implícito, wetting/drying, **BC de caudal del pipeline hidrológico**.
  - Fase C: mancha de inundación, calados, velocidades, peligrosidad h·V, envolvente, export.

## Backlog / extensiones (pedidas o naturales)
### Hidrología / lluvia
- **Modelador de lluvia-escorrentía tipo HEC-HMS**: hietograma de diseño, pérdidas (CN/Green-Ampt),
  hidrograma unitario / onda cinemática, tránsito (Muskingum), por sub-cuencas encadenadas.
- **BC no permanente**: hidrograma (t, Q) de entrada al 2D (y al 1D).
- **Lluvia sobre la malla (rain-on-grid)** en el 2D — útil en quebradas sin punto de entrada único.

### Hidráulica 2D avanzada
- **SWE dinámico completo** (con inercia, supercrítico/resaltos 2D): FV explícito (HLLC/Roe) o
  el **C++ del usuario (Saint-Venant + solvers Cholesky/skyline/CG) compilado a WASM**
  (repos `portico-pro`/`portico-cplus`).

### Hidráulica 1D pendiente
- Saltos/flujo mixto: hoy sub o super con resalto simple; falta tránsito de resaltos móviles.
- **Estructuras**: puentes/alcantarillas como pérdidas localizadas dedicadas (HEC-RAS bridge/culvert).

### Cuencas / DEM
- **DEM hidrológico global (MERIT Hydro)** para delineación PRECISA de cuencas grandes
  (mejor que la aproximación HydroBASINS nivel 7).
- Dissolve del multipolígono HydroBASINS a un solo borde para export limpio.
- Fusión batimetría alineando el dz por el BORDE (hoy por centroide + feather).
- Radio de snap del exutorio como control en el panel.

### CAD / IO
- Lectura directa de **DWG binario** (hoy se exporta DXF; `accoreconsole` headless cuelga).
- Import de geometría **HEC-RAS** completa; **informe .docx** automático.
- Selector de huso/datum en el export por si difiere del 19S por defecto.
