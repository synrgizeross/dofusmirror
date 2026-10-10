export type Codec = "auto" | "h264" | "h265";
export type Quality = "performance" | "balanced" | "quality" | "max";
export type DisplayMode =
  | "physical"
  | "1920x1080/320" | "1280x720/240" | "1080x1920/320" | "1920x1200/240" | "2560x1600/280";
export type ResponseCurve = "linear" | "exponential";

export interface SessionSettingsState {
  codec: Codec;
  quality: Quality;
  display: DisplayMode;
  audio: "off" | "mic";
  stayAwake: boolean;
  clipboardSync: boolean;
  bitrateMbps: number;
  latencyMode: boolean;
  deadzone: number;
  turboHz: number;
  curve: ResponseCurve;
}

export const DEFAULT_SETTINGS: SessionSettingsState = {
  codec: "h264",
  quality: "balanced",
  display: "physical",
  audio: "off",
  stayAwake: true,
  clipboardSync: true,
  bitrateMbps: 12,
  latencyMode: false,
  deadzone: 0.18,
  turboHz: 0,
  curve: "linear",
};

export const QUALITY_PRESETS: Record<Quality, { maxFps: number; bitrate: number; label: string }> = {
  performance: { maxFps: 30, bitrate: 6_000_000, label: "Performance" },
  balanced: { maxFps: 60, bitrate: 8_000_000, label: "Balanced" },
  quality: { maxFps: 60, bitrate: 14_000_000, label: "Quality+" },
  max: { maxFps: 60, bitrate: 20_000_000, label: "Max" },
};

export const DISPLAY_PRESETS: { value: DisplayMode; label: string }[] = [
  { value: "physical", label: "Physical screen" },
  { value: "1920x1080/320", label: "Virtual 1920x1080" },
  { value: "1280x720/240", label: "Virtual 1280x720" },
  { value: "1080x1920/320", label: "Virtual 1080x1920 (portrait)" },
  { value: "1920x1200/240", label: "Virtual 1920x1200" },
  { value: "2560x1600/280", label: "Virtual 2560x1600" },
];

const KEY = "md:settings:v1";

export function loadSettings(): SessionSettingsState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    const merged = { ...DEFAULT_SETTINGS, ...raw };
    // Radix Select reserves "" as "no value", so an empty display never rendered.
    // Older persisted settings used "" to mean the physical screen.
    if (!merged.display) merged.display = "physical";
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function persistSettings(s: SessionSettingsState) {
  localStorage.setItem(KEY, JSON.stringify(s));
}