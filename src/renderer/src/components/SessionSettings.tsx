import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  DISPLAY_PRESETS,
  QUALITY_PRESETS,
  type SessionSettingsState,
} from "@/lib/settings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: SessionSettingsState;
  onChange: (next: SessionSettingsState) => void;
  gameActive: boolean;
  error?: string | null;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-xs font-medium">{label}</Label>
        {hint && <span className="font-mono text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function SessionSettings({ open, onOpenChange, value, onChange, gameActive, error }: Props) {
  const set = <K extends keyof SessionSettingsState>(k: K, v: SessionSettingsState[K]) =>
    onChange({ ...value, [k]: v });

  const preset = QUALITY_PRESETS[value.quality];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-sm border-l border-border bg-sidebar">
        <SheetHeader>
          <SheetTitle className="text-sm font-semibold">Session settings</SheetTitle>
          <SheetDescription className="text-xs">
            {gameActive ? "Applied on the next stream start." : "Used when the session starts."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-6">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Stream failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Video
            </div>

            <Field label="Codec" hint={value.codec === "auto" ? "-> h265" : undefined}>
              <Select value={value.codec} onValueChange={(v) => set("codec", v as SessionSettingsState["codec"])}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (H.265)</SelectItem>
                  <SelectItem value="h264">H.264</SelectItem>
                  <SelectItem value="h265">H.265</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Quality" hint={`${preset.maxFps} fps`}>
              <Select
                value={value.quality}
                onValueChange={(v) => set("quality", v as SessionSettingsState["quality"])}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(QUALITY_PRESETS).map(([k, p]) => (
                    <SelectItem key={k} value={k}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Display">
              <Select
                value={value.display}
                onValueChange={(v) => set("display", v as SessionSettingsState["display"])}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISPLAY_PRESETS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Bitrate" hint={`${value.bitrateMbps} Mbps`}>
              <Slider
                value={[value.bitrateMbps]}
                min={4}
                max={20}
                step={1}
                onValueChange={([v]) => set("bitrateMbps", v)}
                aria-label="Bitrate in megabits per second"
              />
            </Field>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="latency" className="text-xs font-medium">
                Latency mode
              </Label>
              <Switch id="latency" checked={value.latencyMode} onCheckedChange={(v) => set("latencyMode", v)} />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Input
            </div>

            <Field label="Deadzone" hint={value.deadzone.toFixed(2)}>
              <Slider
                value={[value.deadzone]}
                min={0}
                max={0.5}
                step={0.01}
                onValueChange={([v]) => set("deadzone", v)}
                aria-label="Analog stick deadzone"
              />
            </Field>

            <Field label="Turbo" hint={value.turboHz ? `${value.turboHz} Hz` : "off"}>
              <Slider
                value={[value.turboHz]}
                min={0}
                max={20}
                step={5}
                onValueChange={([v]) => set("turboHz", v)}
                aria-label="Repeat rate for held directions"
              />
            </Field>

            <Field label="Response curve">
              <Select
                value={value.curve}
                onValueChange={(v) => set("curve", v as SessionSettingsState["curve"])}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="exponential">Exponential</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              System
            </div>

            <Field label="Audio source">
              <Select
                value={value.audio}
                onValueChange={(v) => set("audio", v as SessionSettingsState["audio"])}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="mic">Mic (ambient)</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="reticle" className="text-xs font-medium">
                Touch reticle
              </Label>
              <Switch
                id="reticle"
                checked={value.touchReticle}
                onCheckedChange={(v) => set("touchReticle", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="stayawake" className="text-xs font-medium">
                Keep device awake
              </Label>
              <Switch id="stayawake" checked={value.stayAwake} onCheckedChange={(v) => set("stayAwake", v)} />
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="clip" className="text-xs font-medium">
                Clipboard sync
              </Label>
              <Switch id="clip" checked={value.clipboardSync} onCheckedChange={(v) => set("clipboardSync", v)} />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}