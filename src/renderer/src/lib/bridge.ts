import type { ControlProfile, Device, EngineOptions, InstalledApp } from "./types";

export interface Bridge {
  listDevices(): Promise<Device[]>;
  listApps(serial: string): Promise<InstalledApp[]>;
  launchApp(serial: string, pkg: string, activity?: string): Promise<{ ok: boolean; out?: string; error?: string }>;
  connect(serial: string, options: EngineOptions): Promise<unknown>;
  disconnect(serial?: string): Promise<unknown>;
  touch(action: number, x: number, y: number, w: number, h: number, pressure: number): Promise<unknown>;
  scroll(x: number, y: number, w: number, h: number, hv: number, vv: number, buttons: number): Promise<unknown>;
  keyPress(keycode: number, metastate: number): Promise<unknown>;
  text(t: string): Promise<unknown>;
  key(action: number, keycode: number, metastate: number): Promise<unknown>;
  rotate(): Promise<unknown>;
  displayPower(on: boolean): Promise<unknown>;
  screenshot(): Promise<unknown>;
  saveRecording(bytes: ArrayBuffer): Promise<unknown>;
  wifiEnable(serial: string): Promise<unknown>;
  wifiConnect(hostPort: string): Promise<unknown>;
  pasteClipboard(): Promise<{ ok: boolean; length?: number; error?: string }>;
  onDevicesChanged(cb: () => void): void;
  onLog(cb: (p: { serial: string; line: string }) => void): void;
  onSessionClosed(cb: (p: { serial: string }) => void): void;
  onVideoMeta(cb: (p: { serial: string; codec: string }) => void): void;
  onVideoSize(cb: (p: { serial: string; width: number; height: number }) => void): void;
}

declare global {
  interface Window {
    api: Bridge;
  }
}

export const bridge: Bridge = window.api;

const PROFILE_KEY = "md:profiles:v1";

export function loadProfiles(): Record<string, ControlProfile> {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveProfile(profile: ControlProfile) {
  const all = loadProfiles();
  all[profile.package] = profile;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
}

export function deleteProfile(pkg: string) {
  const all = loadProfiles();
  delete all[pkg];
  localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
}

export function profileFor(pkg: string): ControlProfile | undefined {
  return loadProfiles()[pkg];
}

export function defaultProfile(pkg: string, name: string): ControlProfile {
  return {
    package: pkg,
    name,
    mappingMode: "virtual-pad",
    zones: [],
    deadzone: 0.18,
    turboHz: 0,
    responseCurve: "linear",
    updatedAt: Date.now(),
  };
}