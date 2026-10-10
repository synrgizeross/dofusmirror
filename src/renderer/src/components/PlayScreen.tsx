import { Gamepad2, Play, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useGamepad } from "@/hooks/useGamepad";
import { DOFUS_NAME } from "@/lib/dofus";
import type { Binding } from "@/lib/dofus";
import type { Device } from "@/lib/types";

interface Props {
  devices: Device[];
  activeSerial: string | null;
  onPlay: () => void;
  onOpenBindings: () => void;
  onOpenSettings: () => void;
  bindings: Binding[];
  installed: boolean;
  launching: boolean;
  error?: string | null;
}

export function PlayScreen({
  devices,
  activeSerial,
  onPlay,
  onOpenBindings,
  onOpenSettings,
  bindings,
  installed,
  launching,
  error,
}: Props) {
  const pads = useGamepad();
  const device = devices.find((d) => d.serial === activeSerial);
  const online = devices.filter((d) => d.state === "device").length;
  const ready = !!device && device.state === "device" && installed;
  const mappedKeys = bindings.reduce((n, b) => n + b.keys.length, 0);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-xl px-8 pt-12 pb-10">
        <h1 className="text-[30px] font-semibold leading-none tracking-tight">{DOFUS_NAME}</h1>
        <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
          Streamed from your phone. Fullscreen or windowed, driven by keyboard or controller.
        </p>

        <div className="mt-7 flex items-center gap-2">
          <Button id="md-play" size="lg" onClick={onPlay} disabled={!ready || launching} className="h-10 gap-2 px-5">
            <Play className="size-4" />
            {launching ? "Starting" : "Play"}
          </Button>
          <Button variant="outline" size="lg" onClick={onOpenBindings} className="h-10 px-4">
            Bindings
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="size-4" />
          </Button>
        </div>

        {(error || !ready) && (
          <p className="mt-4 text-xs leading-relaxed text-destructive">
            {error ??
              (!online
                ? "No device connected."
                : !installed
                  ? `${DOFUS_NAME} is not installed on this device.`
                  : "Selected device is not ready.")}
          </p>
        )}

        <Separator className="my-8" />

        <dl className="space-y-3.5 text-xs">
          <div className="flex items-baseline justify-between gap-6">
            <dt className="text-muted-foreground">Device</dt>
            <dd className="truncate font-medium">
              {device ? device.model || device.serial : "none"}
              {typeof device?.battery === "number" && (
                <span className="ml-2 tabular-nums text-muted-foreground">{device.battery}%</span>
              )}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-6">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <Gamepad2 className="size-3.5" />
              Controller
            </dt>
            <dd className="flex items-center gap-2">
              {pads.length ? (
                <>
                  <span className="max-w-[30ch] truncate font-medium">{pads[0].id}</span>
                  <Badge
                    variant="outline"
                    className="h-5 rounded-full border-[var(--success)]/40 px-1.5 text-[10px] text-[var(--success)]"
                  >
                    ready
                  </Badge>
                </>
              ) : (
                <span className="text-muted-foreground">keyboard only</span>
              )}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-6">
            <dt className="text-muted-foreground">Keys mapped</dt>
            <dd className="tabular-nums">{mappedKeys}</dd>
          </div>

          <div className="flex items-baseline justify-between gap-6">
            <dt className="text-muted-foreground">Devices online</dt>
            <dd className="tabular-nums">{online}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}