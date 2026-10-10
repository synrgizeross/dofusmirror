import { useEffect, useMemo, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BindingsSheet } from "@/components/BindingsSheet";
import { DesktopSurface } from "@/components/DesktopSurface";
import { DeviceRail } from "@/components/DeviceRail";
import { GameSurface } from "@/components/GameSurface";
import { PlayScreen } from "@/components/PlayScreen";
import { StatusStrip } from "@/components/StatusStrip";
import { TopBar } from "@/components/TopBar";
import { SessionSettings } from "@/components/SessionSettings";
import { useApps } from "@/hooks/useApps";
import { useDevices } from "@/hooks/useDevices";
import { useGamepad } from "@/hooks/useGamepad";
import { bridge } from "@/lib/bridge";
import {
  DOFUS_ACTIVITY,
  DOFUS_NAME,
  DOFUS_PACKAGE,
  loadBindings,
  resetBindings,
  saveBindings,
  type Binding,
} from "@/lib/dofus";
import { loadSettings, persistSettings, QUALITY_PRESETS } from "@/lib/settings";

export function App() {
  const devices = useDevices();
  const [activeSerial, setActiveSerial] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [deviceView, setDeviceView] = useState(false);
  const [bindings, setBindings] = useState<Binding[]>(() => loadBindings());
  const [settings, setSettings] = useState(() => loadSettings());
  const [bindingsOpen, setBindingsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktopFps, setDesktopFps] = useState(0);

  const pads = useGamepad();
  const { apps } = useApps(activeSerial);
  const device = useMemo(() => devices.find((d) => d.serial === activeSerial), [devices, activeSerial]);
  const installed = useMemo(() => apps.some((a) => a.package === DOFUS_PACKAGE), [apps]);

  useEffect(() => persistSettings(settings), [settings]);

  useEffect(() => {
    if (activeSerial) return;
    const ready = devices.find((d) => d.state === "device");
    if (ready) setActiveSerial(ready.serial);
  }, [devices, activeSerial]);

  /** Session setup takes seconds; never block the UI on it. */
  const connectStream = (serial: string) => {
    const preset = QUALITY_PRESETS[settings.quality];
    bridge
      .connect(serial, {
        videoCodec: settings.latencyMode ? "h264" : settings.codec === "auto" ? "h265" : settings.codec,
        maxFps: preset.maxFps,
        videoBitRate: Math.round(settings.bitrateMbps * 1_000_000),
        stayAwake: settings.stayAwake,
        audio: settings.audio === "mic",
        autoLaunchPackage: DOFUS_PACKAGE,
        clipboardAutosync: settings.clipboardSync,
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const play = async () => {
    if (!activeSerial) return;
    setLaunching(true);
    setError(null);
    try {
      await bridge.launchApp(activeSerial, DOFUS_PACKAGE, DOFUS_ACTIVITY);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLaunching(false);
      return;
    }
    setLaunching(false);
    setDeviceView(false);
    setPlaying(true);
    connectStream(activeSerial);
  };

  const stop = () => {
    setPlaying(false);
    bridge.disconnect();
  };

  const switchDevice = (serial: string) => {
    setActiveSerial(serial);
    if (playing) {
      bridge.disconnect();
      connectStream(serial);
    }
  };

  const updateBindings = (next: Binding[]) => {
    setBindings(next);
    saveBindings(next);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <TopBar
          devices={devices}
          activeSerial={activeSerial}
          onSelect={switchDevice}
          deviceView={deviceView}
          onToggleDeviceView={() => setDeviceView((v) => !v)}
        />

        <div className="flex min-h-0 flex-1">
          <DeviceRail devices={devices} activeSerial={activeSerial} onSelect={switchDevice} />

          {deviceView ? (
            <DesktopSurface
              device={device}
              settings={settings}
              onSettingsChange={setSettings}
              onDisconnect={() => bridge.disconnect()}
              onBack={() => bridge.keyPress(4, 0)}
              onHome={() => bridge.keyPress(3, 0)}
              onRecents={() => bridge.keyPress(187, 0)}
              onRotate={() => bridge.rotate()}
              onScreenshot={() => bridge.screenshot()}
              onRecord={() => undefined}
              recording={false}
              fps={desktopFps}
              onMeta={(m) => setDesktopFps(m.fps)}
            />
          ) : playing && activeSerial ? (
            <GameSurface
              app={DOFUS_NAME}
              serial={activeSerial}
              bindings={bindings}
              devices={devices}
              active
              reticle={settings.touchReticle}
              onSelectDevice={switchDevice}
              onExit={stop}
            />
          ) : (
            <PlayScreen
              devices={devices}
              activeSerial={activeSerial}
              onPlay={play}
              onOpenBindings={() => setBindingsOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              bindings={bindings}
              installed={installed}
              launching={launching}
              error={error}
            />
          )}
        </div>

        <StatusStrip
          serial={activeSerial}
          settings={settings}
          connected={playing}
          controller={pads.length ? pads[0].id : null}
        />
      </div>

      <BindingsSheet
        open={bindingsOpen}
        onOpenChange={setBindingsOpen}
        bindings={bindings}
        onChange={updateBindings}
        onReset={() => setBindings(resetBindings())}
      />
      <SessionSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={settings}
        onChange={setSettings}
        gameActive={playing}
      />
    </TooltipProvider>
  );
}

export default App