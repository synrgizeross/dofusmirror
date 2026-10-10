import { useState } from "react";
import {
  Camera,
  ChevronLeft,
  Circle,
  Grid3x3,
  Home,
  Maximize2,
  RotateCw,
  SlidersHorizontal,
  Square,
  Unplug,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MirrorCanvas } from "@/components/MirrorCanvas";
import { SessionSettings } from "@/components/SessionSettings";
import type { Device } from "@/lib/types";
import type { SessionSettingsState } from "@/lib/settings";

interface Props {
  device?: Device;
  settings: SessionSettingsState;
  onSettingsChange: (s: SessionSettingsState) => void;
  onDisconnect: () => void;
  onBack: () => void;
  onHome: () => void;
  onRecents: () => void;
  onRotate: () => void;
  onScreenshot: () => void;
  onRecord: () => void;
  recording: boolean;
  fps: number;
  onMeta?: (m: { fps: number; dropped: number; width: number; height: number; codec: string }) => void;
}

export function DesktopSurface({
  device,
  settings,
  onSettingsChange,
  onDisconnect,
  onBack,
  onHome,
  onRecents,
  onRotate,
  onScreenshot,
  onRecord,
  recording,
  fps,
  onMeta,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onDisconnect} className="h-8 gap-1.5 text-xs">
            <Unplug className="size-3.5" />
            Disconnect
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <ToggleGroup type="single" className="gap-0.5 p-0">
            <ToggleGroupItem value="back" onClick={onBack} aria-label="Back" className="size-8 p-0">
              <ChevronLeft className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="home" onClick={onHome} aria-label="Home" className="size-8 p-0">
              <Home className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="recents" onClick={onRecents} aria-label="Recents" className="size-8 p-0">
              <Grid3x3 className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="rotate" onClick={onRotate} aria-label="Rotate" className="size-8 p-0">
              <RotateCw className="size-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <span className="truncate text-xs text-muted-foreground">
          {device ? `${device.model || device.serial}` : "no device"}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            aria-label="Session settings"
            className="h-8 gap-1.5 text-xs"
          >
            <SlidersHorizontal className="size-3.5" />
            Settings
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onScreenshot} aria-label="Screenshot">
            <Camera className="size-4" />
          </Button>
          <Button
            variant={recording ? "destructive" : "outline"}
            size="sm"
            onClick={onRecord}
            className="h-8 gap-1.5 text-xs"
          >
            {recording ? <Square className="size-3.5" /> : <Circle className="size-3.5" />}
            {recording ? "Stop" : "Record"}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => document.documentElement.requestFullscreen?.()}
            aria-label="Fullscreen"
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <div className="absolute inset-0 flex items-center justify-center">
          {device && <MirrorCanvas serial={device.serial} className="max-h-full max-w-full object-contain" onMeta={onMeta} reticle={settings.touchReticle} />}
        </div>

        {!device && (
          <p className="max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
            No session running. Pick a device and connect to start mirroring.
          </p>
        )}

        <div className="absolute bottom-3 left-3 flex items-center gap-2 font-mono text-[11px] text-white/55">
          <span className="tabular-nums">{fps} fps</span>
          <Separator orientation="vertical" className="h-3 bg-white/20" />
          <span className="tabular-nums">{settings.bitrateMbps} Mbps</span>
          <Separator orientation="vertical" className="h-3 bg-white/20" />
          <span className="tabular-nums">
            {settings.codec === "auto" ? "auto→h265" : settings.codec}
          </span>
          {settings.audio === "off" ? (
            <VolumeX className="size-3" />
          ) : (
            <Volume2 className="size-3" />
          )}
        </div>
      </div>

      <SessionSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={settings}
        onChange={onSettingsChange}
        gameActive={false}
      />
    </div>
  );
}