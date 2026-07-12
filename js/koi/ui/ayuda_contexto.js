// ─────────────────────────────────────────────────────────────────────────────
// ayuda_contexto.js — Panel de AYUDA CONTEXTUAL (Fase E de koi-flow).
// El panel derecho deja de ser workspace de análisis y pasa a mostrar la ayuda de
// la herramienta con FOCO: qué hace, qué insumos necesita, qué normas/fórmulas usa
// y los pasos. Cada HUD emite `ayuda:foco` al enfocarse y `ayuda:abrir` al pulsar
// su "?"; este módulo pinta la ayuda en dock.hosts.ayuda.
// ─────────────────────────────────────────────────────────────────────────────
import { bus } from './bus.js?v=13';

// Registro de ayuda por id de herramienta (mismo id con que se abre el HUD).
// { t: título · d: qué hace · insumos · normas · pasos }
const HELP = {
  tormenta: { t: 'Tormenta de diseño', d: 'Construye el hietograma de diseño (distribución temporal de la lluvia) para un período de retorno, a partir de la PP de diseño y las curvas IDF.',
    insumos: ['PP de diseño (o estación pluvial)', 'Período de retorno T', 'Duración y Δt', 'Patrón (bloques alternos / SCS)'],
    normas: ['Bloques alternos', 'Curvas IDF (Grunsky/DGA)'],
    pasos: ['Elige T y duración', 'Elige el patrón temporal', 'Genera el hietograma → queda como crecida del pipeline'] },
  convolucion: { t: 'Hidrograma de crecida (HU)', d: 'Convoluciona el hietograma con el hidrograma unitario (Linsley) para obtener el hidrograma de crecida de la cuenca.',
    insumos: ['Hietograma (tormenta de diseño)', 'Morfometría de la cuenca', 'CN / pérdidas'],
    normas: ['HU sintético Linsley', 'SCS-CN'],
    pasos: ['Ten lista la tormenta de diseño', 'Ajusta CN y Tc', 'Convoluciona → hidrograma de crecida'] },
  routing: { t: 'Tránsito en cauce (Muskingum)', d: 'Rutea un hidrograma aguas abajo por un tramo, atenuando y desfasando el pico (almacenamiento en el cauce).',
    insumos: ['Hidrograma de entrada', 'K (tiempo de tránsito)', 'x (factor de forma 0–0.5)'],
    normas: ['Muskingum (lineal)'],
    pasos: ['Carga o usa la crecida del pipeline', 'Ajusta K y x', 'Rutea → hidrograma de salida'] },
  embalse: { t: 'Embalse (laminación)', d: 'Lamina una crecida por un embalse: rutea el hidrograma con la curva cota-área-volumen del vaso y el vertedero (piscina nivelada / Puls).',
    insumos: ['Hidrograma de entrada', 'Curva cota-área-volumen (del DEM)', 'Cota y largo del vertedero, Cd'],
    normas: ['Puls modificado (piscina nivelada)'],
    pasos: ['Define el vaso (DEM)', 'Configura el vertedero', 'Rutea → atenuación del pico'] },
  red: { t: 'Red de cuencas (HMS-lite)', d: 'Encadena subcuencas y tramos (aportes + tránsito) para obtener el hidrograma en la salida de una red, estilo HEC-HMS.',
    insumos: ['Subcuencas con su hidrograma', 'Conexiones y tramos de tránsito'],
    normas: ['HU + Muskingum encadenados'],
    pasos: ['Arma la topología (nodos/tramos)', 'Asigna hidrogramas', 'Corre la red'] },
  continuo: { t: 'Continua + deshielo (HMS-lite)', d: 'Simulación continua con balance de humedad y aporte de deshielo (grado-día) para series largas.',
    insumos: ['Serie de PP y temperatura', 'Parámetros de suelo y deshielo'],
    normas: ['Grado-día (deshielo)', 'Balance de humedad'],
    pasos: ['Carga las series', 'Ajusta parámetros', 'Corre la simulación continua'] },
  calibracion: { t: 'Calibración (Nelder-Mead)', d: 'Ajusta automáticamente los parámetros del modelo minimizando el error contra una serie observada.',
    insumos: ['Serie observada', 'Parámetros a calibrar y rangos'],
    normas: ['Nelder-Mead (símplex)', 'Nash-Sutcliffe'],
    pasos: ['Elige parámetros y rangos', 'Corre la optimización', 'Revisa el ajuste (NSE)'] },
  modclark: { t: 'ModClark grillado (HMS-lite)', d: 'Transformación lluvia-caudal distribuida por celdas (tiempo-área grillado) — captura lluvia no uniforme.',
    insumos: ['Grilla de PP', 'Grilla de tiempo de viaje', 'Coeficiente de almacenamiento R'],
    normas: ['ModClark (Clark distribuido)'],
    pasos: ['Prepara las grillas', 'Ajusta Tc y R', 'Corre → hidrograma'] },
  alcantarilla: { t: 'Alcantarilla (FHWA HDS-5)', d: 'Dimensiona/verifica una alcantarilla en control de entrada y de salida, y da el nivel de agua aguas arriba (headwater).',
    insumos: ['Caudal de diseño Q', 'Geometría (forma, D/ancho, largo, pendiente)', 'Material (n, Ke)'],
    normas: ['FHWA HDS-5', 'MC 3.707'],
    pasos: ['Ingresa Q y la geometría', 'Calcula → HW, control gobernante y velocidad'] },
  'puente-presion': { t: 'Puente (presión / vertedero)', d: 'Evalúa un puente que se presuriza o vierte por sobre el tablero: régimen, afección (remanso) y caudales por el vano y por sobre la calzada.',
    insumos: ['Q de diseño', 'Geometría del vano y del tablero', 'Cotas y coeficientes'],
    normas: ['HEC-RAS (pressure/weir flow)', 'MC 3.707'],
    pasos: ['Define el vano y el tablero', 'Calcula → régimen, afección, revancha'] },
  enrocado: { t: 'Enrocado / defensas (MC 3.708)', d: 'Dimensiona la protección de ribera (tamaño de roca D50, espesor y talud) para la velocidad/tensión del flujo.',
    insumos: ['Velocidad o eje hidráulico', 'Talud y ángulo de reposo', 'Densidad de la roca'],
    normas: ['MC 3.708', 'Isbash / Maynord (USACE)'],
    pasos: ['Toma V del eje 1D/2D', 'Calcula D50 y espesor', 'Verifica el talud'] },
  verificaciones: { t: 'Verificaciones (T · revancha)', d: 'Comprueba que la obra cumple el período de retorno de diseño y la revancha (gálibo) mínimos exigidos.',
    insumos: ['WSE de diseño', 'Cota de la obra', 'T de diseño y de verificación'],
    normas: ['MC (períodos y revancha por tipo de obra)'],
    pasos: ['Ingresa T y las cotas', 'Verifica → cumple / no cumple + gálibo'] },
  degradacion: { t: 'Degradación a largo plazo', d: 'Estima el descenso del lecho a largo plazo (déficit de sedimento), insumo para fundar bajo la socavación total.',
    insumos: ['Caudal dominante', 'Granulometría (D50)', 'Pendiente y ancho'],
    normas: ['Capacidad de transporte (MPM/Engelund)'],
    pasos: ['Ingresa Q dominante y D50', 'Calcula la degradación'] },
  morfo1d: { t: 'Lecho móvil 1D (evolución)', d: 'Evoluciona el perfil del lecho en el tiempo (Exner 1D): erosión y depósito a lo largo del cauce durante una crecida.',
    insumos: ['Hidrograma', 'Secciones y pendiente', 'Granulometría'],
    normas: ['Exner + MPM (1D)'],
    pasos: ['Carga el hidrograma', 'Corre → erosión/depósito máx'] },
  'sismo-estribo': { t: 'Sísmica de estribos (Mononobe-Okabe)', d: 'Empuje sísmico sobre el estribo y factores de seguridad al deslizamiento y volcamiento.',
    insumos: ['Geometría del estribo', 'Zona sísmica / kh', 'Relleno (φ, γ)'],
    normas: ['Mononobe-Okabe', 'MC / AASHTO sísmico'],
    pasos: ['Define el estribo y la zona sísmica', 'Calcula → PAE, FS deslizamiento/volcamiento'] },
  breach: { t: 'Rotura de presa / relave (Froehlich)', d: 'Genera el hidrograma de rotura por volumen y brecha (Froehlich/MacDonald); si es relave, deja la reología para el 2D.',
    insumos: ['Volumen Vw y altura de brecha', 'Modo de falla', 'Material (agua / relave: τy, μ, Cv)'],
    normas: ['Froehlich (2008/1995)', 'MacDonald-L-M', 'DS 50 / GISTM'],
    pasos: ['Coloca la presa/depósito', 'Configura brecha y material', 'Genera → crecida de rotura'] },
  hidraulica: { t: 'Hidráulica 1D / 2D', d: 'Espacio de trabajo hidráulico: importa batimetría (DXF) o usa el DEM, traza el eje y las secciones, corre el eje 1D (remanso) o la malla y los solvers 2D, y exporta a HEC-RAS.',
    insumos: ['Batimetría (DXF) o DEM del terreno', 'Eje del cauce y secciones', 'Caudal / crecida', 'Rugosidad, régimen, dominio 2D'],
    normas: ['Manning / standard-step (1D)', 'Onda difusiva y Saint-Venant (2D)', 'Export HEC-RAS (.sdf/.asc/.prj)'],
    pasos: ['Importa el DXF o usa el DEM', 'Traza eje y secciones', 'Corre 1D (remanso) o 2D (menú Correr)', 'Exporta / muestrea velocidad para socavación'] },
  estructuras: { t: 'Estructuras', d: 'Coloca y edita las piezas del cruce (tablero, vigas, pilas, estribos, defensas, alcantarilla) en planta 2D; se ven y mueven en 3D y entran al análisis 1D/2D como en HEC-RAS.',
    insumos: ['Eje / dominio del cauce', 'Relieve (para elevar al terreno)', 'Geometría de cada pieza'],
    normas: ['Estampado en terreno + pila en la sección (HEC-RAS-like)'],
    pasos: ['Elige el tipo de pieza', 'Colócala en el mapa (planta)', 'Ajústala / elévala al terreno', 'Vela en 3D y en el análisis del cruce'] },
  correr: { t: 'Correr (pre-vuelo del solver)', d: 'Revisa que el plan esté listo (malla/secciones + eje con entrada/salida + caudal), ajusta la ventana de simulación y lanza el solver pesado, mostrando el progreso.',
    insumos: ['Malla 2D (o secciones 1D)', 'Eje con entrada/salida', 'Caudal o crecida'],
    normas: ['Onda difusiva / Saint-Venant 2D · standard-step 1D'],
    pasos: ['Completa lo marcado con ✕', 'Ajusta Δt/tiempo/solver', 'Corre → resultado + peligrosidad'] },
};

const li = (arr) => arr.map((x) => `<li>${x}</li>`).join('');

function plantilla(h, title, id) {
  if (!h) {
    return `<div class="ay-wrap">
      <div class="ay-hd"><i class="ti ti-help-circle"></i> ${title ? title : 'Ayuda contextual'}</div>
      <p class="ay-d">${title
        ? 'Esta herramienta aún no tiene una ficha de ayuda detallada. Revisa las notas dentro de su ventana (al pie del formulario) para los insumos y la metodología.'
        : 'Abre o enfoca una herramienta (una ventana flotante de análisis) y aquí verás su ayuda: qué hace, qué insumos necesita, qué normas usa y los pasos. También puedes pulsar el <b>?</b> en el encabezado de cualquier ventana.'}</p>
    </div>`;
  }
  return `<div class="ay-wrap">
    <div class="ay-hd"><i class="ti ti-help-circle"></i> ${h.t}</div>
    <p class="ay-d">${h.d}</p>
    ${h.insumos?.length ? `<div class="ay-sec">Insumos</div><ul class="ay-list">${li(h.insumos)}</ul>` : ''}
    ${h.normas?.length ? `<div class="ay-sec">Métodos / normas</div><ul class="ay-list ay-norm">${li(h.normas)}</ul>` : ''}
    ${h.pasos?.length ? `<div class="ay-sec">Pasos</div><ol class="ay-list ay-steps">${li(h.pasos)}</ol>` : ''}
    <p class="ay-foot">Herramienta: <code>${id}</code> · el detalle fino está en las notas dentro de su ventana.</p>
  </div>`;
}

// Monta el panel de ayuda en dock.hosts.ayuda y lo cablea al foco de los HUD.
export function montarAyudaContextual(dock, huds) {
  const host = dock?.hosts?.ayuda;
  if (!host) return;
  const render = (id, title) => { host.innerHTML = plantilla(HELP[id] || null, title, id); };
  render(null, null);   // estado inicial (sin foco)
  // El foco de una ventana actualiza la ficha (aunque el panel esté oculto: es barato).
  bus.on('ayuda:foco', ({ id, title } = {}) => render(id, title));
  // El "?" de una ventana además ABRE el panel de ayuda.
  bus.on('ayuda:abrir', ({ id, title } = {}) => { render(id, title); dock.show('ayuda'); });
}
