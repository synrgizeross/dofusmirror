import { Gamepad2, PlugZap, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGamepad } from "@/hooks/useGamepad";
import type { Device } from "@/lib/types";

interface Props {
  devices: Device[];
  activeSerial: string | null;
  onSelect: (serial: string) => void;
  deviceView: boolean;
  onToggleDeviceView: () => void;
}

export function TopBar({ devices, activeSerial, onSelect, deviceView, onToggleDeviceView }: Props) {
  const pads = useGamepad();
  const online = devices.filter((d) => d.state === "device");

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border px-4">
      <div className="flex items-center gap-2.5">
        <span className="size-2 rounded-full bg-primary" />
        <span className="text-[15px] font-semibold tracking-tight">DofusMirror</span>
      </div>

      <div className="ml-2 flex items-center gap-1.5">
        {online.length === 0 && <span className="text-xs text-muted-foreground">No device</span>}
        {online.map((d) => {
          const active = d.serial === activeSerial;
          return (
            <Button
              key={d.serial}
              variant={active ? "secondary" : "outline"}
              size="sm"
              onClick={() => onSelect(d.serial)}
              aria-pressed={active}
              className={
                "h-8 gap-2 px-2.5 text-xs" +
                (active
                  ? " border border-primary/40 bg-primary/10 text-foreground"
                  : " text-muted-foreground hover:text-foreground")
              }
            >
              <PlugZap className="size-3.5" />
              <span className="max-w-[13ch] truncate font-medium">{d.model || d.serial}</span>
              {typeof d.battery === "number" && (
                <span className="text-[11px] tabular-nums text-muted-foreground">{d.battery}%</span>
              )}
            </Button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant={deviceView ? "secondary" : "ghost"}
          size="sm"
          onClick={onToggleDeviceView}
          aria-label="Toggle device view"
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Smartphone className="size-3.5" />
          {deviceView ? "Back to game" : "Device view"}
        </Button>
        <Badge
          variant="outline"
          className={
            "h-7 gap-1.5 rounded-full px-2.5 text-[11px] " +
            (pads.length ? "border-primary/40 text-foreground" : "text-muted-foreground")
          }
        >
          <Gamepad2 className="size-3.5" />
          {pads.length ? pads[0].id.slice(0, 22) : "No controller"}
        </Badge>
      </div>
    </header>
  );
}