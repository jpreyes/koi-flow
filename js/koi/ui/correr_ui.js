// ─────────────────────────────────────────────────────────────────────────────
// correr_ui.js — diálogo "Correr" (patrón HEC-RAS Compute) para koi-flow.
// Separa DEFINIR (paneles de Hidráulica) de CORRER (este diálogo): un pre-vuelo
// que revisa que el plan esté listo (malla/secciones + eje con entrada/salida),
// deja ajustar la ventana de simulación (Δt, pasos/tiempo, solver…) y lanza el
// solver pesado mostrando el progreso en vivo, en UN solo lugar.
//
// No reimplementa los solvers: aplica los parámetros a los inputs del panel de
// Hidráulica (bati_ui) y dispara su botón de correr, reflejando aquí el estado.
// Vive como HUD → aparece en la barra de tareas de HUD.
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Especificación por solver: cómo enfocarlo en el panel, su botón/estado de
// corrida y los parámetros de la ventana de simulación que exponemos aquí.
const SOLVERS = {
  remanso1d: {
    titulo: '📐 Eje hidráulico 1D · remanso', dosD: false,
    focus: 'remanso1d', run: '#bp-remanso', estado: '#bp-remanso-out',
    controles: [
      { id: 'bp-reg', label: 'Régimen', tipo: 'sel', opts: [['auto', 'Auto'], ['sub', 'Subcrítico'], ['super', 'Supercrítico'], ['mixto', 'Mixto (resalto)']] },
      { id: 'bp-wse', label: 'WSE borde [m]', tipo: 'num', def: '', ph: 'normal' },
    ],
    ventana: () => 'Standard-step sobre todas las secciones (flujo permanente).',
  },
  difusiva: {
    titulo: '💧 Onda difusiva 2D · permanente', dosD: true,
    focus: 'difusiva', run: '#bp-2d-sim', estado: '#bp-2d-simst',
    controles: [
      { id: 'f2-dt', label: 'Δt [s]', tipo: 'num', def: 60 },
      { id: 'f2-steps', label: 'Pasos máx', tipo: 'num', def: 300 },
      { id: 'f2-solver', label: 'Solver', tipo: 'sel', opts: [['banda', 'Cholesky banda (directo)'], ['pcg', 'PCG IC0 (JS)'], ['wasm', 'PCG IC0 (WASM · C++)']] },
    ],
    ventana: (v) => `≈ ${((+v['f2-dt'] * +v['f2-steps']) / 60 || 0).toFixed(0)} min simulados como máx (corta al converger a permanente).`,
  },
  transiente: {
    titulo: '🎞️ Transiente difusiva 2D', dosD: true,
    focus: 'transiente', run: '#bp-2d-trans', estado: '#bp-2d-trans-st', crecida: 'bp-t-crec',
    controles: [
      { id: 'bp-t-qp', label: 'Q pico [m³/s]', tipo: 'num', def: 100 },
      { id: 'bp-t-tb', label: 't base [h]', tipo: 'num', def: 4 },
      { id: 'bp-t-dt', label: 'Δt [s]', tipo: 'num', def: 60 },
      { id: 'bp-t-crec', label: 'Usar la crecida del pipeline (HU/rotura)', tipo: 'chk' },
    ],
    ventana: (v) => `Hidrograma → animación de ${(+v['bp-t-tb'] || 0)} h.`,
  },
  momentum: {
    titulo: '🌊 Momentum 2D · Saint-Venant', dosD: true,
    focus: 'momentum', run: '#bp-2d-mom', estado: '#bp-2d-momst', crecida: 'bp-m-crec',
    controles: [
      { id: 'bp-m-t', label: 'Tiempo a simular [s]', tipo: 'num', def: 600 },
      { id: 'bp-m-cfl', label: 'CFL', tipo: 'num', def: 0.4 },
      { id: 'bp-m-crec', label: 'Usar la crecida del pipeline (HU/rotura)', tipo: 'chk' },
    ],
    ventana: (v) => `${(+v['bp-m-t'] || 0)} s de tiempo físico (paso adaptado por CFL). Corre en segundo plano (Web Worker).`,
  },
  morfo: {
    titulo: '⛰️ Morfodinámico 2D · lecho móvil', dosD: true,
    focus: 'morfo', run: '#bp-2d-mf', estado: '#bp-2d-mfst',
    controles: [
      { id: 'bp-mf-t', label: 'Tiempo a simular [s]', tipo: 'num', def: 600 },
      { id: 'bp-mf-cfl', label: 'CFL', tipo: 'num', def: 0.4 },
      { id: 'bp-mf-acople', label: 'Acople', tipo: 'sel', opts: [['desacoplado', 'Desacoplado (rápido)'], ['acoplado', 'Acoplado (cada paso)']] },
    ],
    ventana: (v) => `${(+v['bp-mf-t'] || 0)} s de flujo + lecho móvil (Exner). Corre en segundo plano.`,
  },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Caudal actual del reach (del formulario si el panel está abierto, si no del reach).
function qActual(b) {
  const el = b?.body?.querySelector?.('#bp-q');
  const v = el ? +el.value : NaN;
  if (v > 0) return Math.round(v);
  const q = b?.cauces?.[b.iCauce]?.Q;
  return q > 0 ? Math.round(q) : 100;
}

// Checklist de preparación del plan. Los que llevan `bloquea:true` impiden correr.
function revisar(koi, key) {
  const b = koi.bati || {};
  const spec = SOLVERS[key];
  const out = [];
  if (spec.dosD) {
    const mesh = b.mesh2d;
    out.push({ bloquea: true, ok: !!mesh, label: 'Malla 2D generada',
      detalle: mesh ? `${mesh.meta.nNodos} nodos · ${(mesh.meta.area_m2 / 1e4).toFixed(1)} ha` : 'sin generar',
      fix: mesh ? null : { txt: 'Generar la malla', fn: () => b.focusTool?.('malla2d') } });

    let ejeOk = (b.eje?.length || 0) >= 2, borde = false, det = 'sin dibujar';
    if (ejeOk) {
      det = `${b.eje.length} vértices`;
      if (mesh) { try { const { entrada, salida } = b._bordes2D(mesh); borde = entrada.length > 0 && salida.length > 0; det += borde ? ' · toca el borde (entrada/salida)' : ' · NO toca el borde del dominio'; } catch { borde = false; } }
      else borde = true;   // sin malla aún no se puede verificar el borde; no bloquear por eso
    }
    out.push({ bloquea: true, ok: ejeOk && borde, label: 'Eje del cauce (entrada/salida)', detalle: det,
      fix: (ejeOk && borde) ? null : { txt: 'Ir al panel a dibujar/ajustar el eje', fn: () => b.focusTool?.(spec.focus) } });

    const usaCrec = !!spec.crecida && koi.hidrogramaCrecida?.length;
    out.push({ bloquea: false, ok: true, label: 'Caudal de entrada',
      detalle: usaCrec ? `crecida HU disponible (${koi.hidrogramaCrecida.length} pasos) · o Q ≈ ${qActual(b)} m³/s` : `Q ≈ ${qActual(b)} m³/s` });
  } else {
    const nsec = b.secciones?.length || 0;
    out.push({ bloquea: true, ok: nsec >= 2, label: 'Secciones transversales', detalle: `${nsec} trazadas (mínimo 2)`,
      fix: nsec >= 2 ? null : { txt: 'Ir al panel a trazar secciones', fn: () => b.focusTool?.('remanso1d') } });
    out.push({ bloquea: false, ok: (b.eje?.length || 0) >= 2, label: 'Eje (ordena las secciones)', detalle: (b.eje?.length || 0) >= 2 ? `${b.eje.length} vértices` : 'opcional (usa el thalweg)' });
    out.push({ bloquea: false, ok: true, label: 'Caudal', detalle: `Q ≈ ${qActual(b)} m³/s` });
  }
  return out;
}

// Valores actuales de los controles (del panel si existen; si no, el default).
function leerValores(b, spec) {
  const v = {};
  for (const c of spec.controles) {
    const el = b?.body?.querySelector?.('#' + c.id);
    if (el) v[c.id] = el.type === 'checkbox' ? el.checked : el.value;
    else v[c.id] = c.tipo === 'chk' ? false : (c.def ?? '');
  }
  return v;
}

function controlHTML(c, val) {
  if (c.tipo === 'chk') return `<label class="cr-chk"><input type="checkbox" id="cr-${c.id}" ${val ? 'checked' : ''}> ${esc(c.label)}</label>`;
  if (c.tipo === 'sel') return `<label class="cr-f"><span>${esc(c.label)}</span><select id="cr-${c.id}">${c.opts.map(([v, t]) => `<option value="${v}" ${String(val) === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  return `<label class="cr-f"><span>${esc(c.label)}</span><input id="cr-${c.id}" type="number" value="${esc(val ?? '')}" ${c.ph ? `placeholder="${c.ph}"` : ''}></label>`;
}

function cuerpo(koi, key) {
  const spec = SOLVERS[key];
  const checks = revisar(koi, key);
  const listo = checks.every((c) => !c.bloquea || c.ok);
  const vals = leerValores(koi.bati, spec);
  const filas = checks.map((c, i) => `
    <div class="cr-check ${c.ok ? 'ok' : (c.bloquea ? 'bad' : 'warn')}">
      <span class="cr-dot">${c.ok ? '✓' : (c.bloquea ? '✕' : '•')}</span>
      <span class="cr-ck-lbl">${esc(c.label)}<span class="cr-ck-det">${esc(c.detalle)}</span></span>
      ${c.fix ? `<button class="cr-fix" data-fix="${i}">${esc(c.fix.txt)}</button>` : ''}
    </div>`).join('');
  const ctrls = spec.controles.map((c) => controlHTML(c, vals[c.id])).join('');
  return `
    <div class="cr-plan">
      <div class="cr-hd">Plan de cálculo</div>
      <div class="cr-checks">${filas}</div>
    </div>
    <div class="cr-hd">Ventana de simulación</div>
    <div class="cr-form">${ctrls}</div>
    <p class="cr-note">${esc(spec.ventana(vals))}</p>
    <div class="cr-actions">
      <button class="cr-refresh" id="cr-refresh" title="Volver a revisar el estado">↻ Revisar</button>
      <button class="cr-run" id="cr-run" ${listo ? '' : 'disabled'}>▶ Correr</button>
    </div>
    ${listo ? '' : '<p class="cr-note cr-blk">Completa lo marcado con ✕ para poder correr.</p>'}
    <div class="cr-log" id="cr-log" hidden></div>
    <div class="cr-done" id="cr-done" hidden></div>`;
}

// Resumen tras terminar la corrida, leído del estado de bati (campos conocidos).
function resumen(koi, key) {
  const b = koi.bati;
  const r = key === 'momentum' ? b.resultMom2d : key === 'morfo' ? b.resultMorfo2d : key === 'remanso1d' ? b._remanso : b.result2d;
  let kv = '';
  if (r) {
    if (key === 'remanso1d' && r.perfil?.length) {
      const wse = Math.max(...r.perfil.map((x) => x.WSE));
      kv = `<div><span>Secciones</span><b>${r.perfil.length}</b></div><div><span>WSE máxima</span><b>${wse.toFixed(2)} m</b></div>`;
    } else if (r.hmax != null) {
      kv = `<div><span>Calado máximo</span><b>${(+r.hmax).toFixed(2)} m</b></div>${r.Vmax != null ? `<div><span>Velocidad máxima</span><b>${(+r.Vmax).toFixed(2)} m/s</b></div>` : ''}`;
    }
  }
  return `<div class="cr-doneban">✓ Corrida terminada.${kv ? `<div class="hp-kv" style="margin-top:6px">${kv}</div>` : ''}
    <button class="cr-ver" id="cr-ver">Ver el detalle en el panel de Hidráulica</button></div>`;
}

export function abrirCorrerDialog(koi, key) {
  const spec = SOLVERS[key];
  if (!spec) return;
  const huds = koi.huds;
  if (!huds) return;
  const hud = huds.open('correr', { title: `Correr · ${spec.titulo}`, w: 420, h: 470 });
  const pintar = () => {
    hud.setTitle(`Correr · ${spec.titulo}`);
    hud.setBody(cuerpo(koi, key));
    wire();
  };
  const wire = () => {
    const $ = (s) => hud.body.querySelector(s);
    const checks = revisar(koi, key);
    hud.body.querySelectorAll('[data-fix]').forEach((btn) => {
      const c = checks[+btn.dataset.fix];
      btn.addEventListener('click', () => { c?.fix?.fn?.(); setTimeout(pintar, 120); });
    });
    $('#cr-refresh')?.addEventListener('click', pintar);
    $('#cr-run')?.addEventListener('click', () => correr(koi, key, hud));
  };
  pintar();
  return hud;
}

async function correr(koi, key, hud) {
  const spec = SOLVERS[key];
  const b = koi.bati;
  const $ = (s) => hud.body.querySelector(s);
  const runBtn = $('#cr-run'), log = $('#cr-log'), done = $('#cr-done');
  if (!b) { if (log) { log.hidden = false; log.textContent = 'No hay panel de Hidráulica activo.'; } return; }

  // Enfoca el solver en el panel (motor + acordeón + inputs) y aplica los controles.
  b.focusTool(spec.focus);
  await sleep(70);
  for (const c of spec.controles) {
    const dst = b.body.querySelector('#' + c.id), src = $('#cr-' + c.id);
    if (!dst || !src) continue;
    if (c.tipo === 'chk') dst.checked = src.checked;
    else dst.value = src.value;
    dst.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (runBtn) runBtn.disabled = true;
  if (done) { done.hidden = true; done.innerHTML = ''; }
  if (log) { log.hidden = false; log.textContent = 'iniciando…'; }

  const objetivo = b.body.querySelector(spec.estado);
  let terminado = false;
  const finish = () => {
    if (terminado) return; terminado = true;
    if (runBtn) runBtn.disabled = false;
    if (done) { done.hidden = false; done.innerHTML = resumen(koi, key); done.querySelector('#cr-ver')?.addEventListener('click', () => b.focusTool(spec.focus)); }
  };
  let obs = null;
  if (objetivo) {
    obs = new MutationObserver(() => {
      const t = (objetivo.textContent || '').trim();
      if (t && log) log.textContent = t;
      if (/✓|✗|error/i.test(t)) { obs.disconnect(); finish(); }
    });
    obs.observe(objetivo, { childList: true, characterData: true, subtree: true });
  }

  // Dispara el botón de correr del panel (async: la difusiva/transiente son
  // síncronas; momentum/morfo corren en Web Worker y siguen emitiendo estado).
  b.body.querySelector(spec.run)?.click();

  // Red de seguridad: si no hay elemento de estado observable, cierra tras un tick.
  if (!objetivo) setTimeout(finish, 1500);
  // Para el 1D (salida directa a un <div>) no siempre llega texto con ✓: cierra al ver contenido.
  if (!spec.dosD && objetivo) setTimeout(() => { if (!terminado && (objetivo.textContent || '').trim()) { obs?.disconnect(); finish(); } }, 400);
}
