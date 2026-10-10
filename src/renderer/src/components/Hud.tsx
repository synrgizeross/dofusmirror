import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  visible: boolean;
  serial: string;
  stats: { fps: number; dropped: number; decodeMs: number; latencyMs: number };
  onExit: () => void;
}

export function Hud({ visible, serial, stats, onExit }: Props) {
  const [pad, setPad] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const list = navigator.getGamepads?.() ?? [];
    const p = [...list].find((g) => g && g.connected);
    setPad(p ? p.id.slice(0, 24) : null);
  }, [visible]);

  if (!visible) return null;

  const rows: [string, string][] = [
    ["fps", String(stats.fps)],
    ["dropped", String(stats.dropped)],
    ["decode", `${stats.decodeMs} ms`],
    ["input", `${stats.latencyMs} ms`],
  ];

  return (
    <div
      className={
        "absolute inset-x-0 top-0 flex items-center justify-between gap-6 px-4 py-3 font-mono text-[11px] " +
        "text-white/70 transition-opacity duration-300"
      }
    >
      <div className="flex items-center gap-4">
        {rows.map(([k, v]) => (
          <span key={k} className="flex items-baseline gap-1.5">
            <span className="text-white/35">{k}</span>
            <span className="tabular-nums text-white/80">{v}</span>
          </span>
        ))}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-white/35">{pad ?? "no controller"}</span>
        <span className="hidden max-w-[18ch] truncate text-white/35 sm:inline">{serial}</span>
        <Button
          variant="outline"
          size="xs"
          onClick={onExit}
          className="border-white/25 bg-transparent text-white/75 hover:bg-white/10 hover:text-white"
        >
          esc exit
        </Button>
      </div>
    </div>
  );
}