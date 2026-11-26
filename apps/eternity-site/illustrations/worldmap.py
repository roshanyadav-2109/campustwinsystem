"""Builds public/world-dots.svg: a dotted world map (Natural Earth 1:110m via the
world-atlas package, public domain) with India highlighted.
Usage: python -I worldmap.py <path to countries-110m.json>
"""
import json, sys, os

src = sys.argv[1]
topo = json.load(open(src, encoding="utf-8"))
sx, sy = topo["transform"]["scale"]
tx, ty = topo["transform"]["translate"]

# Decode delta-encoded arcs into lon/lat.
arcs = []
for arc in topo["arcs"]:
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx; y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)

def ring(idx):
    out = []
    for i in idx:
        pts = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        out.extend(pts if not out else pts[1:])
    return out

def polygons(geom):
    if geom["type"] == "Polygon":
        return [[ring(r) for r in geom["arcs"]]]
    if geom["type"] == "MultiPolygon":
        return [[ring(r) for r in p] for p in geom["arcs"]]
    return []

def inside(pt, rings):
    x, y = pt
    c = False
    for r in rings:
        n = len(r)
        j = n - 1
        for i in range(n):
            xi, yi = r[i]; xj, yj = r[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
                c = not c
            j = i
    return c

countries = topo["objects"]["countries"]["geometries"]
shapes = []  # (is_india, bbox, rings)
for g in countries:
    india = g.get("properties", {}).get("name") == "India" or str(g.get("id")) == "356"
    for poly in polygons(g):
        xs = [p[0] for r in poly for p in r]; ys = [p[1] for r in poly for p in r]
        shapes.append((india, (min(xs), min(ys), max(xs), max(ys)), poly))

# Equirectangular grid, Antarctica left out.
STEP = 2.0
W, H = 1000, 460          # viewBox
LON0, LON1, LAT0, LAT1 = -170, 190, -58, 82
dots = []
lat = LAT1
while lat >= LAT0:
    lon = LON0
    while lon <= LON1:
        L = lon if lon <= 180 else lon - 360
        hit = None
        for india, (a, b, c, d), rings in shapes:
            if a <= L <= c and b <= lat <= d and inside((L, lat), rings):
                hit = india
                break
        if hit is not None:
            x = (lon - LON0) / (LON1 - LON0) * W
            y = (LAT1 - lat) / (LAT1 - LAT0) * H
            dots.append((round(x, 1), round(y, 1), hit))
        lon += STEP
    lat -= STEP

r = 1.9
land = "".join(f'<circle cx="{x}" cy="{y}" r="{r}"/>' for x, y, i in dots if not i)
ind = "".join(f'<circle cx="{x}" cy="{y}" r="{r + 0.4}"/>' for x, y, i in dots if i)
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">'
       f'<g fill="#dcdfe5">{land}</g><g fill="#0b57d0">{ind}</g></svg>')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "world-dots.svg")
open(out, "w", encoding="utf-8").write(svg)
print("dots", len(dots), "india", sum(1 for d in dots if d[2]), "bytes", len(svg))
