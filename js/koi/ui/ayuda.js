// ─────────────────────────────────────────────────────────────────────────────
// ayuda.js — HUD de Ayuda + Tutorial (koi-flow). Explica cómo hacer cada análisis y
// un tutorial paso a paso que replica el flujo del informe de referencia (S17).
// Propiedad: JPReyes / Conmuta.cl.
// ─────────────────────────────────────────────────────────────────────────────

const COMO = [
  ['Proyectos', 'Barra izquierda ▸ botón <b>▾</b> junto al nombre: <b>Nuevo</b> (vacío), abrir/borrar guardados. Importa tus tramos (KMZ/KML) y <b>Guarda</b>: persiste el proyecto (localStorage + .json).'],
  ['Cuenca', 'Barra izquierda ▸ <b>Punto</b> → clic en el mapa. En la pestaña <b>Cuenca</b> pulsa delinear: traza la cuenca (D8) y su morfometría. Ajusta el <b>snap</b> y el suavizado.'],
  ['Estaciones DGA', 'Se cargan solas alrededor de donde miras. <b>Clic en una estación</b> → HUD flotante con su serie de máximos anuales, estadísticos y el ajuste de distribuciones.'],
  ['Batimetría / DEM', 'Pestaña <b>Hidráulica</b> ▸ importar <b>DXF</b> → elegir capas → construir DEM → colocarlo (arrastrar ✛) y <b>auto-elevar</b>. Fusiónalo con el relieve para el 3D.'],
  ['Eje y secciones', 'En <b>Hidráulica</b> dibuja el <b>eje del cauce</b> (define la dirección del flujo) y traza <b>secciones</b> (clic: extremos + bordes; doble-clic termina). Arrastra los vértices para ajustarlas.'],
  ['Motor 1D / 2D', 'Selector <b>Motor</b>: <b>1D</b> (Manning + eje por remanso) o <b>2D</b> (onda difusiva). En 2D dibuja el <b>dominio</b>, genera la <b>malla</b> (más fina en el cauce) y simula; luego <b>muestrea</b> v en las secciones para la socavación con velocidad real.'],
  ['Socavación', 'Automática por sección: general (Lischtvan-Lebediev por franjas + Neill) y local en pila (5 métodos MC). Ingresa D50, estratos y roca; una pila estructural que cruce la sección aporta su ancho.'],
  ['Estructuras', 'Pestaña <b>Estructuras</b>: elige tipo (tablero, pila circular/rectangular, estribo, defensa, alcantarilla), clic para ubicar, edita dimensiones, <b>elévalo al terreno</b>. Muévelo arrastrando en 2D o en 3D. Se integran al análisis (2D: terreno; 1D: angostamiento + pila).'],
  ['GIS creado', 'Todo lo creado (DEM, eje, dominio, malla, estructuras, cuencas, referencias) aparece en la barra izquierda para <b>mostrar/ocultar/borrar</b>.'],
  ['Informe', 'Botón <b>📄 Informe</b>: genera el documento con metodologías, fórmulas, tablas y figuras de todos los análisis; imprímelo a PDF.'],
];

const TUTORIAL = [
  'Cargar el <b>demo (Tarapacá S17)</b> desde la barra de proyectos, o crear uno nuevo.',
  'Colocar un <b>punto</b> en el cauce y <b>delinear la cuenca</b> → revisar área y morfometría (informe §1).',
  'Revisar las <b>estaciones DGA</b> cercanas y su análisis de frecuencia (clic en la estación) (informe §2).',
  'Importar la <b>batimetría DXF</b>, construir y colocar el <b>DEM</b>, y fusionarlo con el relieve (3D).',
  'Dibujar el <b>eje</b> y las <b>secciones</b>; calcular el <b>eje hidráulico</b> (Manning + remanso) (informe §3).',
  'Calcular la <b>socavación</b> general y local por sección con la granulometría (informe §4).',
  'Colocar el <b>puente</b> (tablero + pilas + estribos) sobre el eje y ver la interferencia (informe §5).',
  'Dibujar el <b>dominio 2D</b>, generar la <b>malla</b> y <b>simular</b> la inundación; muestrear velocidades (informe §6).',
  'Ver el <b>relieve 3D</b> con el cauce y las estructuras (informe §7).',
  'Generar el <b>informe</b> y exportar a PDF.',
];

export function abrirAyudaHUD(huds) {
  const como = COMO.map(([t, d]) => `<div class="ay-item"><b>${t}</b><span>${d}</span></div>`).join('');
  const tut = TUTORIAL.map((t, i) => `<li>${t}</li>`).join('');
  const html = `
    <div class="ay-tabs"><button class="ay-tb active" data-t="como">Cómo se hace</button><button class="ay-tb" data-t="tut">Tutorial (informe S17)</button></div>
    <div class="ay-pane" data-p="como">${como}</div>
    <div class="ay-pane" data-p="tut" hidden><p class="hud-note">Flujo que reproduce el informe de referencia <b>“03 Hidrología e Hidráulica S17”</b>:</p><ol class="ay-ol">${tut}</ol></div>
    <p class="hud-note">koi-flow — software propiedad de <b>JPReyes / Conmuta.cl</b>.</p>`;
  const hud = huds.open('ayuda', { title: '❓ Ayuda y tutorial', w: 440, h: 500, html });
  hud.body.querySelectorAll('.ay-tb').forEach((b) => b.addEventListener('click', () => {
    hud.body.querySelectorAll('.ay-tb').forEach((x) => x.classList.toggle('active', x === b));
    hud.body.querySelectorAll('.ay-pane').forEach((p) => { p.hidden = p.dataset.p !== b.dataset.t; });
  }));
  return hud;
}
