# koi-flow

**Estudios hidrológico-hidráulicos de puentes e inundación en el navegador** — cuencas,
hidrología, hidráulica 1D/2D, socavación y estructuras, según el **Manual de Carreteras
(MC-V3)** y la **DGA** de Chile.

[![Licencia: AGPL v3](https://img.shields.io/badge/Licencia-AGPL%20v3-1ea7c5.svg)](LICENSE)
![Sin build](https://img.shields.io/badge/build-none-2dd4bf.svg)

> 🌐 **Demo en vivo:** https://jpreyes.github.io/koi-flow/ &nbsp;→&nbsp; abre el menú de
> proyectos (barra izquierda ▾) y pulsa **«Cargar demo (Tarapacá)»**.

koi-flow es una PWA **sin paso de compilación**: JavaScript ES-modules + [Three.js] + [Leaflet],
servida como archivos estáticos. Todo el cálculo corre en el cliente.

---

## Funcionalidades

- **Cuencas** — delineación automática **D8** en el navegador sobre DEM Terrarium (llenado de
  depresiones, direcciones y acumulación de flujo, snap al cauce), morfometría, suavizado y
  export **KMZ / GeoJSON / SHP**; red de drenaje e híbrido con **HydroBASINS**.
- **Hidrología** — análisis de frecuencia (6 distribuciones del MC), PP de diseño, IDF, tiempo
  de concentración, caudales (Racional, Verni-King, DGA-AC, HU sintético) y **transposición
  fluviométrica** (lo que gobierna en zona árida). Series **DGA/CR2**.
- **Batimetría CAD** — importar **DXF**, colocación *scale-true* (arrastrar + auto-elevar), DEM
  por TIN/curvas, fusión con el DEM base y export **HEC-RAS** (`.sdf/.asc/.prj/CSV`).
- **Hidráulica 1D** — secciones desde el DEM/CAD → eje por **remanso (paso estándar)** con
  pérdidas por fricción y localizadas, flujo mixto con **resalto**, multi-cauce y salida tipo HEC-RAS.
- **Hidráulica 2D** — **onda difusiva** sobre malla triangular refinada en el cauce; mancha de
  inundación y campo de velocidades (muestreadas en las secciones).
- **Socavación** — general por **Lischtvan-Lebediev** (por franjas) y **Neill**, con
  granulometría por estratos y tope de roca; local en pila con **5 métodos del MC**.
- **Estructuras** — puentes y alcantarillas (tablero, vigas, pilas, estribos, defensas):
  colocar en 2D, ver/mover en **3D** e **integración al análisis** como HEC-RAS (modificación
  de terreno en 2D; angostamiento + socavación de pila en 1D).
- **Informe** — genera un documento imprimible (→ PDF) con metodologías, fórmulas, tablas y
  figuras de todos los análisis.

## Ejecutar localmente

No requiere instalación de dependencias ni build. Solo un servidor de estáticos:

```bash
# opción 1: el servidor incluido (puerto 8765)
python serve.py

# opción 2: cualquier servidor estático
python -m http.server 8765
```

Luego abre <http://localhost:8765>.

La base DGA usada por la app es estática: `data/estaciones_dga.json` y
`data/series/dga/*.json` se sirven directamente desde el hosting. Si se necesita
actualizarla desde CR2/DGA, ejecutar:

```bash
node tools/export_dga_static.mjs
```

## Estructura

```
index.html            · punto de entrada (PWA)
css/ · js/            · estilos y código (ES-modules, sin build)
lib/                  · Three.js y Leaflet (vendorizados)
data/                 · datos de demo (tramos, DEM, catálogo y series DGA)
tools/                · scripts Python/Node para preparar datos (DGA, DEM, HydroBASINS)
```

## Datos y créditos

- Relieve: teselas **Terrarium** (Mapzen/AWS Open Data).
- Estaciones y series: **DGA** de Chile vía **CR2** (`tools/export_dga_static.mjs`).
- Cuencas de referencia: **HydroBASINS** (HydroSHEDS / WWF).
- Metodologías: **Manual de Carreteras** Vol. 3 (MC-V3) y guías DGA.

Los cálculos son una ayuda de ingeniería y **deben ser revisados por un profesional competente**.

## Licencia

**GNU Affero General Public License v3.0 (AGPL-3.0)** — ver [LICENSE](LICENSE). Al ser una
aplicación de red, si la ofreces como servicio debes poner el código fuente a disposición de
los usuarios. Incluye componentes de malla/solvers derivados de *portico-core* (AGPL).

## Autoría

koi-flow — **JPReyes / [Conmuta.cl](https://conmuta.cl)**.

[Three.js]: https://threejs.org/
[Leaflet]: https://leafletjs.com/
