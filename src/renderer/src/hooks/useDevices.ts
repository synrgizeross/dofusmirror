import { useEffect, useState } from "react";
import { bridge } from "@/lib/bridge";
import type { Device } from "@/lib/types";

export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await bridge.listDevices();
        if (alive) setDevices(next);
      } catch {
        /* device list is best-effort; the UI shows the empty state */
      }
    };
    load();
    const t = setInterval(load, 2500);
    bridge.onDevicesChanged(load);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return devices;
}