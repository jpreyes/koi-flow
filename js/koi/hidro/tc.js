// ─────────────────────────────────────────────────────────────────────────────
// tc.js — Tiempo de concentración (koi-flow, Fase 1). Métodos del MC-V3 / DGA:
// Kirpich, California Culverts Practice, Giandotti, Normas Españolas y SCS, con
// reglas de aplicabilidad. Devuelve cada tc (horas) + promedio de válidos + adoptado.
// Validado vs informe S17 (Kirpich 9.54 h, Normas Españolas 20.70 h).
//
// Parámetros morfométricos:
//   L  = longitud cauce principal [km]
//   S  = pendiente media del cauce [m/m]
//   A  = área de la cuenca [km²]
//   H  = desnivel máximo de la cuenca [m]
//   Hm = desnivel entre cota media de la cuenca y la salida [m]
//   CN = curva número (SCS, cuencas rurales)
// ─────────────────────────────────────────────────────────────────────────────

// Kirpich: tc[min] = 0.0195 · L_m^0.77 · S^-0.385   → cuencas medianas con pendiente.
export function kirpich({ L, S }) {
  const tc = (0.0195 * Math.pow(L * 1000, 0.77) * Math.pow(S, -0.385)) / 60;
  return { metodo: 'Kirpich', tc, aplica: true };
}

// California Culverts Practice: tc[h] = 0.95 · (L³/H)^0.385  → cuencas montañosas pequeñas.
export function california({ L, H, A }) {
  const tc = 0.95 * Math.pow((L * L * L) / H, 0.385);
  return { metodo: 'California (C.C.P.)', tc, aplica: A != null ? A <= 250 : true, motivo: 'cuencas montañosas pequeñas' };
}

// Giandotti: tc[h] = (4√A + 1.5L)/(0.8√Hm)  → cuencas con pendiente, A media.
export function giandotti({ A, L, Hm }) {
  const aplica = Hm != null && Hm > 0;
  const tc = aplica ? (4 * Math.sqrt(A) + 1.5 * L) / (0.8 * Math.sqrt(Hm)) : NaN;
  return { metodo: 'Giandotti', tc, aplica, motivo: aplica ? '' : 'requiere desnivel a cota media (Hm)' };
}

// Normas Españolas: tc[h] = 0.3 · (L / S^0.25)^0.76  → cuencas de montaña, grandes pendientes.
export function normasEspanolas({ L, S }) {
  const tc = 0.3 * Math.pow(L / Math.pow(S, 0.25), 0.76);
  return { metodo: 'Normas Españolas', tc, aplica: true };
}

// SCS (1975): tc[h] = (3.28·L_m)^0.8 · ((1000/CN − 9)^0.7) / (1140 · S_%^0.5)  → cuencas rurales.
export function scs({ L, S, CN }) {
  const aplica = CN != null && CN > 0;
  const S_pct = S * 100;
  const tc = aplica ? Math.pow(3.28 * L * 1000, 0.8) * Math.pow(1000 / CN - 9, 0.7) / (1140 * Math.pow(S_pct, 0.5)) : NaN;
  return { metodo: 'SCS (1975)', tc, aplica, motivo: aplica ? '' : 'requiere curva número CN (cuenca rural)' };
}

// Calcula todos, el promedio de los válidos y el tc adoptado.
// adopcion: 'max' (conservador, por defecto) | 'promedio' | 'min'.
export function calcular(params, { adopcion = 'max' } = {}) {
  const metodos = [kirpich(params), california(params), giandotti(params), normasEspanolas(params), scs(params)];
  const validos = metodos.filter((m) => m.aplica && isFinite(m.tc) && m.tc > 0);
  const tcs = validos.map((m) => m.tc);
  const promedio = tcs.length ? tcs.reduce((a, b) => a + b, 0) / tcs.length : NaN;
  let adoptado;
  if (adopcion === 'promedio') adoptado = promedio;
  else if (adopcion === 'min') adoptado = Math.min(...tcs);
  else adoptado = Math.max(...tcs);
  return { metodos, validos, promedio, adoptado, adopcion };
}
