// ─────────────────────────────────────────────────────────────────────────────
// pipeline.js — orquesta la cadena hidrológica completa para un "caso" y devuelve
// un resultado estructurado para la UI. Corre el motor validado (mismos módulos que
// los tests). Orden del pipeline (MC-V3, zona árida):
//   línea de nieve → área pluvial → frecuencia PP → IDF → Tc →
//   caudales pluviales (REFERENCIALES) + transposición fluviométrica (GOBIERNA) →
//   caudales adoptados.
// ─────────────────────────────────────────────────────────────────────────────
import { analizar } from './frecuencia.js?v=8';
import { ppDiseno, intensidad, grunsky, tablaIDF } from './idf.js?v=8';
import * as TC from './tc.js?v=8';
import * as Q from './caudales.js?v=8';
import { transponer } from './transposicion.js?v=8';
import { caudalesHU } from './hidrograma.js?v=8';
import { lineaNieveTemperatura, lineaNieveLatitud } from './linea_nieve.js?v=8';
import { fetchJSON } from '../datos/fetch_json.js?v=8';

const TS = [2, 5, 10, 25, 50, 100, 150, 200];

export async function correrHidrologia(caso) {
  const coef = await fetchJSON('data/coef_hidro.json?v=8', { contexto: 'Coeficientes hidrológicos' });
  const out = { caso: caso.nombre, T: TS };

  // ── 1) Línea de nieve y área pluvial aportante ──
  const m = caso.morfometria;
  const Hlat = lineaNieveLatitud(m.lat);
  const Htemp = caso.nieve?.temperatura ? lineaNieveTemperatura(caso.nieve.temperatura) : null;
  const Hnieve = Math.max(Hlat, Htemp ?? 0);   // criterio MC: la más alta (maximiza Ap)
  const Ap = caso.nieve?.areaPluvial ?? m.A;   // sin DEM aún: Ap ≈ área total bajo la línea
  out.nieve = {
    candidatas: [{ metodo: 'Latitud (DGA 2.1)', H: Hlat }, ...(Htemp ? [{ metodo: 'Temperatura (Peña-Vidal)', H: Htemp }] : [])],
    Hnieve, areaTotal: m.A, areaPluvial: Ap, areaNival: m.A - Ap,
    nota: 'Sin curva hipsométrica (DEM pendiente) se adopta área pluvial = área total bajo la línea.',
  };

  // ── 2) Precipitación: análisis de frecuencia → PP de diseño (×1.10) ──
  const pp = caso.precipitacion;
  let ppDis, distPP, frec = null;
  if (pp?.file) {                              // serie disponible → análisis de frecuencia (para mostrar)
    const j = await fetchJSON(pp.file + '?v=8', { contexto: `Serie pluvial ${pp.estacion || ''}`.trim() });
    frec = analizar(Object.values(j.serie || j), { T: TS });
  }
  if (pp?.ppDisenoFijo) {                      // PP de diseño publicada (la serie cruda no reproduce el informe)
    ppDis = pp.ppDisenoFijo; distPP = (pp.dist || 'publicada') + ' (publicada)';
  } else {
    distPP = pp.dist && pp.dist !== 'mejor' ? pp.dist : frec.mejor;
    ppDis = ppDiseno(frec.resultados[distPP].quantiles, coef.idf.factor_varas_sanchez);
  }
  out.precipitacion = { estacion: pp?.estacion, distribucion: distPP, ppDiseno: ppDis, frecuencia: frec };

  // ── 3) IDF (referencial en zona árida) ──
  const coefIDF = coef.idf.estaciones[pp?.coefIDF] || coef.idf.estaciones.Putre;
  out.idf = { estacionCoef: pp?.coefIDF || 'Putre', tabla: tablaIDF(ppDis, coefIDF) };

  // ── 4) Tiempo de concentración ──
  const tc = TC.calcular({ L: m.L, S: m.S, A: m.A, H: m.H, Hm: m.Hm, CN: m.CN }, { adopcion: 'max' });
  out.tc = tc;

  // ── 5) Caudales pluviales (REFERENCIALES) ──
  const Itc = {}; for (const T of TS) Itc[T] = grunsky(ppDis[T], tc.adoptado);
  const pluvial = Q.calcular({ A: Ap, region: m.region || 'III', pp24: ppDis, Itc }, coef, TS);

  // ── 6) Transposición fluviométrica (GOBIERNA) ──
  let trans = null;
  if (caso.fluviometria) {
    const fv = caso.fluviometria;
    const patron = await fetchJSON(fv.file + '?v=8', { contexto: `Serie fluviométrica ${fv.estacion || ''}`.trim() });
    trans = transponer(patron, { Apx: Ap }, {
      Qc: fv.Qc_publicado, distribucion: fv.dist || 'lognormal', T: TS,
    });
  }

  // ── 7) Caudales adoptados (zona árida → gobierna el fluviométrico) ──
  const metodos = [...pluvial.metodos, ...(trans ? [trans] : [])];
  out.caudales = {
    pluvial, transposicion: trans,
    adopcion: Q.adoptar(metodos, TS, { zona: caso.zona || 'arida' }),
  };

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline COMPLETO en un PUNTO pinchado: usa la cuenca delineada (morfometría) y
// las estaciones DGA elegidas. Devuelve la MISMA estructura que correrHidrologia
// (la consume HydroPanel._render). La transposición fluviométrica gobierna.
//   cfg: { nombre, lat, morfometria:{A,L,Lg,S,H}, region, CN, zonaHU,
//          pp:{estacion, serie, dist?, coefIDF?}, fluvio:{estacion, serie, Apc, dist?} }
// ─────────────────────────────────────────────────────────────────────────────
export async function correrPipelinePunto(cfg) {
  const coef = await fetchJSON('data/coef_hidro.json?v=8', { contexto: 'Coeficientes hidrológicos' });
  const m = cfg.morfometria;
  const Ap = m.A;                                  // sin hipsometría: área pluvial ≈ área total
  const out = { caso: cfg.nombre, T: TS };

  // 1) Línea de nieve (informativa) y área pluvial
  const Hlat = lineaNieveLatitud(cfg.lat);
  out.nieve = {
    candidatas: [{ metodo: 'Latitud (DGA 2.1)', H: Hlat }],
    Hnieve: Hlat, areaTotal: m.A, areaPluvial: Ap, areaNival: 0,
    nota: 'Área pluvial ≈ área de la cuenca delineada (corte hipsométrico por línea de nieves pendiente).',
  };

  // 2) Precipitación de diseño desde la estación pluvial
  const anP = analizar(Object.values(cfg.pp.serie.serie || cfg.pp.serie), { T: TS });
  const distPP = cfg.pp.dist && cfg.pp.dist !== 'mejor' ? cfg.pp.dist : anP.mejor;
  const ppDis = ppDiseno(anP.resultados[distPP].quantiles, coef.idf.factor_varas_sanchez);
  out.precipitacion = { estacion: cfg.pp.estacion, distribucion: distPP, ppDiseno: ppDis, frecuencia: anP };

  // 3) IDF (referencial)
  const coefIDF = coef.idf.estaciones[cfg.pp.coefIDF] || coef.idf.estaciones.Putre;
  out.idf = { estacionCoef: cfg.pp.coefIDF || 'Putre', tabla: tablaIDF(ppDis, coefIDF) };

  // 4) Tiempo de concentración (morfometría de la cuenca)
  const tc = TC.calcular({ L: m.L, S: m.S, A: m.A, H: m.H, CN: cfg.CN }, { adopcion: 'max' });
  out.tc = tc;

  // 5) Caudales pluviales (referenciales) + Hidrograma Unitario
  const Itc = {}; for (const T of TS) Itc[T] = grunsky(ppDis[T], tc.adoptado);
  const pluvial = Q.calcular({ A: Ap, region: cfg.region || 'III', pp24: ppDis, Itc }, coef, TS);
  if (m.Lg) {
    const hu = caudalesHU({ L: m.L, Lg: m.Lg, S: m.S, A: Ap }, ppDis, cfg.CN || 75, cfg.zonaHU || 1);
    pluvial.metodos.push(hu);
  }

  // 6) Transposición fluviométrica (gobierna) — requiere Apc
  let trans = null;
  if (cfg.fluvio?.serie && cfg.fluvio.Apc > 0) {
    trans = transponer(
      { nombre: cfg.fluvio.estacion, area_km2: cfg.fluvio.Apc, serie: cfg.fluvio.serie.serie || cfg.fluvio.serie },
      { Apx: Ap }, { distribucion: cfg.fluvio.dist || 'mejor', T: TS },
    );
  }

  // 7) Adoptados (zona árida → gobierna el fluviométrico)
  out.caudales = {
    pluvial, transposicion: trans,
    adopcion: Q.adoptar([...pluvial.metodos, ...(trans ? [trans] : [])], TS, { zona: 'arida' }),
  };
  return out;
}
