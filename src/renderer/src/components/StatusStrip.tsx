import { useEffect, useState } from "react";
import { streamClient, type StreamMeta } from "@/lib/streamClient";
import { CODEC_LABEL } from "@/lib/dofus";
import type { SessionSettingsState } from "@/lib/settings";

interface Props {
  serial: string | null;
  settings: SessionSettingsState;
  connected: boolean;
  controller: string | null;
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">{label}</span>
      <span className={"text-[11px] tabular-nums" + (warn ? " text-primary" : " text-foreground/85")}>
        {value}
      </span>
    </span>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-border" />;
}

export function StatusStrip({ serial, settings, connected, controller }: Props) {
  const [meta, setMeta] = useState<StreamMeta | null>(null);

  useEffect(() => {
    if (!serial) return;
    setMeta(streamClient.metaFor(serial));
    return streamClient.subscribe((m) => {
      if (m.serial === serial) setMeta(m);
    });
  }, [serial]);

  const fps = meta?.fps ?? 0;
  const codec = meta?.codec ? CODEC_LABEL[meta.codec] ?? meta.codec : settings.codec.toUpperCase();

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-sidebar px-3 text-[11px]">
      <span className="flex items-center gap-1.5">
        <span
          className={
            "size-1.5 rounded-full " +
            (connected ? "bg-[var(--success)]" : "bg-muted-foreground/40")
          }
        />
        <span className={"text-[10px] uppercase tracking-[0.16em] " + (connected ? "text-primary" : "text-muted-foreground/70")}>
          {connected ? "online" : "idle"}
        </span>
      </span>

      <Divider />
      <Metric label="fps" value={fps ? String(fps) : "--"} warn={fps > 0 && fps < 25} />
      <Divider />
      <Metric label="codec" value={codec} />
      <Divider />
      <Metric
        label="res"
        value={meta?.width ? `${meta.width}x${meta.height}` : "--"}
      />
      <Divider />
      <Metric label="bitrate" value={`${settings.bitrateMbps}M`} />
      <Divider />
      <Metric label="drop" value={String(meta?.dropped ?? 0)} warn={(meta?.dropped ?? 0) > 0} />

      <span className="ml-auto flex items-center gap-3">
        <Metric label="pad" value={controller ? "connected" : "keyboard"} />
        <Divider />
        <Metric label="link" value={serial ? "usb" : "--"} />
      </span>
    </div>
  );
}