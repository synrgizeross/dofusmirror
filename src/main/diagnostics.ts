import * as os from "os";
import { app } from "electron";
import * as adb from "./adb";
import { APP_NAME } from "./product";

interface Check {
  name: string;
  status: "ok" | "warn" | "err";
  detail: string;
  weight: number;
}

const BRAND_HINTS: Record<string, string> = {
  Xiaomi: "HyperOS often blocks REMOTE_SUBMIX audio capture and needs USB debugging re-enabled after reboot.",
  samsung: "Disable 'USB debugging (Security settings)' blockers and keep 'Install via USB' enabled for some flows.",
  Google: "If the phone stays unauthorized, revoke USB debugging authorizations and re-accept the prompt.",
};

export async function runDiagnostics(): Promise<Record<string, unknown>> {
  const checks: Check[] = [];
  const add = (name: string, status: Check["status"], detail: string, weight = 1) =>
    checks.push({ name, status, detail, weight });

  const adbPath = adb.findAdb();
  add("adb binary", adbPath ? "ok" : "err", adbPath || "not found", 3);

  let version = "";
  if (adbPath) {
    try {
      version = (await adb.probe("version")).split("\n")[0] || "ok";
    } catch {
      version = "unavailable";
    }
  }
  add("adb version", version.includes("1.0") ? "ok" : "warn", version, 1);

  let devices: adb.AdbDevice[] = [];
  try {
    devices = await adb.listDevices();
    add("device", devices.length ? "ok" : "warn", devices.length ? `${devices.length} found` : "none detected", 2);
  } catch (e) {
    add("device", "err", e instanceof Error ? e.message : String(e), 2);
  }

  const unauthorized = devices.filter((d) => d.state === "unauthorized");
  if (unauthorized.length) add("authorization", "warn", `${unauthorized.length} awaiting prompt`, 2);

  const offline = devices.filter((d) => d.state === "offline");
  if (offline.length) add("connection", "warn", `${offline.length} offline`, 2);

  try {
    const ready = devices.find((d) => d.state === "device");
    const fps = await adb.benchmarkFps(ready ? ready.serial : "");
    add("bandwidth", fps >= 20 ? "ok" : fps > 0 ? "warn" : "err", fps > 0 ? `${fps.toFixed(1)} MB/s` : "no data", 2);
  } catch {
    add("bandwidth", "warn", "not measured", 1);
  }

  const platform = `${os.platform()} ${os.arch()}`;
  add("host", "ok", `${platform} · node ${process.versions.node}`, 1);
  add("app", "ok", `${APP_NAME} · electron ${process.versions.electron ?? "n/a"}`, 1);

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const got = checks.reduce((a, c) => a + (c.status === "ok" ? c.weight : c.status === "warn" ? c.weight * 0.5 : 0), 0);
  const score = Math.round((got / Math.max(total, 1)) * 100);

  const brand = devices.find((d) => /xiaomi|redmi|poco/i.test(d.model))?.model;
  const hint = brand ? { title: `${brand} notes`, text: BRAND_HINTS.Xiaomi } : null;

  const report = [
    `${APP_NAME} diagnostics`,
    `date: ${new Date().toISOString()}`,
    `score: ${score}/100`,
    ...checks.map((c) => `- ${c.name}: ${c.status} (${c.detail})`),
    `host: ${platform}`,
  ].join("\n");

  void app;
  return { score, checks: checks.map(({ weight, ...rest }) => rest), report, brandHint: hint };
}
