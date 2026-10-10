export interface Device {
  serial: string;
  model?: string;
  state: string;
  battery?: number;
  hardwareSerial?: string;
  altSerial?: string;
}

export interface InstalledApp {
  package: string;
  activity: string;
  label: string;
  labelRes: string | null;
  iconRes: string | null;
  sourceDir: string | null;
  system: boolean;
}

export interface EngineOptions {
  maxSize?: number;
  maxFps?: number;
  videoBitRate?: number;
  videoCodec?: "h264" | "h265";
  stayAwake?: boolean;
  audio?: boolean;
  newDisplay?: string | null;
  autoLaunchPackage?: string | null;
  clipboardAutosync?: boolean;
}

export interface ControlProfile {
  package: string;
  name: string;
  mappingMode: "virtual-pad" | "direct";
  zones: ControlZone[];
  deadzone: number;
  turboHz: number;
  responseCurve: "linear" | "exponential";
  updatedAt: number;
}

export interface ControlZone {
  id: string;
  label: string;
  /** normalised 0..1 within the video area */
  nx: number;
  ny: number;
  radius: number;
  inputs: string[];
}