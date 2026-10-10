const kbState = {
  editing: false,
  marks: [],
  selected: -1,
  dragging: -1,
};

function keybindsStoreKey() {
  return `keybinds:${localStorage.getItem("activeSerial") || "none"}`;
}

function loadKeybinds() {
  try {
    kbState.marks = JSON.parse(localStorage.getItem(keybindsStoreKey()) || "[]");
  } catch {
    kbState.marks = [];
  }
  kbState.selected = -1;
}

function saveKeybinds() {
  try {
    localStorage.setItem(keybindsStoreKey(), JSON.stringify(kbState.marks));
  } catch {}
}

function keyLabel(e) {
  if (e.key.length === 1) return e.key.toUpperCase();
  const map = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Enter: "ENT",
    Space: "SPC",
    Escape: "ESC",
    Tab: "TAB",
    Backspace: "BSP",
    F1: "F1",
    F2: "F2",
    F3: "F3",
    F4: "F4",
    F5: "F5",
    F6: "F6",
    F7: "F7",
    F8: "F8",
    F9: "F9",
    F10: "F10",
    F11: "F11",
    F12: "F12",
  };
  return map[e.key] || e.key.toUpperCase();
}

function devicePointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  if (videoW === 0 || videoH === 0) return null;
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null;
  return { nx: Math.min(nx, 0.999), ny: Math.min(ny, 0.999) };
}

function drawKeybinds() {
  const ctx = kbCanvas.getContext("2d");
  ctx.clearRect(0, 0, kbCanvas.width, kbCanvas.height);
  for (let i = 0; i < kbState.marks.length; i++) {
    const m = kbState.marks[i];
    const x = m.nx * kbCanvas.width;
    const y = m.ny * kbCanvas.height;
    const r = kbState.editing ? 20 : 15;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = i === kbState.selected ? "rgba(79,140,255,0.45)" : "rgba(20,24,32,0.55)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = i === kbState.selected ? "#4f8cff" : "rgba(255,255,255,0.75)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(m.key || "?", x, y);
  }
}

function setKeybindMode(on) {
  kbState.editing = on;
  kbState.selected = -1;
  kbCanvas.classList.toggle("editing", on);
  document.body.classList.toggle("keybind-edit", on);
  btnKeybinds.classList.toggle("active", on);
  if (on) {
    log("keybind edit mode: click to add a marker, press a key to bind, right-click deletes");
  } else {
    log("keybind mode off");
  }
  drawKeybinds();
}

function tapAt(nx, ny) {
  const x = Math.round(nx * videoW);
  const y = Math.round(ny * videoH);
  bridge.touch(0, x, y, videoW, videoH, 1);
  bridge.touch(1, x, y, videoW, videoH, 0);
}

function handleKeybindEvent(e) {
  if (!kbState.editing || !connected || videoW === 0) return;
  const pt = devicePointFromEvent(e);
  if (!pt) return;
  if (e.button === 2) return;
  e.preventDefault();

  for (let i = 0; i < kbState.marks.length; i++) {
    const m = kbState.marks[i];
    const mx = m.nx * kbCanvas.width;
    const my = m.ny * kbCanvas.height;
    if (Math.hypot(e.clientX - kbCanvas.getBoundingClientRect().left - mx, e.clientY - kbCanvas.getBoundingClientRect().top - my) < 26) {
      kbState.dragging = i;
      kbState.selected = i;
      drawKeybinds();
      return;
    }
  }
  kbState.marks.push({ nx: pt.nx, ny: pt.ny, key: "" });
  kbState.selected = kbState.marks.length - 1;
  saveKeybinds();
  drawKeybinds();
}

kbCanvas.addEventListener("mousedown", handleKeybindEvent);

kbCanvas.addEventListener("mousemove", (e) => {
  if (!kbState.editing || kbState.dragging < 0) return;
  const pt = devicePointFromEvent(e);
  if (!pt) return;
  kbState.marks[kbState.dragging].nx = pt.nx;
  kbState.marks[kbState.dragging].ny = pt.ny;
  drawKeybinds();
});

window.addEventListener("mouseup", () => {
  if (kbState.dragging >= 0) {
    kbState.dragging = -1;
    saveKeybinds();
  }
});

kbCanvas.addEventListener("contextmenu", (e) => {
  if (!kbState.editing) return;
  e.preventDefault();
  const pt = devicePointFromEvent(e);
  if (!pt) return;
  const rect = kbCanvas.getBoundingClientRect();
  for (let i = kbState.marks.length - 1; i >= 0; i--) {
    const m = kbState.marks[i];
    const mx = m.nx * kbCanvas.width;
    const my = m.ny * kbCanvas.height;
    if (Math.hypot(e.clientX - rect.left - mx, e.clientY - rect.top - my) < 26) {
      kbState.marks.splice(i, 1);
      kbState.selected = -1;
      saveKeybinds();
      drawKeybinds();
      return;
    }
  }
});