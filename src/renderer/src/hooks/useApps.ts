import { useEffect, useRef, useState } from "react";
import { bridge } from "@/lib/bridge";
import type { InstalledApp } from "@/lib/types";

export function useApps(serial: string | null) {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!serial) {
      setApps([]);
      return;
    }
    let alive = true;
    setLoading(true);
    bridge
      .listApps(serial)
      .then((next) => {
        if (alive) setApps(next);
      })
      .catch(() => {
        if (alive) setApps([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [serial]);

  return { apps, loading };
}