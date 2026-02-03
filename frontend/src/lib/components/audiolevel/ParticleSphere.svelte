<script lang="ts">
  import { PROFILE_COLOR_LIST } from './constants';
  import type { ParticleState } from './constants';

  interface Props {
    size?: number;
    progress?: number;
    pState?: ParticleState;
    mini?: boolean;
    profileColor?: [number, number, number] | null;
    extraClass?: string;
    onanimationend?: (e: AnimationEvent) => void;
  }

  let {
    size = 152,
    progress = 0,
    pState = 'idle',
    mini = false,
    profileColor = null,
    extraClass = '',
    onanimationend,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement;

  // Non-reactive refs for animation loop
  let targetProgress = progress;
  let displayProgress = 0; // Smoothly interpolated progress for animation
  let currentState = pState;
  let currentColor = profileColor;
  let frameCount = 0;
  let animId: number | null = null;

  interface Particle {
    angle: number;
    speed: number;
    rf: number;
    sz: number;
    br: number;
    drift: number;
    phase: number;
    ts: number;
  }

  const pCount = Math.max(20, Math.floor(120 * Math.pow(size / 152, 1.5)));
  const particles: Particle[] = Array.from({ length: pCount }, () => ({
    angle: Math.random() * Math.PI * 2,
    speed: 0.001 + Math.random() * 0.006,
    rf: 0.05 + Math.random() * 0.95,
    sz: (0.6 + Math.random() * 1.8) * (size / 152),
    br: 0.3 + Math.random() * 0.7,
    drift: (Math.random() - 0.5) * 0.003,
    phase: Math.random() * Math.PI * 2,
    ts: 0.01 + Math.random() * 0.03,
  }));

  // Keep refs in sync
  $effect(() => {
    targetProgress = progress;
  });
  $effect(() => {
    // Reset display progress when starting a new job
    if (pState === 'processing' && currentState !== 'processing') {
      displayProgress = 0;
    }
    currentState = pState;
  });
  $effect(() => {
    currentColor = profileColor;
  });

  // Main animation lifecycle
  $effect(() => {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const px = size * 2;
    canvasEl.width = px;
    canvasEl.height = px;
    const ctr = px / 2;
    const maxR = px / 2 - 2;

    let running = true;

    const draw = () => {
      if (!running) return;
      frameCount++;
      ctx.clearRect(0, 0, px, px);

      const s = currentState;
      const pc = currentColor;
      const active = s === 'processing' || s === 'complete';
      const isIdle = s === 'idle';

      // Smoothly interpolate displayProgress towards targetProgress
      // Use faster lerp when jumping forward, slower for smooth visual
      const lerpSpeed = targetProgress > displayProgress ? 0.08 : 0.12;
      displayProgress += (targetProgress - displayProgress) * lerpSpeed;
      // Clamp to avoid floating point drift
      if (Math.abs(displayProgress - targetProgress) < 0.1) {
        displayProgress = targetProgress;
      }
      const p = displayProgress;

      // Mini spheres sleep when idle; large sphere runs aurora
      if (!active && (mini || !isIdle)) {
        animId = null;
        return;
      }

      // Idle large sphere: subtle ambient glow only, no particles
      if (isIdle && !mini) {
        const gRot = frameCount * 0.001;
        const gA = Math.sin(gRot) * 0.5 + 0.5;
        const gB = Math.sin(gRot + 2.1) * 0.5 + 0.5;
        const gC = Math.sin(gRot + 4.2) * 0.5 + 0.5;
        const gR = maxR * 0.25;
        const gg = ctx.createRadialGradient(ctr, ctr, 0, ctr, ctr, gR);
        gg.addColorStop(0, `rgba(${(100 + gA * 80) | 0},${(160 + gB * 40) | 0},${(180 + gC * 60) | 0},.07)`);
        gg.addColorStop(1, `rgba(${(100 + gA * 80) | 0},${(160 + gB * 40) | 0},${(180 + gC * 60) | 0},0)`);
        ctx.beginPath();
        ctx.arc(ctr, ctr, gR, 0, Math.PI * 2);
        ctx.fillStyle = gg;
        ctx.fill();
      }

      // Active: processing / complete
      if (active) {
        const t = p / 100;
        const spread = maxR * Math.pow(t, 0.6);
        const ga = Math.min(1, t * 2.5);
        const n = Math.floor(particles.length * Math.max(0.08, t));
        const comp = s === 'complete';
        // Use profile color only during processing, default green for complete
        const useProfileColor = pc && !comp;
        const baseR = useProfileColor ? pc[0] : comp ? 120 : 140;
        const baseG = useProfileColor ? pc[1] : comp ? 220 : 200;
        const baseB = useProfileColor ? pc[2] : comp ? 200 : 250;
        const twR = useProfileColor ? 30 : comp ? 40 : 60;
        const twG = useProfileColor ? 25 : comp ? 20 : 40;
        const twB = useProfileColor ? 20 : comp ? 30 : 0;

        for (let i = 0; i < n; i++) {
          const pt = particles[i];
          pt.angle += pt.speed + pt.drift * Math.sin(frameCount * 0.02);
          const tw = 0.5 + 0.5 * Math.sin(frameCount * pt.ts + pt.phase);
          const r = spread * pt.rf;
          const x = ctr + Math.cos(pt.angle) * r;
          const y = ctr + Math.sin(pt.angle) * r;
          const dn = r / maxR;
          const ef = dn > t ? 0 : 1 - (dn / Math.max(t, 0.01)) * 0.3;
          const al = ga * pt.br * tw * ef;
          if (al < 0.01) continue;
          const cr = (baseR + tw * twR) | 0;
          const cg = (baseG + tw * twG) | 0;
          const cb = (baseB + tw * twB) | 0;
          const ds = pt.sz * (0.7 + t * 0.5) * (0.8 + tw * 0.4);
          ctx.beginPath();
          ctx.arc(x, y, ds, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${al * 0.9})`;
          ctx.fill();
          if (ds > 0.8 && al > 0.25) {
            ctx.beginPath();
            ctx.arc(x, y, ds * 2.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${al * 0.12})`;
            ctx.fill();
          }
        }
        if (t > 0.02) {
          const ca = t * 0.12;
          const cR = spread * 0.3;
          const g = ctx.createRadialGradient(ctr, ctr, 0, ctr, ctr, cR);
          const ccStr = useProfileColor ? `${pc[0]},${pc[1]},${pc[2]}` : comp ? '80,210,180' : '100,200,240';
          g.addColorStop(0, `rgba(${ccStr},${ca})`);
          g.addColorStop(1, `rgba(${ccStr},0)`);
          ctx.beginPath();
          ctx.arc(ctr, ctr, cR, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    return () => {
      running = false;
      if (animId) cancelAnimationFrame(animId);
      animId = null;
    };
  });

  let cls = $derived(
    pState === 'complete'
      ? 'complete'
      : pState === 'processing'
        ? 'processing'
        : mini
          ? 'idle'
          : 'aurora'
  );

  // Dynamic glow for profile-colored spheres (only during processing, not complete)
  let coreStyle = $derived.by(() => {
    let style = `width: ${size}px; height: ${size}px;`;
    if (profileColor && pState === 'processing') {
      const [r, g, b] = profileColor;
      style += `box-shadow: 0 0 50px rgba(${r},${g},${b},0.24), 0 0 100px rgba(${r},${g},${b},0.1);`;
      style += `background: radial-gradient(circle at 36% 32%, rgba(${r},${g},${b},.18) 0%, rgba(${(r / 3) | 0},${(g / 3) | 0},${(b / 3) | 0},.42) 35%, rgba(12,18,40,.92) 70%, rgba(6,7,11,1) 100%);`;
    }
    return style;
  });
</script>

<div
  class="sphere-core {cls}{mini ? ' mini' : ''}{extraClass ? ' ' + extraClass : ''}"
  style={coreStyle}
  onanimationend={onanimationend}
>
  <canvas bind:this={canvasEl} class="particle-canvas"></canvas>
  <div class="sphere-highlight"></div>
</div>

<style>
  .sphere-core {
    border-radius: 50%;
    position: relative;
    overflow: hidden;
    transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
    background: radial-gradient(
      circle at 36% 32%,
      rgba(100, 200, 240, 0.12) 0%,
      rgba(35, 75, 140, 0.35) 35%,
      rgba(12, 18, 40, 0.92) 70%,
      rgba(6, 7, 11, 1) 100%
    );
  }

  .sphere-core.idle {
    animation: idlePulse 4s ease-in-out infinite;
  }

  .sphere-core.aurora {
    animation: auroraGlow 18s ease-in-out infinite;
    background: radial-gradient(
      circle at 36% 32%,
      rgba(100, 180, 240, 0.16) 0%,
      rgba(35, 75, 140, 0.36) 35%,
      rgba(12, 18, 40, 0.92) 70%,
      rgba(6, 7, 11, 1) 100%
    );
  }

  .sphere-core.processing {
    box-shadow:
      0 0 50px rgba(60, 180, 220, 0.3),
      0 0 100px rgba(60, 180, 220, 0.12);
    background: radial-gradient(
      circle at 36% 32%,
      rgba(100, 210, 250, 0.22) 0%,
      rgba(40, 90, 170, 0.5) 35%,
      rgba(15, 22, 55, 0.92) 70%,
      rgba(6, 7, 11, 1) 100%
    );
  }

  .sphere-core.complete {
    animation: completePulse 3s ease-in-out infinite;
    background: radial-gradient(
      circle at 36% 32%,
      rgba(80, 220, 190, 0.15) 0%,
      rgba(30, 100, 120, 0.4) 35%,
      rgba(10, 20, 35, 0.92) 70%,
      rgba(6, 7, 11, 1) 100%
    );
  }

  .sphere-core.mini {
    animation: none !important;
  }

  .sphere-core.mini.processing {
    box-shadow: 0 0 22px rgba(100, 180, 240, 0.2);
  }

  .sphere-core.mini.complete {
    box-shadow: 0 0 18px rgba(80, 210, 180, 0.15);
  }

  .sphere-core.mini.idle {
    box-shadow: 0 0 12px rgba(60, 160, 220, 0.06);
  }

  :global(.sphere-core.reject-pulse) {
    animation: rejectPulse 0.8s ease-out forwards !important;
  }

  .sphere-highlight {
    position: absolute;
    top: 18%;
    left: 22%;
    width: 34%;
    height: 22%;
    border-radius: 50%;
    background: radial-gradient(ellipse, rgba(255, 255, 255, 0.09), transparent);
    filter: blur(4px);
    pointer-events: none;
    z-index: 2;
  }

  .particle-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    pointer-events: none;
    z-index: 1;
  }

  @keyframes idlePulse {
    0%,
    100% {
      box-shadow:
        0 0 40px rgba(60, 160, 220, 0.08),
        0 0 80px rgba(60, 160, 220, 0.04);
    }
    50% {
      box-shadow:
        0 0 50px rgba(60, 160, 220, 0.14),
        0 0 100px rgba(60, 160, 220, 0.06);
    }
  }

  @keyframes completePulse {
    0% {
      box-shadow:
        0 0 50px rgba(80, 210, 180, 0.2),
        0 0 100px rgba(80, 210, 180, 0.08);
    }
    50% {
      box-shadow:
        0 0 60px rgba(80, 210, 180, 0.28),
        0 0 120px rgba(80, 210, 180, 0.1);
    }
    100% {
      box-shadow:
        0 0 50px rgba(80, 210, 180, 0.2),
        0 0 100px rgba(80, 210, 180, 0.08);
    }
  }

  @keyframes auroraGlow {
    0%,
    100% {
      box-shadow:
        0 0 45px rgba(100, 180, 255, 0.16),
        0 0 90px rgba(100, 180, 255, 0.06);
    }
    16% {
      box-shadow:
        0 0 45px rgba(180, 130, 255, 0.18),
        0 0 90px rgba(180, 130, 255, 0.07);
    }
    33% {
      box-shadow:
        0 0 45px rgba(255, 180, 80, 0.16),
        0 0 90px rgba(255, 180, 80, 0.06);
    }
    50% {
      box-shadow:
        0 0 45px rgba(80, 210, 160, 0.18),
        0 0 90px rgba(80, 210, 160, 0.07);
    }
    66% {
      box-shadow:
        0 0 45px rgba(255, 120, 140, 0.16),
        0 0 90px rgba(255, 120, 140, 0.06);
    }
    83% {
      box-shadow:
        0 0 45px rgba(255, 100, 220, 0.18),
        0 0 90px rgba(255, 100, 220, 0.07);
    }
  }

  @keyframes rejectPulse {
    0% {
      box-shadow:
        0 0 40px rgba(255, 180, 120, 0),
        0 0 80px rgba(255, 180, 120, 0);
    }
    30% {
      box-shadow:
        0 0 50px rgba(255, 180, 120, 0.3),
        0 0 100px rgba(255, 180, 120, 0.12);
    }
    100% {
      box-shadow:
        0 0 40px rgba(255, 180, 120, 0),
        0 0 80px rgba(255, 180, 120, 0);
    }
  }
</style>
