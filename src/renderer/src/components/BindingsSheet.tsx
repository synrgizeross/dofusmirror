import { useEffect, useState } from "react";
import { Keyboard, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DEFAULT_BINDINGS, type Binding, type BindingAction } from "@/lib/dofus";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bindings: Binding[];
  onChange: (b: Binding[]) => void;
  onReset: () => void;
}

function prettyKey(code: string) {
  return code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace(/^Arrow/, "")
    .replace("Space", "Space");
}

export function BindingsSheet({ open, onOpenChange, bindings, onChange, onReset }: Props) {
  const [capturing, setCapturing] = useState<BindingAction | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      onChange(
        bindings.map((b) =>
          b.action === capturing ? { ...b, keys: [e.code || e.key] } : b,
        ),
      );
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, bindings, onChange]);

  const groups = [...new Set(bindings.map((b) => b.group))];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col border-l border-border bg-sidebar">
        <SheetHeader>
          <SheetTitle className="text-sm font-semibold">Bindings</SheetTitle>
          <SheetDescription className="text-xs">
            Click a key, then press the replacement. Esc cancels.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4">
          {groups.map((group) => (
            <section key={group} className="space-y-2">
              <Label className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{group}</Label>
              <div className="overflow-hidden rounded-lg border border-border">
                {bindings
                  .filter((b) => b.group === group)
                  .map((b) => {
                    const active = capturing === b.action;
                    return (
                      <Button
                        key={b.action}
                        variant="ghost"
                        onClick={() => setCapturing(active ? null : b.action)}
                        className={
                          "h-auto w-full justify-between gap-3 whitespace-normal rounded-none border-b border-border px-3 py-2 text-left text-xs last:border-b-0 " +
                          (active ? "bg-primary/10" : "hover:bg-accent")
                        }
                      >
                        <span className="text-xs">{b.label}</span>
                        <span className="flex items-center gap-1">
                          {b.keys.map((k) => (
                            <kbd
                              key={k}
                              className={
                                "rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] min-w-6 text-center " +
                                (active ? "text-primary" : "text-muted-foreground")
                              }
                            >
                              {active ? "press…" : prettyKey(k)}
                            </kbd>
                          ))}
                        </span>
                      </Button>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>

        <SheetFooter className="gap-2 px-4 pb-4 sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Keyboard className="size-3.5" />
            {bindings.length} actions
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={JSON.stringify(bindings) === JSON.stringify(DEFAULT_BINDINGS)}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}