import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import WaveSurfer from "wavesurfer.js";

export type WaveformHandle = {
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  getCurrentTime: () => number;
};

type Props = {
  audioUrl: string;
  onTimeUpdate?: (t: number) => void;
  onReady?: (duration: number) => void;
};

const Waveform = forwardRef<WaveformHandle, Props>(function Waveform(
  { audioUrl, onTimeUpdate, onReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#3a4252",
      progressColor: "#6aa7ff",
      cursorColor: "#e6e6e6",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      height: 64,
      normalize: true,
      url: audioUrl,
    });
    wsRef.current = ws;

    ws.on("ready", () => onReady?.(ws.getDuration()));
    ws.on("audioprocess", () => onTimeUpdate?.(ws.getCurrentTime()));
    ws.on("seeking", () => onTimeUpdate?.(ws.getCurrentTime()));
    ws.on("interaction", () => onTimeUpdate?.(ws.getCurrentTime()));

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [audioUrl]);

  useImperativeHandle(ref, () => ({
    seek: (seconds: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const d = ws.getDuration();
      if (d > 0) ws.seekTo(Math.max(0, Math.min(1, seconds / d)));
    },
    play: () => wsRef.current?.play(),
    pause: () => wsRef.current?.pause(),
    toggle: () => wsRef.current?.playPause(),
    getCurrentTime: () => wsRef.current?.getCurrentTime() ?? 0,
  }));

  return <div id="waveform" ref={containerRef} />;
});

export default Waveform;
