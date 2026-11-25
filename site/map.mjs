const RAD = Math.PI / 180,
  EARTH = 6371.0088;
const charts = new WeakMap();
const cities = [
  ["Tampa", 27.951, -82.458],
  ["Sarasota", 27.337, -82.531],
  ["Naples", 26.142, -81.795],
  ["Miami", 25.762, -80.192],
  ["Tallahassee", 30.438, -84.281],
  ["Key West", 24.556, -81.781],
  ["Baton Rouge", 30.45, -91.14],
  ["Gulfport", 30.37, -89.09],
  ["Ponce", 18.01, -66.61],
  ["Mayagüez", 18.2, -67.14],
  ["Montego Bay", 18.47, -77.92],
  ["Havana", 23.11, -82.37],
  ["Marathon", 24.73, -81.05],
  ["West Palm Beach", 26.72, -80.05],
];
function projectFrom(lat, lon) {
  const phi = lat * RAD,
    sinPhi = Math.sin(phi),
    cosPhi = Math.cos(phi);
  return (y, x) => {
    const p = y * RAD,
      delta = (x - lon) * RAD;
    const east = Math.cos(p) * Math.sin(delta);
    const north = cosPhi * Math.sin(p) - sinPhi * Math.cos(p) * Math.cos(delta);
    const length = Math.hypot(east, north);
    const distance =
      EARTH *
      Math.atan2(
        length,
        sinPhi * Math.sin(p) + cosPhi * Math.cos(p) * Math.cos(delta),
      );
    const k = length > 1e-14 ? distance / length : 0;
    return [east * k, -north * k];
  };
}
function draw(host, state) {
  const { canvas, options } = state;
  const { storm, site, ruleA, ruleB, activePoint, land } = options;
  const width = Math.max(1, host.clientWidth),
    height = Math.max(1, host.clientHeight);
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const sx = width * 0.51,
    sy = height * 0.51;
  const project = projectFrom(site.lat, site.lon);
  const selected = storm.points[activePoint];
  const positions = storm.points.map((p) => project(p[1], p[2]));
  const [selectedX, selectedY] = positions[activePoint];
  const radius = Math.max(55, ruleA.radiusKm * 1.26, ruleB.radiusKm * 1.26);
  const scale = Math.min(
    (width * 0.44) / radius,
    (height * 0.44) / radius,
    (width * 0.4) / Math.max(1, Math.abs(selectedX)),
    (height * 0.39) / Math.max(1, Math.abs(selectedY)),
  );
  const xy = ([x, y]) => [sx + x * scale, sy + y * scale];
  const geo = (y, x) => xy(project(y, x));
  const points = positions.map(xy);
  state.points = points;
  function line(points, color, weight = 1, dash = []) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const pt of points.slice(1)) ctx.lineTo(...pt);
    ctx.strokeStyle = color;
    ctx.lineWidth = weight;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function dot(x, y, r, fill, stroke, weight = 1) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = weight;
      ctx.stroke();
    }
  }
  function text(
    value,
    x,
    y,
    color = "#b5c9cb",
    font = "11px ui-monospace,monospace",
    align = "left",
  ) {
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
    ctx.textAlign = "left";
  }
  const ocean = ctx.createLinearGradient(0, 0, width, height);
  ocean.addColorStop(0, "#102f40");
  ocean.addColorStop(1, "#122a36");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, width, height);
  const canvasBounds = [-5, -5, width + 5, height + 5];
  const visible = (box) =>
    box[2] >= canvasBounds[0] &&
    box[0] <= canvasBounds[2] &&
    box[3] >= canvasBounds[1] &&
    box[1] <= canvasBounds[3];
  // Cache the site-centered geometry in true kilometres. Zoom changes only the final scale.
  if (state.lat !== site.lat || state.lon !== site.lon || state.land !== land) {
    state.lat = site.lat;
    state.lon = site.lon;
    state.land = land;
    state.rings = land.map((ring) => {
      const local = ring.map(([x, y]) => project(y, x));
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of local) {
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], y);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], y);
      }
      return { local, bounds };
    });
  }
  for (const { local, bounds } of state.rings) {
    if (!visible([...xy(bounds.slice(0, 2)), ...xy(bounds.slice(2, 4))]))
      continue;
    ctx.beginPath();
    local.forEach((p, i) => {
      const [x, y] = xy(p);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "#304d51";
    ctx.fill();
    ctx.strokeStyle = "#638582";
    ctx.lineWidth = 1.0;
    ctx.stroke();
  }
  // Draw projected geographic grid lines at a spacing appropriate to the current zoom.
  const kmPerDegree = 111.2;
  const span = Math.min(
    180,
    width / (scale * kmPerDegree * Math.max(0.12, Math.cos(site.lat * RAD))) +
      2,
  );
  const latSpan = Math.min(90, height / (scale * kmPerDegree) + 2);
  const step =
    [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60].find(
      (v) => v * kmPerDegree * scale >= 56,
    ) || 60;
  const minLat = Math.max(-88, site.lat - latSpan),
    maxLat = Math.min(88, site.lat + latSpan);
  for (let y = Math.ceil(minLat / step) * step; y <= maxLat; y += step) {
    const pts = Array.from({ length: 49 }, (_, i) =>
      geo(y, site.lon - span + (span * 2 * i) / 48),
    );
    line(pts, "#76929738", 0.7, [3, 5]);
    const edge = pts.find(
      (p) =>
        p[0] >= 2 && p[0] < width * 0.15 && p[1] > 12 && p[1] < height - 22,
    );
    if (edge)
      text(
        Math.abs(y) + "°" + (y >= 0 ? "N" : "S"),
        6,
        edge[1] - 6,
        "#9db6b88a",
        "10px ui-monospace,monospace",
      );
  }
  for (
    let x = Math.ceil((site.lon - span) / step) * step;
    x <= site.lon + span;
    x += step
  ) {
    const pts = Array.from({ length: 41 }, (_, i) =>
      geo(minLat + ((maxLat - minLat) * i) / 40, x),
    );
    line(pts, "#76929738", 0.7, [3, 5]);
  }
  const labels = [];
  function available(x, y, w, h) {
    const rect = [x, y - h / 2, x + w, y + h / 2];
    if (
      rect[0] < 5 ||
      rect[1] < 5 ||
      rect[2] > width - 5 ||
      rect[3] > height - 5
    )
      return false;
    if (
      labels.some(
        (r) =>
          rect[0] < r[2] + 4 &&
          rect[2] > r[0] - 4 &&
          rect[1] < r[3] + 3 &&
          rect[3] > r[1] - 3,
      )
    )
      return false;
    labels.push(rect);
    return true;
  }
  const areaRings = [
    {
      rule: ruleB,
      letter: "B",
      color: "#ff936c",
      fill: "#ff936c0e",
      dash: [6, 4],
    },
    { rule: ruleA, letter: "A", color: "#53d5c1", fill: "#53d5c110", dash: [] },
  ];
  for (const ring of areaRings) {
    ctx.setLineDash(ring.dash);
    dot(sx, sy, ring.rule.radiusKm * scale, ring.fill, ring.color, 1.6);
    ctx.setLineDash([]);
  }
  line(points, "#091d24", 4.8);
  line(points, "#ffc172", 2.2);
  for (const [x, y] of points)
    if (x >= -5 && y >= -5 && x < width + 5 && y < height + 5)
      dot(x, y, 3.3, "#f4ba73", "#182b30", 1.1);
  const [ax, ay] = points[activePoint];
  dot(ax, ay, 10, "#ffc58426", "#ffc48299", 1.1);
  dot(ax, ay, 4.6, "#ffe0a1", "#192d33", 1.4);
  ctx.fillStyle = "#f3f7ed";
  ctx.strokeStyle = "#07272b";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 5);
  ctx.lineTo(sx + 5, sy);
  ctx.lineTo(sx, sy + 5);
  ctx.lineTo(sx - 5, sy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const siteName = site.name.split(",")[0].toUpperCase();
  ctx.font = "600 11px ui-monospace,monospace";
  const sw = ctx.measureText(siteName).width + 12;
  const tx = Math.max(5, Math.min(width - sw - 5, sx + 10)),
    ty = sy + 13;
  ctx.fillStyle = "#102a30ef";
  ctx.fillRect(tx, ty - 9, sw, 19);
  text(siteName, tx + 6, ty, "#e3f4ea", "600 11px ui-monospace,monospace");
  labels.push([tx, ty - 9, tx + sw, ty + 10]);
  for (const [n, ring] of areaRings.entries()) {
    const r = ring.rule.radiusKm * scale;
    const angle = n === 0 ? -0.75 : 2.55;
    const x = sx + Math.cos(angle) * r,
      y = sy + Math.sin(angle) * r;
    if (r > 6 && available(x - 7, y, 14, 14)) {
      dot(x, y, 7.8, "#14313b", ring.color);
      text(
        ring.letter,
        x,
        y + 0.5,
        ring.color,
        "bold 10px ui-monospace,monospace",
        "center",
      );
    }
  }
  if (scale > 0.09) {
    for (const [name, lat, lon] of cities) {
      const [x, y] = geo(lat, lon);
      if (Math.hypot(x - sx, y - sy) < 27 || Math.hypot(x - ax, y - ay) < 25)
        continue;
      ctx.font = "11px system-ui";
      if (available(x + 5, y, ctx.measureText(name).width, 12)) {
        dot(x, y, 1.6, "#9cb5ae");
        text(name, x + 5, y, "#b1c6bb", "11px system-ui");
      }
    }
  }
  const length =
    [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2000, 5000]
      .filter((km) => km * scale <= width * 0.16)
      .at(-1) || 1;
  const end = 14 + length * scale;
  line(
    [
      [14, height - 14],
      [14, height - 10],
      [end, height - 10],
      [end, height - 14],
    ],
    "#e0ede4",
    1,
  );
  text(
    length + " km",
    14,
    height - 21,
    "#d2dfd7",
    "10px ui-monospace,monospace",
  );
  text(
    "N",
    width - 15,
    13,
    "#e4eee5",
    "bold 11px ui-monospace,monospace",
    "center",
  );
  line(
    [
      [width - 15, 21],
      [width - 15, 35],
    ],
    "#bdcdc5",
    1,
  );
  const [time, lat, lon, wind] = selected;
  canvas.setAttribute(
    "aria-label",
    site.name +
      " storm map. Selected observation " +
      time +
      ", " +
      lat +
      " latitude, " +
      lon +
      " longitude, " +
      wind +
      " knots. Use the observation slider to inspect the track.",
  );
}

export function renderMap(element, options) {
  let state = charts.get(element);
  if (!state) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    Object.assign(canvas.style, {
      display: "block",
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      cursor: "crosshair",
    });
    element.replaceChildren(canvas);
    state = { canvas, options };
    charts.set(element, state);
    canvas.addEventListener("click", (event) => {
      const rect = canvas.getBoundingClientRect();
      let closest = -1,
        min = 16;
      state.points.forEach(([x, y], i) => {
        const d = Math.hypot(
          event.clientX - rect.left - x,
          event.clientY - rect.top - y,
        );
        if (d < min) {
          closest = i;
          min = d;
        }
      });
      if (closest >= 0) state.options.onSelect?.(closest);
    });
    state.resize = new ResizeObserver(() => draw(element, state));
    state.resize.observe(element);
  }
  state.options = options;
  draw(element, state);
}
