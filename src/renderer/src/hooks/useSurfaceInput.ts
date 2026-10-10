import { useEffect, type RefObject } from "react";
import { bridge } from "@/lib/bridge";

const DOWN = 0;
const UP = 1;
const MOVE = 2;

/**
 * Forwards pointer input on the video surface to the device as real touch
 * events, using the same coordinate mapping as the pre-migration UI.
 */
export function useSurfaceInput(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  videoW: number,
  videoH: number,
  enabled: boolean,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;

    let pressing = false;

    const map = (e: PointerEvent, action: number) => {
      if (!videoW || !videoH) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.round(((e.clientX - rect.left) / rect.width) * videoW);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * videoH);
      if (x < 0 || y < 0 || x >= videoW || y >= videoH) return;
      const pressure = action === DOWN || action === MOVE ? 1 : 0;
      bridge.touch(action, x, y, videoW, videoH, pressure);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      pressing = true;
      canvas.setPointerCapture?.(e.pointerId);
      map(e, DOWN);
    };

    const onMove = (e: PointerEvent) => {
      if (!pressing || e.buttons === 0) return;
      e.preventDefault();
      map(e, MOVE);
    };

    const onUp = (e: PointerEvent) => {
      if (!pressing) return;
      pressing = false;
      canvas.releasePointerCapture?.(e.pointerId);
      map(e, UP);
    };

    const onWheel = (e: WheelEvent) => {
      if (!videoW || !videoH) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cx = Math.round(((e.clientX - rect.left) / rect.width) * videoW);
      const cy = Math.round(((e.clientY - rect.top) / rect.height) * videoH);
      if (cx < 0 || cy < 0 || cx >= videoW || cy >= videoH) return;
      const steps = e.deltaMode === 1 ? e.deltaY : e.deltaY / 40;
      bridge.scroll(cx, cy, videoW, videoH, 0, Math.round(steps), 0);
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [canvasRef, videoW, videoH, enabled]);
}