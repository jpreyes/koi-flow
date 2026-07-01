#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fetch_hydrobasins.py — genera el JSON compacto de HydroBASINS para koi-flow.

HydroBASINS (HydroSHEDS/WWF) trae sub-cuencas anidadas con topologia NEXT_DOWN +
UP_AREA. Este script toma el shapefile de un continente/nivel, lo recorta a un
bbox, simplifica los anillos y escribe data/hydrobasins/<region>.json que consume
js/koi/cuenca/hydrobasins.js (cuenca aportante COMPLETA para rios grandes).

Uso:
  # desde un shapefile ya descargado (recomendado):
  python tools/fetch_hydrobasins.py --src hybas_sa_lev07_v1c.shp --region cl
  # o intentar descargar el nivel de Sudamerica (puede ser pesado):
  python tools/fetch_hydrobasins.py --download --level 7 --region cl

bbox por defecto: Chile + divisoria andina (incluye cabeceras en Argentina).
Niveles: 1 (grueso) … 12 (fino). Para rios grandes 6-8 es buen compromiso (liviano).
"""
import argparse, io, json, os, sys, zipfile, urllib.request

BBOX_CL = (-76.0, -56.5, -66.0, -17.0)   # oeste, sur, este, norte (con margen andino)

def dp(points, tol):
    """Douglas-Peucker en grados (tol ~ 0.002 = ~200 m)."""
    if len(points) < 3:
        return points
    dmax, idx = 0.0, 0
    a, b = points[0], points[-1]
    for i in range(1, len(points) - 1):
        d = _perp(points[i], a, b)
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        left = dp(points[:idx + 1], tol)
        right = dp(points[idx:], tol)
        return left[:-1] + right
    return [a, b]

def _perp(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    px, py = x1 + t * dx, y1 + t * dy
    return ((x - px) ** 2 + (y - py) ** 2) ** 0.5

def field_index(reader):
    names = [f[0].upper() for f in reader.fields[1:]]  # salta DeletionFlag
    def find(*cands):
        for c in cands:
            if c in names:
                return names.index(c)
        return None
    return {
        'id': find('HYBAS_ID'),
        'next': find('NEXT_DOWN'),
        'sub': find('SUB_AREA'),
        'up': find('UP_AREA'),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', help='shapefile HydroBASINS (.shp) local')
    ap.add_argument('--download', action='store_true', help='descargar el nivel de Sudamerica')
    ap.add_argument('--level', type=int, default=7)
    ap.add_argument('--continent', default='sa', help='sa,af,eu,as,au,na,ar,gr,si')
    ap.add_argument('--region', default='cl')
    ap.add_argument('--bbox', default=None, help='w,s,e,n (por defecto Chile+Andes)')
    ap.add_argument('--tol', type=float, default=0.003, help='tolerancia de simplificacion [grados]')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    try:
        import shapefile  # pyshp
    except ImportError:
        sys.exit('Falta pyshp:  pip install pyshp')

    bbox = tuple(float(x) for x in args.bbox.split(',')) if args.bbox else BBOX_CL
    w, s, e, n = bbox

    if args.src:
        reader = shapefile.Reader(args.src)
    elif args.download:
        url = f'https://data.hydrosheds.org/file/hydrobasins/standard/hybas_{args.continent}_lev{args.level:02d}_v1c.zip'
        print('Descargando', url)
        req = urllib.request.Request(url, headers={'User-Agent': 'koi-flow'})
        data = urllib.request.urlopen(req, timeout=300).read()
        zf = zipfile.ZipFile(io.BytesIO(data))
        base = next(x[:-4] for x in zf.namelist() if x.endswith('.shp'))
        shp = io.BytesIO(zf.read(base + '.shp'))
        dbf = io.BytesIO(zf.read(base + '.dbf'))
        shx = io.BytesIO(zf.read(base + '.shx'))
        reader = shapefile.Reader(shp=shp, dbf=dbf, shx=shx)
    else:
        sys.exit('Indica --src <shp> o --download')

    fi = field_index(reader)
    if fi['id'] is None or fi['next'] is None:
        sys.exit('El shapefile no parece HydroBASINS (faltan HYBAS_ID/NEXT_DOWN)')

    basins, kept, total = [], 0, 0
    for sr in reader.iterShapeRecords():
        total += 1
        rec, shp = sr.record, sr.shape
        bb = shp.bbox  # [w,s,e,n]
        if bb[2] < w or bb[0] > e or bb[3] < s or bb[1] > n:
            continue  # fuera del bbox
        # anillo exterior (primera parte)
        pts = shp.points
        end = shp.parts[1] if len(shp.parts) > 1 else len(pts)
        ring = [[round(x, 5), round(y, 5)] for x, y in pts[0:end]]
        ring = [[round(x, 5), round(y, 5)] for x, y in dp(ring, args.tol)]
        if len(ring) < 4:
            continue
        rw = min(p[0] for p in ring); re = max(p[0] for p in ring)
        rs = min(p[1] for p in ring); rn = max(p[1] for p in ring)
        basins.append({
            'id': int(rec[fi['id']]),
            'nextDown': int(rec[fi['next']]),
            'subArea': round(float(rec[fi['sub']]), 2) if fi['sub'] is not None else 0,
            'upArea': round(float(rec[fi['up']]), 2) if fi['up'] is not None else None,
            'bbox': [rw, rs, re, rn],
            'ring': ring,
        })
        kept += 1

    out = args.out or os.path.join('data', 'hydrobasins', f'{args.region}.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'level': args.level, 'region': args.region, 'bbox': list(bbox), 'basins': basins}, f)
    kb = os.path.getsize(out) / 1024
    print(f'{kept}/{total} sub-cuencas en bbox -> {out}  ({kb:.0f} KB)')

if __name__ == '__main__':
    main()
