// ─────────────────────────────────────────────────────────────────────────────
// estructuras_hud.js — abre el panel de Estructuras como VENTANA FLOTANTE (Fase E).
// El panel (EstructurasPanel) se reparenta al body del HUD: sigue pintando igual,
// solo cambia dónde vive (antes: dock.hosts.estructuras). Entra en la barra de
// tareas de HUD y tiene su "?" de ayuda contextual como cualquier ventana.
// ─────────────────────────────────────────────────────────────────────────────

export function abrirEstructurasHUD(koi, huds) {
  const estr = koi?.estr;
  if (!estr || !huds) return;
  const hud = huds.open('estructuras', { title: '🏗️ Estructuras', w: 400, h: 540 });
  // (Re)apunta el panel al body ACTUAL del HUD (si se cerró y reabrió, es otro nodo).
  estr.mountIn(hud.body);
  return hud;
}
