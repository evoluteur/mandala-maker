// Mandala Maker: strokes are stored once, in coordinates where the canvas
// radius is 1, and repeated around the center at draw time. That is why the
// number of folds can change after the fact, and why the SVG export is small.

const PALETTE = [
  "#ffb74d", "#ff7043", "#ef5350", "#ec407a", "#ab47bc",
  "#5c6bc0", "#29b6f6", "#26a69a", "#9ccc65", "#ffffff",
];
const BACKGROUNDS = {
  dark: { label: "Dark", color: "#141a24" },
  light: { label: "Light", color: "#fbf7ee" },
  midnight: { label: "Midnight", color: "#0d1b3d" },
  black: { label: "Black", color: "#000000" },
};
const COLOR_MODES = [
  { id: "solid", label: "Solid" },
  { id: "rainbow", label: "Rainbow rings" },
  { id: "cycle", label: "Cycle colors" },
];

const SETTINGS_KEY = "mandala-settings";
const STROKES_KEY = "mandala-strokes";
const MAX_SAVED_BYTES = 1.5e6;

let settings = {
  folds: 12,
  mirror: true,
  guides: false,
  size: 8,
  opacity: 90,
  colorMode: "solid",
  color: PALETTE[0],
  bg: "dark",
  transparent: false,
};

let strokes = []; // { pts: [[x, y], ...], w, a, mode: "solid" | "rainbow", color }
let redoStack = [];
let lastCleared = null;
let cycleHue = 20;
let current = null; // the stroke being drawn
let canvas, ctx, cache, cctx;
let cssSize = 600;
let dpr = 1;

const $ = (id) => document.getElementById(id);
const bgColor = () => BACKGROUNDS[settings.bg].color;

// ---------------------------------------------------------------- drawing

const traceSmooth = (c, pts) => {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) {
    c.lineTo(pts[0][0] + 0.0001, pts[0][1]);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  c.lineTo(last[0], last[1]);
};

const rainbowColor = (x, y) =>
  `hsl(${Math.round((Math.hypot(x, y) * 330 + 20) % 360)} 85% 60%)`;

// Draws one stroke once, in stroke coordinates (radius 1, center 0,0).
const drawStrokeOnce = (c, s) => {
  c.lineWidth = s.w;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.globalAlpha = s.a;
  if (s.mode === "rainbow") {
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i];
      const q = s.pts[Math.min(i + 1, s.pts.length - 1)];
      c.strokeStyle = rainbowColor((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      c.beginPath();
      c.moveTo(p[0], p[1]);
      c.lineTo(q[0] + (q === p ? 0.0001 : 0), q[1]);
      c.stroke();
    }
  } else {
    c.strokeStyle = s.color;
    traceSmooth(c, s.pts);
    c.stroke();
  }
};

// Draws a list of strokes with the current symmetry, centered on the canvas.
const drawStrokes = (c, list, size) => {
  const R = (size / 2) * 0.98;
  const n = settings.folds;
  c.save();
  c.translate(size / 2, size / 2);
  c.scale(R, R);
  for (let k = 0; k < n; k++) {
    for (let m = 0; m < (settings.mirror ? 2 : 1); m++) {
      c.save();
      c.rotate((2 * Math.PI * k) / n);
      if (m) c.scale(1, -1);
      for (const s of list) drawStrokeOnce(c, s);
      c.restore();
    }
  }
  c.restore();
  c.globalAlpha = 1;
};

const drawGuides = (c, size) => {
  const R = (size / 2) * 0.98;
  const n = settings.folds;
  c.save();
  c.translate(size / 2, size / 2);
  c.strokeStyle = settings.bg === "light" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.22)";
  c.lineWidth = 1;
  c.setLineDash([4, 5]);
  const step = settings.mirror ? Math.PI / n : (2 * Math.PI) / n;
  const count = settings.mirror ? 2 * n : n;
  for (let k = 0; k < count; k++) {
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(R * Math.cos(k * step), R * Math.sin(k * step));
    c.stroke();
  }
  c.setLineDash([]);
  c.beginPath();
  c.arc(0, 0, R, 0, 2 * Math.PI);
  c.stroke();
  c.restore();
};

const rebuildCache = () => {
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.clearRect(0, 0, cache.width, cache.height);
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawStrokes(cctx, strokes, cssSize);
};

const render = () => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bgColor();
  ctx.fillRect(0, 0, cssSize, cssSize);
  if (settings.guides) drawGuides(ctx, cssSize);
  ctx.drawImage(cache, 0, 0, cssSize, cssSize);
  if (current) drawStrokes(ctx, [current], cssSize);
};

const resize = () => {
  const wrap = $("canvas-wrap");
  const w = Math.max(240, Math.floor(wrap.clientWidth)); // clientWidth is inside the border: the canvas stays square
  if (w === cssSize && canvas.width === Math.round(w * dpr)) return;
  cssSize = w;
  dpr = window.devicePixelRatio || 1;
  for (const c of [canvas, cache]) {
    c.width = Math.round(cssSize * dpr);
    c.height = Math.round(cssSize * dpr);
  }
  canvas.style.height = cssSize + "px";
  rebuildCache();
  render();
};

// ---------------------------------------------------------------- input

const toStrokeCoords = (e) => {
  const r = canvas.getBoundingClientRect();
  const R = (r.width / 2) * 0.98;
  return [
    +(((e.clientX - r.left) - r.width / 2) / R).toFixed(4),
    +(((e.clientY - r.top) - r.height / 2) / R).toFixed(4),
  ];
};

const newStroke = () => {
  let mode = settings.colorMode;
  let color = settings.color;
  if (mode === "cycle") {
    cycleHue = (cycleHue + 37) % 360;
    color = `hsl(${cycleHue} 85% 60%)`;
    mode = "solid";
  }
  return {
    pts: [],
    w: +(settings.size / 300).toFixed(4),
    a: settings.opacity / 100,
    mode,
    color,
  };
};

const onDown = (e) => {
  if (e.button !== undefined && e.button > 0) return;
  canvas.setPointerCapture?.(e.pointerId);
  current = newStroke();
  current.pts.push(toStrokeCoords(e));
  render();
  e.preventDefault();
};

const onMove = (e) => {
  if (!current) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs.length ? evs : [e]) {
    const p = toStrokeCoords(ev);
    const last = current.pts[current.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.004) current.pts.push(p);
  }
  render();
};

const onUp = () => {
  if (!current) return;
  commit(current);
  current = null;
};

const commit = (s) => {
  strokes.push(s);
  redoStack = [];
  lastCleared = null;
  drawStrokesOnto(cctx, [s]);
  render();
  saveStrokes();
  updateButtons();
};

const drawStrokesOnto = (c, list) => {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawStrokes(c, list, cssSize);
};

// ---------------------------------------------------------------- actions

const fullRedraw = () => {
  rebuildCache();
  render();
  saveStrokes();
  updateButtons();
};

const undo = () => {
  if (strokes.length) {
    redoStack.push(strokes.pop());
  } else if (lastCleared) {
    strokes = lastCleared;
    lastCleared = null;
  } else {
    return;
  }
  fullRedraw();
};

const redo = () => {
  if (!redoStack.length) return;
  strokes.push(redoStack.pop());
  fullRedraw();
};

const clearAll = () => {
  if (!strokes.length) return;
  lastCleared = strokes;
  strokes = [];
  redoStack = [];
  fullRedraw();
};

const rand = (a, b) => a + Math.random() * (b - a);

// A few random curves: petals, loops and rings, each one repeated by the
// symmetry like anything you draw yourself.
const surprise = () => {
  const n = settings.folds;
  const count = 3 + Math.floor(Math.random() * 3);
  for (let j = 0; j < count; j++) {
    const base = rand(0.12, 0.85);
    const amp = rand(0.03, 0.16);
    const lobes = 1 + Math.floor(Math.random() * 4);
    const span = (2 * Math.PI) / n;
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const a = t * span * (settings.mirror ? 0.5 : 1);
      const r = base + amp * Math.sin(t * Math.PI * 2 * lobes);
      pts.push([+(r * Math.cos(a)).toFixed(4), +(r * Math.sin(a)).toFixed(4)]);
    }
    const mode = Math.random() < 0.25 ? "rainbow" : "solid";
    strokes.push({
      pts,
      w: +(rand(2, 9) / 300).toFixed(4),
      a: 0.9,
      mode,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    });
  }
  redoStack = [];
  lastCleared = null;
  fullRedraw();
};

// ---------------------------------------------------------------- export

const download = (name, blob) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

const savePng = () => {
  const size = 2048;
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const c = out.getContext("2d");
  if (!settings.transparent) {
    c.fillStyle = bgColor();
    c.fillRect(0, 0, size, size);
  }
  drawStrokes(c, strokes, size);
  out.toBlob((b) => download("mandala.png", b), "image/png");
};

const f4 = (v) => +v.toFixed(3);

const svgPath = (pts) => {
  let d = `M${f4(pts[0][0])} ${f4(pts[0][1])}`;
  if (pts.length === 1) return d + `l0.0001 0`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${f4(pts[i][0])} ${f4(pts[i][1])} ${f4(mx)} ${f4(my)}`;
  }
  const last = pts[pts.length - 1];
  return d + `L${f4(last[0])} ${f4(last[1])}`;
};

const buildSvg = () => {
  const n = settings.folds;
  const attrs = (s) =>
    `fill="none" stroke-width="${s.w}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${s.a}"`;
  const defs = strokes
    .map((s, i) => {
      if (s.mode === "rainbow") {
        const segs = s.pts
          .map((p, k) => {
            const q = s.pts[Math.min(k + 1, s.pts.length - 1)];
            const col = rainbowColor((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
            const d = `M${f4(p[0])} ${f4(p[1])}L${f4(q[0] + (q === p ? 0.0001 : 0))} ${f4(q[1])}`;
            return `<path d="${d}" stroke="${col}"/>`;
          })
          .join("");
        return `<g id="s${i}" ${attrs(s)}>${segs}</g>`;
      }
      return `<path id="s${i}" d="${svgPath(s.pts)}" stroke="${s.color}" ${attrs(s)}/>`;
    })
    .join("\n");
  const uses = (t) => strokes.map((_, i) => `<use href="#s${i}"${t ? ` transform="${t}"` : ""}/>`).join("");
  const folds = [];
  for (let k = 0; k < n; k++) {
    const deg = f4((360 * k) / n);
    folds.push(`<g transform="rotate(${deg})">${uses()}</g>`);
    if (settings.mirror) folds.push(`<g transform="rotate(${deg}) scale(1 -1)">${uses()}</g>`);
  }
  const bg = settings.transparent ? "" : `<rect x="-1.02" y="-1.02" width="2.04" height="2.04" fill="${bgColor()}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-1.02 -1.02 2.04 2.04" width="1024" height="1024">
<title>Mandala (${n} folds${settings.mirror ? ", mirrored" : ""})</title>
${bg}
<defs>
${defs}
</defs>
<g transform="scale(0.98)">
${folds.join("\n")}
</g>
</svg>
`;
};

const saveSvg = () =>
  download("mandala.svg", new Blob([buildSvg()], { type: "image/svg+xml" }));

// ---------------------------------------------------------------- persistence

const saveSettings = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable -- not worth failing over
  }
};

const saveStrokes = () => {
  try {
    const s = JSON.stringify(strokes);
    if (s.length > MAX_SAVED_BYTES) return;
    localStorage.setItem(STROKES_KEY, s);
  } catch {
    // storage full/unavailable
  }
};

const restore = () => {
  try {
    const st = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (st && typeof st === "object") {
      for (const k of Object.keys(settings)) {
        if (typeof st[k] === typeof settings[k]) settings[k] = st[k];
      }
    }
    if (!BACKGROUNDS[settings.bg]) settings.bg = "dark";
    if (!COLOR_MODES.some((m) => m.id === settings.colorMode)) settings.colorMode = "solid";
    settings.folds = Math.min(24, Math.max(2, Math.round(settings.folds)));
    const list = JSON.parse(localStorage.getItem(STROKES_KEY) || "[]");
    if (
      Array.isArray(list) &&
      list.every((s) => s && Array.isArray(s.pts) && s.pts.length && typeof s.w === "number")
    ) {
      strokes = list;
    }
  } catch {
    // ignore corrupt saved data
  }
};

// ---------------------------------------------------------------- UI

const updateButtons = () => {
  $("btn-undo").disabled = !strokes.length && !lastCleared;
  $("btn-redo").disabled = !redoStack.length;
};

const renderChips = () => {
  $("color-mode").innerHTML = COLOR_MODES.map(
    (m) =>
      `<button type="button" data-mode="${m.id}" aria-pressed="${m.id === settings.colorMode}">${m.label}</button>`,
  ).join("");
  $("bg-chips").innerHTML = Object.entries(BACKGROUNDS)
    .map(
      ([id, b]) =>
        `<button type="button" data-bg="${id}" aria-pressed="${id === settings.bg}">${b.label}</button>`,
    )
    .join("");
  const custom = !PALETTE.includes(settings.color);
  $("swatches").innerHTML =
    PALETTE.map(
      (c) =>
        `<button type="button" class="swatch${
          settings.colorMode === "solid" && c === settings.color ? " selected" : ""
        }" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`,
    ).join("") +
    `<span class="swatch swatch-custom${
      settings.colorMode === "solid" && custom ? " selected" : ""
    }" title="Custom color"><input type="color" id="custom-color" value="${
      /^#[0-9a-f]{6}$/i.test(settings.color) ? settings.color : "#ffb74d"
    }" aria-label="Custom color" /></span>`;
};

const syncControls = () => {
  $("folds").value = settings.folds;
  $("folds-val").textContent = settings.folds;
  $("mirror").checked = settings.mirror;
  $("guides").checked = settings.guides;
  $("size").value = settings.size;
  $("size-val").textContent = settings.size;
  $("opacity").value = settings.opacity;
  $("opacity-val").textContent = settings.opacity + "%";
  $("transparent").checked = settings.transparent;
  renderChips();
};

const changed = (redraw = true) => {
  saveSettings();
  syncControls();
  if (redraw) fullRedraw();
};

const bind = () => {
  $("folds").addEventListener("input", (e) => {
    settings.folds = +e.target.value;
    $("folds-val").textContent = settings.folds;
    saveSettings();
    fullRedraw();
  });
  $("mirror").addEventListener("change", (e) => {
    settings.mirror = e.target.checked;
    changed();
  });
  $("guides").addEventListener("change", (e) => {
    settings.guides = e.target.checked;
    saveSettings();
    render();
  });
  $("size").addEventListener("input", (e) => {
    settings.size = +e.target.value;
    $("size-val").textContent = settings.size;
    saveSettings();
  });
  $("opacity").addEventListener("input", (e) => {
    settings.opacity = +e.target.value;
    $("opacity-val").textContent = settings.opacity + "%";
    saveSettings();
  });
  $("transparent").addEventListener("change", (e) => {
    settings.transparent = e.target.checked;
    saveSettings();
  });
  $("color-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    settings.colorMode = b.dataset.mode;
    changed(false);
  });
  $("bg-chips").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    settings.bg = b.dataset.bg;
    changed(false);
    render();
  });
  $("swatches").addEventListener("click", (e) => {
    const b = e.target.closest("button.swatch");
    if (!b) return;
    settings.color = b.dataset.color;
    settings.colorMode = "solid";
    changed(false);
  });
  $("swatches").addEventListener("input", (e) => {
    if (e.target.id !== "custom-color") return;
    settings.color = e.target.value;
    settings.colorMode = "solid";
    saveSettings();
  });
  $("swatches").addEventListener("change", (e) => {
    if (e.target.id !== "custom-color") return;
    settings.color = e.target.value;
    settings.colorMode = "solid";
    changed(false);
  });

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  window.addEventListener("resize", resize);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
  });
};

const initMandala = () => {
  canvas = $("mandala");
  ctx = canvas.getContext("2d");
  cache = document.createElement("canvas");
  cctx = cache.getContext("2d");
  restore();
  syncControls();
  bind();
  cssSize = 0;
  resize();
  updateButtons();
};
