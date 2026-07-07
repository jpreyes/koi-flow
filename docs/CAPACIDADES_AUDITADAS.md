# koi-flow - auditoria de capacidades web y ruta Windows nativa

Fecha de auditoria: 2026-07-07  
Rama auditada: `codex/experimentos`  
Alcance: menu superior, dock derecho, arbol lateral, HUDs, handlers en `boot.js`, paneles montados y modulos existentes.

## Resumen ejecutivo

koi-flow esta mayoritariamente cableado como aplicacion web serverless: las capacidades visibles en el menu superior tienen handler en `js/koi/boot.js` y se abren como paneles del dock o HUDs flotantes. El problema metodologico detectado no es que Momentum 2D falte, sino que esta demasiado enterrado: vive dentro de `Analisis -> Hidraulica (batimetria / 1D / 2D)`, dentro del panel de batimetria, cuando se cambia el motor a `2D - onda difusiva`, en el acordeon `Momentum 2D (aguas someras completas)`.

Tambien existe un modulo legacy `js/koi/hidraulica/panel2d.js` (`Flujo2D`) que se instancia en `boot.js`, pero no se muestra porque el dock actual no define un host `flujo2d`. Esa capacidad no debe considerarse expuesta en la web actual. La capacidad 2D activa y usable esta en `BatiPanel`.

## Leyenda de estado

- `OK`: visible en la web y con handler/panel conectado.
- `OK con prerequisitos`: visible y cableado, pero depende de punto, tramo, DEM, eje, dominio, malla o resultado previo.
- `Parcial`: existe y funciona desde otra ruta, pero la navegacion o el texto induce a buscar una ventana que no existe.
- `No expuesto`: hay codigo, pero no hay ruta visible o host montado.

## Matriz auditada

| Capacidad | Donde se encuentra en la web | Evidencia de cableado | Estado | Observacion |
|---|---|---|---|---|
| Nuevo/abrir/guardar proyecto | `Archivo` | `index.html` acciones `proj-nuevo`, `proj-abrir`, `proj-guardar`; handlers en `boot.js` | OK | Persistencia de proyecto web/local. |
| Importar KMZ/KML | `Archivo -> Importar KMZ / KML` | accion `importar` en `boot.js` | OK | Entrada visible desde menu superior. |
| Importar batimetria DXF | `Archivo -> Importar batimetria (DXF)` y dock `Hidraulica` | accion `bati` en `boot.js`; `BatiPanel` montado en `dock.hosts.bati` | OK con prerequisitos | Abre/carga flujo de batimetria dentro del workspace hidraulico. |
| Informe PDF | `Archivo -> Generar informe (PDF)` | accion `informe` en `boot.js`; `js/koi/informe/informe.js` | OK con prerequisitos | El contenido depende de resultados existentes. |
| Informe Word | `Archivo -> Generar informe (Word .docx)` | accion `informe-word` en `boot.js`; `js/koi/informe/docx.js` | OK con prerequisitos | Genera documento a partir del estado actual. |
| Agregar punto de analisis | `Editar -> Agregar punto de analisis` y panel `Cuenca` | accion `add-punto`; `HydroPanel.agregarPunto()` | OK | El arbol lateral ya refleja `Proyecto -> Tramos -> Puntos de analisis`. |
| Agregar etiqueta referencial | `Editar -> Agregar etiqueta referencial` | accion `add-etiqueta` en `boot.js` | OK | Entrada auxiliar de referencia espacial. |
| Configuracion | `Editar -> Configuracion` | accion `config`; `abrirConfigHUD` | OK | HUD flotante. |
| Mapa 2D / Relieve 3D | `Ver -> Mapa 2D`, `Ver -> Relieve 3D` | acciones `ver-2d`, `ver-3d` en `boot.js` | OK con prerequisitos | 3D se habilita cuando hay relieve/DEM disponible. |
| Cuenca y morfometria | `Analisis -> Cuenca y morfometria`; dock tab `Cuenca` | accion `tab-cuenca`; `HydroPanel.setDock()` | OK con prerequisitos | Delimitacion, suavizado, exportaciones y tiempos de concentracion. |
| Red de drenaje | Dock `Cuenca`, seccion DEM/red | `js/koi/hidro/panel.js`; modulos `red_drenaje.js`, `hydrobasins.js` | OK con prerequisitos | Puede usar vista actual/DEM y asociarse al punto de analisis. |
| Estaciones DGA y series | Dock `Hidrologia` | `HydroPanel`; `js/koi/datos/dga.js`; `data/estaciones_dga.json`; `data/series/dga/*.json` | OK | La ruta actual es serverless con catalogo/series estaticas. |
| Analisis de frecuencia / pipeline hidrologico | Dock `Hidrologia` | `js/koi/hidro/frecuencia.js`, `pipeline.js`, `transposicion.js` | OK con prerequisitos | Consume estaciones/series y punto de analisis. |
| Tormenta de diseno | `Analisis -> Tormenta de diseno (hietograma)` | `abrirTormentaHUD` importado y accion `tormenta` | OK | HUD flotante; registra resultado para otros procesos. |
| Hidrograma de crecida HU | `Analisis -> Hidrograma de crecida (HU)` | `abrirConvolucionHUD`; accion `convolucion` | OK | HUD flotante. |
| Transito en cauce | `Analisis -> Transito en cauce (Muskingum)` | `abrirRoutingHUD`; accion `routing` | OK | HUD flotante. |
| Embalse / laminacion | `Analisis -> Embalse (laminacion de crecida)` | `abrirEmbalseHUD`; accion `embalse` | OK con prerequisitos | Puede requerir geometria/vaso. |
| Red de cuencas HMS-lite | `Analisis -> Red de cuencas (HMS-lite)` | `abrirRedHUD`; accion `red` | OK | HUD flotante. |
| Continua + deshielo | `Analisis -> Continua + deshielo (HMS-lite)` | `abrirContinuoHUD`; accion `continuo` | OK | HUD flotante. |
| Calibracion Nelder-Mead | `Analisis -> Calibracion (Nelder-Mead)` | `abrirCalibracionHUD`; accion `calibracion` | OK con prerequisitos | Requiere datos/resultados observados o configurables. |
| ModClark grillado | `Analisis -> ModClark grillado (HMS-lite)` | `abrirModClarkHUD`; accion `modclark` | OK con prerequisitos | HUD flotante. |
| Hidraulica 1D/2D | `Analisis -> Hidraulica (batimetria / 1D / 2D)`; dock tab `Hidraulica` | accion `tab-hidraulica`; `BatiPanel` montado en `bati`; hosts `hidraulica`, `socav`, `bati` | OK con prerequisitos | Workspace principal para batimetria, eje, secciones, dominio y simulacion. |
| Remanso 1D / Manning | Dock `Hidraulica`, panel batimetria, motor `1D` | `js/koi/bati/bati_ui.js`; `js/koi/hidraulica/remanso.js` | OK con prerequisitos | Requiere eje/secciones/flujo. |
| Mancha inundacion 1D | Dock `Hidraulica`, motor `1D` | `BatiPanel` | OK con prerequisitos | Depende de remanso/secciones. |
| Malla y simulacion 2D difusiva | Dock `Hidraulica`, panel batimetria, motor `2D` | botones `bp-2d-gen`, `bp-2d-sim`, `bp-2d-trans`; `solver2d.js`, `malla2d.js` | OK con prerequisitos | Requiere dominio 2D y malla. |
| Momentum 2D aguas someras completas | Dock `Hidraulica` -> panel batimetria -> motor `2D` -> acordeon `Momentum 2D` | boton `bp-2d-mom`; metodo `_simularMomentum2D()`; worker `hidraulica/worker_momentum2d.js` | Parcial | Esta cableado, pero no tiene acceso directo en menu ni ventana propia. Varios textos dicen "ve a Hidraulica -> Momentum 2D", lo que puede confundir porque es un acordeon interno. |
| Morfodinamico 2D | Dock `Hidraulica` -> motor `2D` | boton `bp-2d-mf`; `BatiPanel._simularMorfo2D()` | OK con prerequisitos | Requiere dominio/malla y parametros. |
| Muestreo de velocidades 2D en secciones | Dock `Hidraulica` -> motor `2D` | boton `bp-2d-samp`; `BatiPanel._muestrear2DenSecciones()` | OK con prerequisitos | Usa resultados 2D. |
| Panel legacy Flujo2D | Codigo `js/koi/hidraulica/panel2d.js` | `new Flujo2D()` en `boot.js`; `setDock()` busca `dock.hosts.flujo2d` | No expuesto | El dock actual no tiene `HOST_KEYS`/host `flujo2d`, por lo tanto no renderiza. Si se quiere una ventana 2D separada, hay que reintroducir host/tab o eliminar este modulo para evitar falsa expectativa. |
| Estructuras, puentes y alcantarillas en geometria | `Analisis -> Estructuras (puentes / alcantarillas)`; dock tab `Estructuras` | accion `tab-estructuras`; `EstructurasPanel` montado en `estructuras` | OK con prerequisitos | Permite colocar/editar elementos y sincronizarlos con mapa/3D/hidraulica. |
| Alcantarilla FHWA HDS-5 | `Analisis -> Alcantarilla (FHWA HDS-5)` | `abrirAlcantarillaHUD`; accion `alcantarilla` | OK | HUD de calculo especifico. |
| Puente presion / vertedero | `Analisis -> Puente (presion / vertedero)` | `abrirPuenteHUD`; accion `puente-presion` | OK | HUD de calculo especifico. |
| Enrocado / defensas | `Analisis -> Enrocado / defensas (MC 3.708)` | `abrirEnrocadoHUD`; accion `enrocado` | OK | HUD de calculo especifico. |
| Verificaciones periodo T / revancha | `Analisis -> Verificaciones (periodo T / revancha)` | `abrirVerificacionesHUD`; accion `verificaciones` | OK | HUD de verificacion. |
| Sismica de estribos | `Analisis -> Sismica de estribos (Mononobe-Okabe)` | `abrirSismoEstriboHUD`; accion `sismo-estribo` | OK | HUD de calculo especifico. |
| Degradacion a largo plazo | `Analisis -> Degradacion a largo plazo` | `abrirDegradacionHUD`; accion `degradacion` | OK | HUD de sedimentos/lecho. |
| Lecho movil 1D | `Analisis -> Lecho movil 1D (evolucion)` | `abrirMorfoHUD`; accion `morfo1d` | OK | HUD especifico. |
| Colocar presa/deposito | `Analisis -> Colocar presa / deposito` | accion `colocar-presa`; `hydro.colocarPresa()` | OK con prerequisitos | No abre HUD: activa colocacion en mapa. |
| Rotura de presa/relaves | `Analisis -> Rotura de presa / relaves (Froehlich)` | `abrirBreachHUD`; accion `breach` | OK con prerequisitos | El HUD deja hidrograma para rutear con Momentum 2D. |
| Ayuda y acerca de | `Ayuda` | acciones `ayuda`, `acerca` | OK | HUDs informativos. |

## Hallazgos de navegacion y UX

1. Momentum 2D esta conectado, pero no aparece como ventana propia. La ruta real es:
   `Analisis -> Hidraulica (batimetria / 1D / 2D) -> motor 2D -> Momentum 2D (acordeon)`.

2. Hay textos que dicen al usuario que vaya a `Hidraulica -> Momentum 2D`. Eso es tecnicamente correcto solo si se entiende Momentum 2D como seccion dentro de Hidraulica, no como item visible del menu o tab. Recomendacion: agregar un acceso directo `Analisis -> Momentum 2D` que haga:
   - `dock.show('hidraulica')`
   - cambie `BatiPanel.motor = '2d'`
   - abra el acordeon `momentum`
   - enfoque el boton `Simular Momentum 2D`

3. `Flujo2D` no esta expuesto. El codigo busca `dock.hosts.flujo2d`, pero `js/koi/ui/dock.js` solo declara `dem`, `cuenca`, `hidro`, `hidraulica`, `socav`, `bati`, `estructuras`. Recomendacion: o se elimina como legacy, o se restaura como panel visible con un host real.

4. Los procesos con prerequisitos deberian mostrar un estado visible antes de ejecutarse: punto activo, tramo activo, DEM/base, eje del cauce, dominio 2D, malla, hidrograma de entrada y resultado previo. Hoy varios existen, pero la auditoria muestra que el usuario todavia puede quedar buscando "otra ventana".

## Verificacion local en navegador

Servidor usado: `python serve.py 8766`  
URL abierta: `http://127.0.0.1:8766/`  
Resultado: la web carga correctamente con titulo `koi-flow - Estudios hidrologico-hidraulicos`.

Observaciones reales de la pagina:

- El menu superior expone 36 acciones `data-action`, coincidentes con la matriz auditada: Archivo, Editar, Ver, Analisis y Ayuda.
- La barra lateral izquierda muestra la jerarquia esperada: `Proyecto nuevo -> Tramos -> Puntos de analisis`, mas grupos de cuencas delineadas, red de drenaje, estaciones DGA, referencias e importados.
- El dock derecho inicia colapsado como `PANELES`. Al abrirlo se ven los tabs `Cuenca`, `Hidrologia`, `Hidraulica` y `Estructuras`.
- El DOM del dock contiene los hosts `dem`, `cuenca`, `hidro`, `bati`, `hidraulica`, `socav` y `estructuras`. No existe host `flujo2d`, por lo que el panel legacy `Flujo2D` no queda expuesto.
- Al entrar a `Hidraulica`, la vista inicial del panel `bati` muestra primero `Importar CAD (DXF)` y `Usar DEM base de la vista`. En una sesion limpia todavia no aparecen motor 1D/2D ni Momentum 2D, porque dependen de cumplir ese prerequisito de geometria/DEM.

Comparacion con la auditoria: la matriz queda validada. El ajuste importante es de UX/documentacion: Momentum 2D no debe describirse como ventana directa; debe indicarse como capacidad interna del flujo hidraulico 2D, visible despues de preparar batimetria/DEM y dominio/malla.

## Como transformar koi-flow en aplicacion nativa Windows manteniendo la web

La recomendacion es mantener una sola interfaz web y empaquetarla como escritorio con **Tauri v2**. Tauri usa WebView2 en Windows, genera instaladores livianos y permite mover procesos pesados a comandos nativos o sidecars. Electron tambien sirve, pero normalmente consume mas memoria y no ataca por si solo el problema de flows densos.

Punto importante: empaquetar la web como app nativa no resuelve automaticamente la lentitud si todo sigue corriendo en el mismo motor JS/DOM. Para mejorar flows densos hay que separar la arquitectura:

```text
koi-flow web actual
  -> interfaz, mapa, edicion, reportes ligeros

adaptador runtime
  -> browser: File API, Web Workers, descargas
  -> desktop: Tauri invoke, dialogos nativos, filesystem local

compute nativo / sidecars
  -> Momentum 2D
  -> morfodinamica 2D
  -> procesamiento DEM/mallas
  -> importaciones grandes DXF/KMZ
  -> reportes pesados y exportaciones

almacenamiento local
  -> proyectos .koi
  -> cache de DEM, mallas, estaciones y resultados
```

### Ruta de implementacion recomendada

1. Mantener el repo web como fuente principal. La version web sigue funcionando serverless en navegador.
2. Crear una capa `runtime` en JS con operaciones abstractas: abrir archivo, guardar archivo, listar cache, ejecutar solver pesado, exportar resultado.
3. En navegador, esa capa usa `File API`, `Blob`, `fetch`, `IndexedDB` y `Web Workers`.
4. En Windows/Tauri, la misma capa llama `window.__TAURI__.core.invoke(...)` para operaciones nativas.
5. Mover primero los procesos mas pesados:
   - `worker_momentum2d.js`
   - morfodinamica 2D
   - generacion de mallas/dominios grandes
   - lectura/procesamiento de DXF o DEM pesados
6. Guardar proyectos como archivo local `.koi` con referencias a caches binarias grandes, en vez de meter todo el flow en memoria del navegador.
7. Construir instaladores Windows `.msi` o `.exe` desde CI.

### Estructura sugerida

```text
koi-flow/
  index.html
  css/
  js/
  data/
  src-tauri/
    tauri.conf.json
    src/
      main.rs
      commands/
        project.rs
        compute.rs
        files.rs
  native/
    solvers/
      momentum2d/
      morfo2d/
```

### Comandos base para iniciar Tauri

Este repo no tiene `package.json` actualmente, asi que primero conviene agregar una capa minima de tooling Node solo para desarrollo/empaquetado:

```powershell
npm init -y
npm install -D @tauri-apps/cli
npm install @tauri-apps/api
npx tauri init
npx tauri dev
npx tauri build
```

En `tauri.conf.json`, la app puede apuntar al servidor local de desarrollo (`http://localhost:8766`) durante `dev` y a los archivos estaticos (`index.html`, `js`, `css`, `data`) durante `build`.

### Decision tecnica

- Para distribucion Windows y menor consumo base: **Tauri v2**.
- Para reutilizar mucho ecosistema Node dentro del proceso desktop: Electron.
- Para rendimiento real en flows densos: Tauri/Electron no basta; hay que pasar calculo pesado a Rust, C++ o WASM con workers/hilos, y mantener la UI solo para visualizacion/control.

## Proximos cambios recomendados

1. Agregar acceso directo visible `Analisis -> Momentum 2D`.
2. Decidir si `Flujo2D` se elimina o se convierte en panel real.
3. Agregar indicadores de prerequisitos por capacidad en el dock.
4. Crear `js/koi/runtime/` para preparar la dualidad web/desktop.
5. Crear una prueba de smoke UI que recorra todos los `data-action` del menu y confirme que abren panel/HUD o activan una herramienta.
