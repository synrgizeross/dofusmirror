export const DOFUS_PACKAGE = "com.ankama.dofustouch";
export const DOFUS_ACTIVITY = "com.ankama.dofustouch/.MainActivity";
export const DOFUS_NAME = "Dofus Touch";

export type BindingAction =
  | "move_up"
  | "move_down"
  | "move_left"
  | "move_right"
  | "skill_1"
  | "skill_2"
  | "skill_3"
  | "skill_4"
  | "skill_5"
  | "skill_6"
  | "attack"
  | "open_chat"
  | "open_inventory"
  | "open_map"
  | "toggle_ready";

export interface Binding {
  action: BindingAction;
  label: string;
  group: "Movement" | "Skills" | "Chat" | "Interface";
  keys: string[];
}

/** Default keyboard bindings. Tuned for a tactical MMO played in landscape. */
export const DEFAULT_BINDINGS: Binding[] = [
  { action: "move_up", label: "Move up", group: "Movement", keys: ["KeyW", "ArrowUp"] },
  { action: "move_down", label: "Move down", group: "Movement", keys: ["KeyS", "ArrowDown"] },
  { action: "move_left", label: "Move left", group: "Movement", keys: ["KeyA", "ArrowLeft"] },
  { action: "move_right", label: "Move right", group: "Movement", keys: ["KeyD", "ArrowRight"] },

  { action: "attack", label: "Attack", group: "Skills", keys: ["Space"] },
  { action: "skill_1", label: "Skill 1", group: "Skills", keys: ["Digit1"] },
  { action: "skill_2", label: "Skill 2", group: "Skills", keys: ["Digit2"] },
  { action: "skill_3", label: "Skill 3", group: "Skills", keys: ["Digit3"] },
  { action: "skill_4", label: "Skill 4", group: "Skills", keys: ["Digit4"] },
  { action: "skill_5", label: "Skill 5", group: "Skills", keys: ["Digit5"] },
  { action: "skill_6", label: "Skill 6", group: "Skills", keys: ["Digit6"] },

  { action: "open_chat", label: "Open chat", group: "Chat", keys: ["KeyT"] },
  { action: "open_inventory", label: "Inventory", group: "Interface", keys: ["KeyI"] },
  { action: "open_map", label: "Map", group: "Interface", keys: ["KeyM"] },
  { action: "toggle_ready", label: "Ready state", group: "Interface", keys: ["KeyR"] },
];

const KEY = "md:dofus-bindings:v1";

export function loadBindings(): Binding[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_BINDINGS;
    const known = new Map(DEFAULT_BINDINGS.map((b) => [b.action, b]));
    return raw
      .map((b) => {
        const base = known.get(b.action);
        return base ? { ...base, keys: Array.isArray(b.keys) ? b.keys : base.keys } : null;
      })
      .filter(Boolean) as Binding[];
  } catch {
    return DEFAULT_BINDINGS;
  }
}

export function saveBindings(bindings: Binding[]) {
  localStorage.setItem(KEY, JSON.stringify(bindings));
}

export function resetBindings() {
  localStorage.removeItem(KEY);
  return DEFAULT_BINDINGS;
}

/** KeyCoder-style keycode for the Android text/key bridge. */
export const ANDROID_KEYCODES: Record<string, number> = {
  Space: 62,
  Enter: 66,
  Backspace: 67,
  Tab: 61,
  KeyT: 48,
  KeyI: 43,
  KeyM: 50,
  KeyR: 46,
};
export const CODEC_LABEL: Record<string, string> = {
  avc1: "H.264",
  hvc1: "H.265",
  hev1: "H.265",
};
