#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export_dga_static.py - genera la base DGA estatica completa para koi-flow.

Lee los zips CR2 cacheados (o los descarga) y escribe:
  - data/estaciones_dga.json
  - data/series/dga/<BNA>_pr.json
  - data/series/dga/<BNA>_qflx.json

El resultado queda servido como archivos estaticos, compatible con GitHub Pages.
"""
import argparse
import csv
import io
import json
import math
import os
import zipfile
from datetime import datetime, timezone

from fetch_dga import FUENTES, miembros, resolver_zip

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main():
    ap = argparse.ArgumentParser(description="Exporta series DGA/CR2 completas como JSON estatico")
    ap.add_argument("--cache", default=os.path.join(ROOT, "tools", ".cache_dga"))
    ap.add_argument("--out-catalogo", default=os.path.join(ROOT, "data", "estaciones_dga.json"))
    ap.add_argument("--out-series", default=os.path.join(ROOT, "data", "series", "dga"))
    ap.add_argument("--min-anios", type=int, default=1)
    args = ap.parse_args()

    os.makedirs(args.out_series, exist_ok=True)
    estaciones = []
    for var in ("pr", "qflx"):
        estaciones.extend(exportar_var(var, args))

    estaciones.sort(key=lambda e: (e["tipo"], e["lat"], e["lon"], e["bna"]))
    os.makedirs(os.path.dirname(args.out_catalogo), exist_ok=True)
    with open(args.out_catalogo, "w", encoding="utf-8") as fo:
        json.dump({
            "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "fuente": "CR2 (compila DGA) - https://www.cr2.cl",
            "nacional": True,
            "estaciones": estaciones,
        }, fo, ensure_ascii=False, separators=(",", ":"))
    print(f"catalogo: {args.out_catalogo} ({len(estaciones)} estaciones)")


def exportar_var(var, args):
    fuente = FUENTES[var]
    zpath = resolver_zip(var, args.cache)
    with zipfile.ZipFile(zpath) as zf:
        data_txt, st_txt = miembros(zf)
        meta = leer_estaciones(zf, st_txt)
        annual = maximos_anuales(zf, data_txt, set(meta))

    out = []
    for key, serie_raw in sorted(annual.items()):
        serie = {y: round(v, 1) for y, v in sorted(serie_raw.items()) if math.isfinite(v) and v > 0}
        if len(serie) < args.min_anios or key not in meta:
            continue

        m = meta[key]
        bna = m["bna"]
        archivo = f"{bna}_{var}.json"
        rec = {
            "nombre": m["nombre"],
            "bna": bna,
            "tipo": fuente["tipo"],
            "variable": fuente["variable"],
            "unidad": fuente["unidad"],
            "altitud_m": m["altitud_m"],
            "lat": m["lat"],
            "lon": m["lon"],
            "cuenca": m["cuenca"],
            "subcuenca": m["subcuenca"],
            "fuente": f"CR2 (DGA) - {os.path.basename(data_txt)}",
            "n_anios": len(serie),
            "serie": serie,
        }
        with open(os.path.join(args.out_series, archivo), "w", encoding="utf-8") as fo:
            json.dump(rec, fo, ensure_ascii=False, separators=(",", ":"))

        years = list(serie)
        out.append({
            "bna": bna,
            "nombre": m["nombre"],
            "tipo": fuente["tipo"],
            "var": var,
            "archivo": archivo,
            "lat": m["lat"],
            "lon": m["lon"],
            "altitud_m": m["altitud_m"],
            "cuenca": m["cuenca"],
            "periodo": f"{years[0]}-{years[-1]}",
            "n_anios": len(serie),
            "nacional": True,
        })
    print(f"{var}: {len(out)} series")
    return out


def leer_estaciones(zf, st_txt):
    meta = {}
    with zf.open(st_txt) as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, "utf-8")):
            try:
                lat = float(row["latitud"])
                lon = float(row["longitud"])
            except (KeyError, TypeError, ValueError):
                continue
            if not (-56 <= lat <= -17 and -76 <= lon <= -66):
                continue
            bna = str(row.get("codigo_estacion", "")).strip()
            if not bna:
                continue
            meta[bna.zfill(8)] = {
                "bna": bna,
                "nombre": str(row.get("nombre", "")).strip(),
                "lat": lat,
                "lon": lon,
                "altitud_m": num(row.get("altura")),
                "cuenca": str(row.get("nombre_cuenca", "")).strip(),
                "subcuenca": str(row.get("nombre_sub_cuenca", "")).strip(),
            }
    return meta


def maximos_anuales(zf, data_txt, estaciones):
    with zf.open(data_txt) as fh:
        header = fh.readline().decode("utf-8").rstrip("\n").split(",")
        cols = [(i, bna) for i, bna in enumerate(header) if bna in estaciones]
        annual = {bna: {} for _, bna in cols}
        for raw in fh:
            line = raw.decode("utf-8").rstrip("\n").split(",")
            if not line:
                continue
            fecha = line[0]
            if len(fecha) < 10 or fecha[4] != "-":
                continue
            year = fecha[:4]
            for idx, bna in cols:
                if idx >= len(line):
                    continue
                val = line[idx]
                if val in ("", "-9999"):
                    continue
                try:
                    x = float(val)
                except ValueError:
                    continue
                if x > annual[bna].get(year, -math.inf):
                    annual[bna][year] = x
    return annual


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    main()
