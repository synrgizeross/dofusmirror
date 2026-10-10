import { useEffect, useRef, useState } from "react";
import { streamClient, type StreamMeta } from "@/lib/streamClient";
import { useSurfaceInput } from "@/hooks/useSurfaceInput";

interface Props {
  serial: string;
  className?: string;
  onMeta?: (m: StreamMeta) => void;
  interactive?: boolean;
  reticle?: boolean;
}

/** Mounts the verified WebGL decoder for one device. */
export function MirrorCanvas({ serial, className, onMeta, interactive = true, reticle = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useSurfaceInput(ref, size.width, size.height, interactive && painted);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    streamClient.attach(serial, canvas);
    const unsub = streamClient.subscribe((m) => {
      if (m.serial !== serial) return;
      onMeta?.(m);
      if (m.width > 0 && m.height > 0) {
        setPainted(true);
        setSize((prev) =>
          prev.width === m.width && prev.height === m.height ? prev : { width: m.width, height: m.height },
        );
      }
    });
    return () => {
      unsub();
      streamClient.detach(serial);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial]);

  return (
    <canvas
      ref={ref}
      className={className}
      width={9}
      height={16}
      style={{
        cursor: interactive && painted && reticle ? "crosshair" : undefined,
        touchAction: "none",
        ...(painted ? {} : { display: "none" }),
      }}
      data-painted={painted}
    />
  );
}