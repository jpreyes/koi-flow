#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
catalogo_nacional.py — arma el catálogo NACIONAL de estaciones DGA (todo Chile) a
partir de los `_stations.txt` de los zips CR2 ya cacheados (tools/.cache_dga/), para
que koi-flow muestre las estaciones cercanas a DONDE ESTÉS parado (Osorno, Santiago,
Valdivia…), no solo Tarapacá. Solo metadata + periodo nominal (inicio/fin); las SERIES
se descargan por zona con fetch_dga cuando se usa una estación.

Uso:  python tools/catalogo_nacional.py
Requiere los zips en tools/.cache_dga/ (cr2_pr.zip, cr2_qflx.zip). Si faltan, córrelos
una vez con fetch_dga (descarga el zip nacional) o pásalos con --cache.
"""
import os, io, csv, json, zipfile, argparse
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VARS = {"pr": "pluviometrica", "qflx": "fluviometrica"}

def stations_member(zf):
    return next(n for n in zf.namelist() if n.endswith("_stations.txt"))

def anio(s):
    return s[:4] if s and s[:4].isdigit() else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, "tools", ".cache_dga"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "estaciones_dga.json"))
    args = ap.parse_args()

    estaciones = []
    for var, tipo in VARS.items():
        zpath = os.path.join(args.cache, f"cr2_{var}.zip")
        if not os.path.exists(zpath):
            print(f"  (falta {zpath} — sáltalo)"); continue
        zf = zipfile.ZipFile(zpath)
        with zf.open(stations_member(zf)) as fh:
            n = 0
            for s in csv.DictReader(io.TextIOWrapper(fh, "utf-8")):
                try:
                    lat, lon = float(s["latitud"]), float(s["longitud"])
                except (ValueError, KeyError):
                    continue
                if not (-56 <= lat <= -17 and -76 <= lon <= -66):   # Chile continental + margen
                    continue
                ini, fin = anio(s.get("inicio_observaciones", "")), anio(s.get("fin_observaciones", ""))
                na = (int(fin) - int(ini) + 1) if (ini and fin) else None
                bna = s["codigo_estacion"]
                estaciones.append({
                    "bna": bna, "nombre": s.get("nombre", "").strip(), "tipo": tipo, "var": var,
                    "archivo": f"{bna}_{var}.json",           # se baja con fetch_dga cuando se use
                    "lat": lat, "lon": lon, "altitud_m": _num(s.get("altura")),
                    "cuenca": s.get("nombre_cuenca", "").strip(),
                    "periodo": (f"{ini}-{fin}" if (ini and fin) else ""),
                    "n_anios": na, "nacional": True,
                })
                n += 1
        print(f"  {var} ({tipo}): {n} estaciones")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fo:
        json.dump({"generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "nacional": True, "estaciones": estaciones}, fo, ensure_ascii=False)
    print(f"-> {args.out}  ({len(estaciones)} estaciones, {os.path.getsize(args.out)//1024} KB)")

def _num(x):
    try: return float(x)
    except (TypeError, ValueError): return None

if __name__ == "__main__":
    main()
