import { useEffect, useState } from "react";

export interface PadState {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
}

export function useGamepad() {
  const [pads, setPads] = useState<PadState[]>([]);

  useEffect(() => {
    const sync = () => {
      const list = navigator.getGamepads?.() ?? [];
      setPads(
        [...list]
          .filter((p): p is Gamepad => !!p && p.connected)
          .map((p) => ({ index: p.index, id: p.id, mapping: p.mapping, connected: true })),
      );
    };
    sync();
    window.addEventListener("gamepadconnected", sync);
    window.addEventListener("gamepaddisconnected", sync);
    const t = setInterval(sync, 2000);
    return () => {
      window.removeEventListener("gamepadconnected", sync);
      window.removeEventListener("gamepaddisconnected", sync);
      clearInterval(t);
    };
  }, []);

  return pads;
}