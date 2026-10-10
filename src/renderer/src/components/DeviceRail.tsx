import { Smartphone, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Device } from "@/lib/types";

interface Props {
  devices: Device[];
  activeSerial: string | null;
  onSelect: (serial: string) => void;
}

function transport(d: Device) {
  if (d.serial.includes(":")) return "wireless";
  if (d.altSerial) return "usb + wireless";
  return "usb";
}

export function DeviceRail({ devices, activeSerial, onSelect }: Props) {
  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="px-4 pb-2 pt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Devices
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 pb-2">
        {devices.length === 0 && (
          <p className="px-2 py-6 text-xs leading-relaxed text-muted-foreground">
            No devices found. Enable USB debugging, plug in a phone, and accept the prompt.
          </p>
        )}

        {devices.map((d) => {
          const ready = d.state === "device";
          const active = d.serial === activeSerial;
          return (
            <Button
              key={d.serial}
              variant="ghost"
              onClick={() => ready && onSelect(d.serial)}
              disabled={!ready}
              aria-pressed={active}
              className={
                "mb-1 h-auto w-full justify-start gap-2.5 whitespace-normal px-2.5 py-2 text-left disabled:opacity-45 " +
                (active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60")
              }
            >
              <span
                className={
                  "size-1.5 shrink-0 rounded-full " +
                  (ready ? "bg-[var(--success)]" : d.state === "unauthorized" ? "bg-primary" : "bg-destructive")
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-tight">
                  {d.model || d.serial}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                  {transport(d) === "usb" ? <Smartphone className="size-3" /> : <Wifi className="size-3" />}
                  {ready ? "ready" : d.state}
                </span>
              </span>
              {typeof d.battery === "number" && (
                <span className="font-mono text-[11px] font-normal tabular-nums text-muted-foreground">
                  {d.battery}%
                </span>
              )}
            </Button>
          );
        })}
      </div>
      </ScrollArea>

    </aside>
  );
}