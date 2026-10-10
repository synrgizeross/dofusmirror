import { runShell } from "./adb";

/**
 * A launchable app discovered on a device.
 *
 * `label` is currently derived from the package name because Android does not
 * expose resolved app labels over adb - `dumpsys` only gives `labelRes`, a
 * resource id. Getting real labels/icons requires a PackageManager query
 * executed on-device (our engine jar is the natural place for it), which will
 * fill in `label`/`icon` without changing this shape.
 */
export interface InstalledApp {
  package: string;
  activity: string;
  label: string;
  labelRes: string | null;
  iconRes: string | null;
  sourceDir: string | null;
  system: boolean;
}

const SYSTEM_PREFIXES = [
  "com.android.",
  "com.google.android.",
  "com.miui.",
  "miui.",
  "com.xiaomi.",
  "android.",
  "com.qualcomm.",
  "org.chromium.",
  "com.mediatek.",
];

function isSystemPackage(pkg: string) {
  return SYSTEM_PREFIXES.some((p) => pkg.startsWith(p));
}

const GENERIC_SEGMENTS = new Set([
  "android", "app", "apps", "mobile", "pro", "free", "apk", "main", "release",
  "global", "com", "org", "net", "cn", "io", "co", "beta", "client", "application",
  "activity", "ui", "phone", "game", "games", "sdk", "core", "base", "service",
]);

/** com.snapchat.android -> "Snapchat"; com.duocards.app -> "Duocards" */
function labelFromPackage(pkg: string): string {
  const segments = pkg.split(".").filter(Boolean);
  const meaningful = segments.filter((s, i) => !(i === 0 && GENERIC_SEGMENTS.has(s.toLowerCase())));
  const named = meaningful.filter((s) => !GENERIC_SEGMENTS.has(s.toLowerCase()));
  const source = (named.length ? named : meaningful).pop() ?? pkg;
  return source
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function field(block: string, key: string): string | null {
  const m = block.match(new RegExp(`\\b${key}=([^\\s]+)`));
  return m ? m[1] : null;
}

export async function listLaunchableApps(serial: string): Promise<InstalledApp[]> {
  const out = await runShell(
    serial,
    "cmd package query-activities -a android.intent.action.MAIN -c android.intent.category.LAUNCHER",
    60000,
  );

  const seen = new Map<string, InstalledApp>();
  // Each entry starts with "  Activity #N:"
  const blocks = out.split(/Activity #\d+:/).slice(1);

  for (const block of blocks) {
    const pkg = field(block, "packageName");
    const activity = field(block, "name");
    if (!pkg || !activity) continue;
    const key = `${pkg}/${activity}`;
    if (seen.has(key)) continue;
    const sourceDir = field(block, "sourceDir");
    const system = isSystemPackage(pkg) || !!sourceDir?.startsWith("/system");

    seen.set(key, {
      package: pkg,
      activity,
      label: labelFromPackage(pkg),
      labelRes: field(block, "labelRes"),
      iconRes: field(block, "icon"),
      sourceDir,
      system,
    });
  }

  const apps = [...seen.values()];
  // Third-party first, alphabetical - this is the library the player actually browses.
  apps.sort((a, b) => Number(a.system) - Number(b.system) || a.label.localeCompare(b.label));
  return apps;
}