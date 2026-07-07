#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_dga.py — Conector de datos DGA para koi-flow (Fase 1).

Descarga las bases compiladas por el CR2 (Centro de Ciencia del Clima y la
Resiliencia), que recopilan los registros oficiales de la DGA, y genera:
  · data/estaciones_dga.json        catálogo de estaciones cercanas (BNA, lat/lon, periodo)
  · data/series/dga/<BNA>.json      serie de máximos anuales por estación (formato app)

Variables:
  pr    precipitación acumulada diaria  → máximo anual de PP diaria [mm]
  qflx  caudal medio diario             → máximo anual de caudal medio diario [m³/s]

Uso típico (cuenca de tramos 1 y 2, Quebrada de Tarapacá):
  python tools/fetch_dga.py --lon -69.08 --lat -19.94 --radio 60 --var pr
  python tools/fetch_dga.py --lon -69.08 --lat -19.94 --radio 120 --var qflx

Notas:
  - El máximo anual de PP diaria es la variable que consume el análisis de frecuencia.
  - El caudal CR2 es MEDIO DIARIO; para diseño la DGA usa el máximo INSTANTÁNEO
    (factor de conversión por zona homogénea). Aquí se entrega el máx. medio diario
    y se anota; aplicar el factor instantáneo en el módulo de caudales.
  - Fuente: https://www.cr2.cl/datos-de-precipitacion/ y /datos-de-caudales/
"""
import argparse, csv, io, json, math, os, re, sys, urllib.request, zipfile
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8")

# Páginas de descarga WPDM del CR2 (resuelven al .zip vía token wpdmdl).
FUENTES = {
    "pr":   {"landing": "https://www.cr2.cl/download/cr2_prdaily_2018-zip/",
             "referer": "https://www.cr2.cl/datos-de-precipitacion/",
             "tipo": "pluviometrica", "variable": "Máximo anual de PP diaria", "unidad": "mm"},
    "qflx": {"landing": "https://www.cr2.cl/download/cr2_qflxdaily_2018-zip/",
             "referer": "https://www.cr2.cl/datos-de-caudales/",
             "tipo": "fluviometrica", "variable": "Máximo anual de caudal medio diario", "unidad": "m3/s"},
}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _get(url, referer):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": referer})
    return urllib.request.urlopen(req, timeout=240).read()


def resolver_zip(var, cache_dir):
    """Resuelve el link real del .zip desde la página WPDM y lo descarga (con caché)."""
    f = FUENTES[var]
    os.makedirs(cache_dir, exist_ok=True)
    zpath = os.path.join(cache_dir, f"cr2_{var}.zip")
    if os.path.exists(zpath) and os.path.getsize(zpath) > 1_000_000:
        print(f"  (caché) {zpath}")
        return zpath
    print(f"  resolviendo link de descarga ({var})…")
    html = _get(f["landing"], f["referer"]).decode("utf-8", "ignore")
    m = re.search(r"wpdm-download-link[^>]*href='([^']+wpdmdl=[^']+)'", html)
    if not m:
        sys.exit("No se encontró el link de descarga WPDM (¿cambió la página del CR2?).")
    print(f"  descargando zip…")
    data = _get(m.group(1), f["referer"])
    with open(zpath, "wb") as fh:
        fh.write(data)
    print(f"  guardado {zpath} ({len(data)//1024//1024} MB)")
    return zpath


def miembros(zf):
    """Devuelve (data_txt, stations_txt) dentro del zip."""
    names = zf.namelist()
    st = next(n for n in names if n.endswith("_stations.txt"))
    dat = next(n for n in names if n.endswith(".txt") and not n.endswith("_stations.txt")
               and not n.endswith("_description.txt"))
    return dat, st


def haversine(lon1, lat1, lon2, lat2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1); dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def main():
    ap = argparse.ArgumentParser(description="Conector de datos DGA (vía CR2) para koi-flow")
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--radio", type=float, default=60.0, help="radio de búsqueda [km]")
    ap.add_argument("--var", choices=["pr", "qflx"], default="pr")
    ap.add_argument("--min-anios", type=int, default=10, help="años mínimos de registro")
    ap.add_argument("--cache", default=os.path.join(ROOT, "tools", ".cache_dga"))
    args = ap.parse_args()

    f = FUENTES[args.var]
    zpath = resolver_zip(args.var, args.cache)
    zf = zipfile.ZipFile(zpath)
    data_txt, st_txt = miembros(zf)

    # 1) catálogo: estaciones dentro del radio
    sel = {}
    with zf.open(st_txt) as fh:
        for s in csv.DictReader(io.TextIOWrapper(fh, "utf-8")):
            try:
                lat, lon = float(s["latitud"]), float(s["longitud"])
            except (ValueError, KeyError):
                continue
            d = haversine(lon, lat, args.lon, args.lat)
            if d <= args.radio:
                bna = s["codigo_estacion"]
                sel[bna.zfill(8)] = {
                    "bna": bna, "nombre": s["nombre"], "altitud_m": _num(s.get("altura")),
                    "lat": lat, "lon": lon, "cuenca": s.get("nombre_cuenca", ""),
                    "subcuenca": s.get("nombre_sub_cuenca", ""), "dist_km": round(d, 1),
                    "periodo": f"{s['inicio_observaciones'][:4]}-{s['fin_observaciones'][:4]}",
                }
    if not sel:
        sys.exit("No se encontraron estaciones en el radio indicado.")
    print(f"  {len(sel)} estaciones en {args.radio:.0f} km")

    # 2) series: extrae las columnas seleccionadas del archivo de datos (streaming)
    annual = {b: {} for b in sel}
    with zf.open(data_txt) as fh:
        header = fh.readline().decode("utf-8").rstrip("\n").split(",")
        idx = {header[i]: i for i in range(len(header))}
        cols = {b: idx[b] for b in sel if b in idx}
        for raw in fh:
            line = raw.decode("utf-8").rstrip("\n").split(",")
            d = line[0]
            if len(d) < 10 or d[4] != "-":
                continue
            yr = d[:4]
            for b, ci in cols.items():
                v = line[ci]
                if v in ("", "-9999"):
                    continue
                try:
                    x = float(v)
                except ValueError:
                    continue
                if x > annual[b].get(yr, -1):
                    annual[b][yr] = x

    # 3) escribe series + catálogo (sólo estaciones con suficiente registro)
    outdir = os.path.join(ROOT, "data", "series", "dga")
    os.makedirs(outdir, exist_ok=True)
    catalogo = []
    for b, meta in sorted(sel.items(), key=lambda kv: kv[1]["dist_km"]):
        serie = {y: round(v, 1) for y, v in sorted(annual.get(b, {}).items()) if v > 0}
        meta["tipo"] = f["tipo"]
        meta["n_anios"] = len(serie)
        if len(serie) < args.min_anios:
            continue
        rec = {
            "nombre": meta["nombre"], "bna": meta["bna"], "tipo": f["tipo"],
            "variable": f["variable"], "unidad": f["unidad"],
            "altitud_m": meta["altitud_m"], "lat": meta["lat"], "lon": meta["lon"],
            "cuenca": meta["cuenca"], "subcuenca": meta["subcuenca"],
            "fuente": f"CR2 (DGA) · {os.path.basename(data_txt)}",
            "n_anios": len(serie), "serie": serie,
        }
        archivo = f"{meta['bna']}_{args.var}.json"   # incluye variable: evita colisión pluvio/fluvio del mismo BNA
        with open(os.path.join(outdir, archivo), "w", encoding="utf-8") as fo:
            json.dump(rec, fo, ensure_ascii=False, indent=1)
        meta["archivo"] = archivo
        meta["var"] = args.var
        catalogo.append({k: meta[k] for k in
                         ("bna", "nombre", "tipo", "var", "archivo", "lat", "lon", "altitud_m", "cuenca", "periodo", "n_anios", "dist_km")})

    cat_path = os.path.join(ROOT, "data", "estaciones_dga.json")
    existing = []
    if os.path.exists(cat_path):
        existing = json.load(open(cat_path, encoding="utf-8")).get("estaciones", [])
    # merge por BNA+tipo
    byk = {(e["bna"], e["tipo"]): e for e in existing}
    for e in catalogo:
        byk[(e["bna"], e["tipo"])] = e
    with open(cat_path, "w", encoding="utf-8") as fo:
        json.dump({"generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "fuente": "CR2 (compila DGA) — https://www.cr2.cl",
                   "estaciones": sorted(byk.values(), key=lambda e: (e["tipo"], e["dist_km"]))},
                  fo, ensure_ascii=False, indent=1)
    print(f"  escritas {len(catalogo)} series en {outdir}")
    print(f"  catálogo: {cat_path} ({len(byk)} estaciones)")


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    main()
