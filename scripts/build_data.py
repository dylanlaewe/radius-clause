"""Build the browser data from content-pinned NOAA and Natural Earth releases (Python 3)."""
import csv
import datetime
import hashlib
import json
import math
from pathlib import Path
from urllib.request import urlopen

OUT = Path(__file__).resolve().parents[1] / "site" / "data"
TRACK_URL = "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-092326.txt"
TRACK_SHA = "75202780ce56c8458f16fbef5fb8a026b99b00878dbb95c458211b3e6ef125b4"
LAND_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_land.geojson"
LAND_SHA = "e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b"
START, END = 1990, 2025


def download(url, digest):
    with urlopen(url, timeout=60) as response:
        source = response.read()
    if hashlib.sha256(source).hexdigest() != digest:
        raise ValueError(f"Source hash mismatch for {url}")
    return source


def coordinate(raw):
    return float(raw[:-1]) * (-1 if raw[-1] in "SW" else 1)


def build_tracks(content):
    storms = []
    current = None
    remaining = 0
    for row in csv.reader(content.decode("ascii").splitlines(), skipinitialspace=True):
        fields = [v.strip() for v in row]
        if fields[0].startswith("AL"):
            if remaining:
                raise ValueError("Incomplete storm before " + fields[0])
            year = int(fields[0][-4:])
            remaining = int(fields[2])
            current = None
            if START <= year <= END:
                current = dict(id=fields[0], name=fields[1], year=year, points=[])
                storms.append(current)
            continue
        remaining -= 1
        if current is None:
            continue
        stamp = datetime.datetime.strptime(fields[0] + fields[1], "%Y%m%d%H%M")
        point = [stamp.strftime("%Y-%m-%dT%H:%M:%SZ"), coordinate(fields[4]),
                 coordinate(fields[5]), int(fields[6]), fields[3]]
        if point[3] < 0 or not (-90 <= point[1] <= 90 and -180 <= point[2] <= 180):
            raise ValueError("Invalid fix in " + current["id"])
        current["points"].append(point)
    if remaining or {s["year"] for s in storms} != set(range(START, END + 1)):
        raise ValueError("Incomplete archive")
    meta = dict(source=TRACK_URL, sha256=TRACK_SHA, dataset="NHC Atlantic HURDAT2",
                version="2026-09-23", startYear=START, endYear=END,
                storms=len(storms), fixes=sum(len(s["points"]) for s in storms),
                pointFields=["timeUTC", "latitude", "longitude", "windKt", "status"])
    return dict(meta=meta, storms=storms)


def clip_ring(points, axis, limit, sign):
    """Clip a polygon against one side of the Atlantic map extent."""
    result = []
    if not points:
        return result
    previous = points[-1]
    was_inside = sign * (previous[axis] - limit) >= 0
    for point in points:
        inside = sign * (point[axis] - limit) >= 0
        if inside != was_inside:
            fraction = (limit - previous[axis]) / (point[axis] - previous[axis])
            result.append([a + fraction * (b - a) for a, b in zip(previous, point)])
        if inside:
            result.append(point)
        previous, was_inside = point, inside
    return result


def simplify(points, tolerance=0.012):
    if len(points) < 3:
        return points
    stack = [(0, len(points) - 1)]
    keep = {0, len(points) - 1}
    while stack:
        lo, hi = stack.pop()
        x, y = points[lo]
        dx, dy = points[hi][0] - x, points[hi][1] - y
        length = dx * dx + dy * dy
        largest = tolerance
        split = None
        for i in range(lo + 1, hi):
            px, py = points[i]
            fraction = max(0, min(1, ((px-x)*dx + (py-y)*dy)/length)) if length else 0
            distance = math.hypot(px-x-fraction*dx, py-y-fraction*dy)
            if distance > largest:
                largest, split = distance, i
        if split is not None:
            keep.add(split)
            stack.extend(((lo, split), (split, hi)))
    return [points[i] for i in sorted(keep)]


def build_land(content):
    rings = []
    for feature in json.loads(content)["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for polygon in polygons:
            ring = polygon[0]
            for edge in [(0, -115, 1), (0, 18, -1), (1, -5, 1), (1, 75, -1)]:
                ring = clip_ring(ring, *edge)
            if len(ring) < 3:
                continue
            rounded = [[round(x, 3), round(y, 3)] for x, y in simplify(ring + [ring[0]])]
            if len(rounded) >= 4:
                rings.append(rounded)
    return rings


def encode(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=True).encode() + b"\n"


def main():
    tracks = build_tracks(download(TRACK_URL, TRACK_SHA))
    land = build_land(download(LAND_URL, LAND_SHA))
    OUT.mkdir(parents=True, exist_ok=True)
    for name, dataset in (("atlantic.json", tracks), ("land.json", land)):
        path = OUT / name
        payload = encode(dataset)
        path.write_bytes(payload)
        print(f"{name}: {len(payload):,} bytes, sha256 {hashlib.sha256(payload).hexdigest()}")
    print(tracks["meta"]["storms"], "storms,", tracks["meta"]["fixes"], "fixes")


if __name__ == "__main__":
    main()
