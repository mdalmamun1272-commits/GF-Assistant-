import React, { useEffect, useRef } from "react";
import { SessionState, MoodType } from "../types";

interface AudioVisualizerProps {
  micAnalyser: AnalyserNode | null;
  speakerAnalyser: AnalyserNode | null;
  state: SessionState;
  mood: MoodType;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  micAnalyser,
  speakerAnalyser,
  state,
  mood,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  // Map mood to distinct neon colors
  const getMoodColors = (currentMood: MoodType) => {
    switch (currentMood) {
      case "flirty":
        return { primary: "#f43f5e", secondary: "#fb7185", glow: "rgba(244, 63, 94, 0.5)" }; // Rose/Pink
      case "sassy":
        return { primary: "#d946ef", secondary: "#f472b6", glow: "rgba(217, 70, 239, 0.5)" }; // Fuchsia/Pink
      case "playful":
        return { primary: "#f59e0b", secondary: "#fcd34d", glow: "rgba(245, 158, 11, 0.5)" }; // Amber/Orange
      case "shy":
        return { primary: "#10b981", secondary: "#34d399", glow: "rgba(16, 185, 129, 0.5)" }; // Emerald
      case "happy":
      default:
        return { primary: "#3b82f6", secondary: "#60a5fa", glow: "rgba(59, 130, 246, 0.5)" }; // Blue
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI screens
    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Render loop variables
    let phase = 0;
    const bufferLength = 128;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);
      const centerX = width / 2;
      const centerY = height / 2;
      
      // Clear canvas with deep dark trailing fade
      ctx.fillStyle = "rgba(10, 10, 15, 0.15)";
      ctx.fillRect(0, 0, width, height);

      // Fetch colors based on state/mood
      const colors = getMoodColors(mood);
      const isSpeaking = state === "speaking";
      const isListening = state === "listening" || state === "ready";
      const isConnecting = state === "connecting";
      const isDisconnected = state === "disconnected";

      phase += 0.05;

      // Draw subtle orbital rings in background
      ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
      ctx.lineWidth = 1;
      for (let r = 50; r <= 150; r += 30) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (isDisconnected) {
        // --- DISCONNECTED STATE: Calm breathing radial circle ---
        const baseRadius = 60;
        const breath = Math.sin(phase * 0.5) * 6;
        const radius = baseRadius + breath;

        // Outer glow
        ctx.shadowBlur = 20;
        ctx.shadowColor = "rgba(148, 163, 184, 0.2)";
        ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + 8, 0, Math.PI * 2);
        ctx.stroke();

        // Inner solid ring
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(30, 41, 59, 0.5)";
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
        ctx.stroke();

      } else if (isConnecting) {
        // --- CONNECTING STATE: Rapid spinning dashed ring ---
        const radius = 65;
        ctx.shadowBlur = 15;
        ctx.shadowColor = colors.glow;
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, phase, phase + Math.PI * 1.5);
        ctx.stroke();

        // Second reverse spin ring
        ctx.strokeStyle = colors.secondary;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + 10, -phase * 1.5, -phase * 1.5 + Math.PI * 0.8);
        ctx.stroke();

      } else if (isListening) {
        // --- LISTENING/READY STATE: Sound waves reacting to mic ---
        let voicePower = 0;
        if (micAnalyser) {
          micAnalyser.getByteFrequencyData(dataArray);
          // Calculate average mic power
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          voicePower = sum / bufferLength;
        }

        const baseRadius = 65;
        const radius = baseRadius + voicePower * 0.6;

        // Draw radial sound ripples
        ctx.shadowBlur = 25;
        ctx.shadowColor = "rgba(6, 182, 212, 0.4)"; // Soft cyan for listening
        ctx.strokeStyle = "rgba(6, 182, 212, 0.6)";
        ctx.lineWidth = 2;

        const numPoints = 64;
        ctx.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2;
          // Add raw frequency turbulence to circle radius
          const freqIndex = Math.floor((i % (numPoints / 2)) * (bufferLength / (numPoints / 2)));
          const offset = (dataArray[freqIndex] || 0) * 0.25 * (Math.sin(phase * 2 + i) * 0.3 + 0.7);
          const r = radius + offset;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.stroke();

        // Inner glowing core
        ctx.shadowBlur = 15;
        ctx.fillStyle = "rgba(8, 47, 73, 0.6)";
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius - 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(14, 116, 144, 0.5)";
        ctx.stroke();

      } else if (isSpeaking) {
        // --- SPEAKING STATE: Multi-line beautiful dancing sine waves ---
        let voicePower = 0;
        if (speakerAnalyser) {
          speakerAnalyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          voicePower = sum / bufferLength;
        }

        const amplitude = Math.max(10, voicePower * 1.5);
        ctx.shadowBlur = 20;
        ctx.shadowColor = colors.glow;

        // Draw 3 layers of overlapping sine waves for depth
        const waves = [
          { freq: 0.015, speed: phase * 1.5, ampMult: 1.0, color: colors.primary, width: 3 },
          { freq: 0.025, speed: -phase * 1.1, ampMult: 0.6, color: colors.secondary, width: 1.5 },
          { freq: 0.008, speed: phase * 0.8, ampMult: 0.4, color: "rgba(255, 255, 255, 0.4)", width: 1 }
        ];

        waves.forEach((w) => {
          ctx.strokeStyle = w.color;
          ctx.lineWidth = w.width;
          ctx.beginPath();
          
          for (let x = 0; x < width; x++) {
            // Apply gaussian envelope to make waves pinch at the screen edges
            const envelope = Math.sin((x / width) * Math.PI);
            const y = centerY + Math.sin(x * w.freq + w.speed) * amplitude * w.ampMult * envelope;
            
            if (x === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        });

        // Glowing center pulsing anchor
        ctx.shadowBlur = 30;
        ctx.fillStyle = colors.primary;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 40 + voicePower * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0; // Reset shadow for other drawings
      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [state, mood, micAnalyser, speakerAnalyser]);

  return (
    <div className="relative w-full h-72 md:h-96 flex items-center justify-center overflow-hidden">
      <canvas
        id="voice-visualizer-canvas"
        ref={canvasRef}
        className="w-full h-full max-w-lg cursor-pointer transition-all duration-300 rounded-full"
        style={{ filter: "drop-shadow(0 0 12px rgba(0,0,0,0.5))" }}
      />
    </div>
  );
};
