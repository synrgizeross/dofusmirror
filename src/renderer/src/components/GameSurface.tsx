import { useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hud } from "@/components/Hud";
import { MirrorCanvas } from "@/components/MirrorCanvas";
import type { Binding } from "@/lib/dofus";
import type { Device } from "@/lib/types";

interface Props {
  app: string;
  serial: string;
  bindings: Binding[];
  devices: Device[];
  active: boolean;
  onSelectDevice: (serial: string) => void;
  reticle?: boolean;
  onExit: () => void;
}

/** Lives inside the app shell as a tab - it never takes over the window. */
export function GameSurface({ app, serial, bindings, devices, active, reticle = false, onSelectDevice, onExit }: Props) {
  const [hudVisible, setHudVisible] = useState(false);
  const [devicePicker, setDevicePicker] = useState(false);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [stats, setStats] = useState({ fps: 0, dropped: 0 });
  const fadeTimer = useRef<number | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const fade = () => {
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(() => setHudVisible(false), 2500);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key === "Escape") {
        if (devicePicker) {
          setDevicePicker(false);
          return;
        }
        e.preventDefault();
        onExit();
        return;
      }
      if (e.key === "d" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setDevicePicker((v) => !v);
        setHudVisible(true);
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else surfaceRef.current?.requestFullscreen().catch(() => {});
      }
      if (e.key === "Tab") {
        e.preventDefault();
        setHudVisible(true);
        return;
      }
      fade();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    };
  }, [active, devicePicker, onExit]);

  return (
    <div ref={surfaceRef} className="flex min-h-0 flex-1 flex-col bg-black">
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <MirrorCanvas
          serial={serial}
          className="max-h-full max-w-full rounded-md"
          reticle={reticle}
          onMeta={(m) => setStats({ fps: m.fps, dropped: m.dropped })}
        />

        {stats.fps === 0 && (
          <p className="absolute font-mono text-[11px] text-white/45">
            waiting for stream · {app}
          </p>
        )}

        <div className="absolute right-5 top-5 flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
              else surfaceRef.current?.requestFullscreen().catch(() => {});
            }}
            className="h-7 bg-black/55 text-[11px] backdrop-blur-sm hover:bg-black/75"
          >
            <Maximize2 className="size-3" />
            {fullscreen ? "Window" : "Fullscreen"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onExit}
            className="h-7 bg-black/55 text-[11px] backdrop-blur-sm hover:bg-black/75"
          >
            Stop
          </Button>
        </div>

        {devicePicker && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-[min(22rem,80vw)] overflow-hidden rounded-xl border border-border bg-popover">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-medium">Switch device</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The session moves to the chosen phone and reconnects.
                </p>
              </div>
              <div className="p-2">
                {devices
                  .filter((d) => d.state === "device")
                  .map((d) => (
                    <Button
                      key={d.serial}
                      variant="ghost"
                      onClick={() => {
                        onSelectDevice(d.serial);
                        setDevicePicker(false);
                      }}
                      className={
                        "h-auto w-full justify-start gap-2.5 whitespace-normal px-3 py-2 text-left " +
                        (d.serial === serial ? "bg-accent" : "")
                      }
                    >
                      <span
                        className={
                          "size-1.5 shrink-0 rounded-full " +
                          (d.serial === serial ? "bg-primary" : "bg-[var(--success)]")
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {d.model || d.serial}
                      </span>
                      {typeof d.battery === "number" && (
                        <span className="font-mono text-[11px] font-normal text-muted-foreground">
                          {d.battery}%
                        </span>
                      )}
                    </Button>
                  ))}
                {devices.filter((d) => d.state === "device").length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">No devices online.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Hud visible={hudVisible} serial={serial} stats={{ ...stats, decodeMs: 0, latencyMs: 0 }} onExit={onExit} />
    </div>
  );
}