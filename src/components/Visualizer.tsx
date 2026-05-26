import React, { useEffect, useRef } from 'react';
import '../styles/Visualizer.css';

interface VisualizerProps {
  analyser: AnalyserNode;
}

const BAR_COUNT = 56;
const RISE = 0.28; // how quickly a bar climbs toward a higher value
const FALL = 0.06; // how slowly it falls back (inertia => fluid motion)

const Visualizer: React.FC<VisualizerProps> = ({ analyser }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationIdRef = useRef<number | null>(null);
  const smoothedRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();

    const binCount = analyser.frequencyBinCount;
    const freqData = new Uint8Array(binCount);
    const timeData = new Uint8Array(binCount);
    const smoothed = smoothedRef.current;

    // Log-ish spaced band edges so low frequencies aren't crammed together.
    const bandEdges: number[] = [];
    for (let b = 0; b <= BAR_COUNT; b++) {
      const frac = b / BAR_COUNT;
      bandEdges.push(Math.floor(Math.pow(frac, 2) * (binCount - 1)));
    }

    const draw = () => {
      animationIdRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(freqData);

      ctx.clearRect(0, 0, width, height);

      const gap = 2;
      const barWidth = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;

      for (let i = 0; i < BAR_COUNT; i++) {
        const start = bandEdges[i];
        const end = Math.max(bandEdges[i + 1], start + 1);
        let sum = 0;
        for (let j = start; j < end; j++) sum += freqData[j];
        const target = sum / (end - start) / 255; // 0..1

        const ease = target > smoothed[i] ? RISE : FALL;
        smoothed[i] += (target - smoothed[i]) * ease;

        const barHeight = Math.max(2, smoothed[i] * height);
        const x = i * (barWidth + gap);
        const y = height - barHeight;
        const hue = 210 - (i / BAR_COUNT) * 80; // calm blue -> cyan
        ctx.fillStyle = `hsla(${hue}, 70%, 60%, 0.9)`;

        const radius = Math.min(barWidth / 2, 3);
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.lineTo(x + barWidth - radius, y);
        ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
        ctx.lineTo(x + barWidth, height);
        ctx.closePath();
        ctx.fill();
      }

      // Subtle waveform overlay.
      analyser.getByteTimeDomainData(timeData);
      ctx.strokeStyle = 'rgba(122, 162, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const step = binCount / width;
      for (let xPix = 0; xPix < width; xPix++) {
        const v = timeData[Math.floor(xPix * step)] / 128.0 - 1; // -1..1
        const yPix = height / 2 + (v * height) / 2.6;
        if (xPix === 0) ctx.moveTo(xPix, yPix);
        else ctx.lineTo(xPix, yPix);
      }
      ctx.stroke();
    };

    draw();
    window.addEventListener('resize', resizeCanvas);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationIdRef.current !== null) cancelAnimationFrame(animationIdRef.current);
    };
  }, [analyser]);

  return (
    <div className="visualizer-container">
      <canvas ref={canvasRef} className="visualizer-canvas"></canvas>
    </div>
  );
};

export default Visualizer;
