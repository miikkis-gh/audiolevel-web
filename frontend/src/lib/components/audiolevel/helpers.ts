import { STAGES, PROFILE_COLORS } from './constants';

export function getStageLabel(p: number): string {
  let l = STAGES[0].label;
  for (const s of STAGES) if (p >= s.at) l = s.label;
  return l;
}

export function getLayout(count: number): { size: number; radius: number } {
  if (count <= 2) return { size: 76, radius: 80 };
  if (count <= 4) return { size: 64, radius: 95 };
  if (count <= 6) return { size: 56, radius: 110 };
  if (count <= 8) return { size: 50, radius: 125 };
  if (count <= 10) return { size: 46, radius: 140 };
  if (count <= 14) return { size: 40, radius: 160 };
  return { size: 36, radius: 180 };
}

export function getPositions(count: number, radius: number): { x: number; y: number }[] {
  const start = count <= 2 ? 0 : -Math.PI / 2;
  return Array.from({ length: count }, (_, i) => {
    const a = start + (i / count) * Math.PI * 2;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  });
}

export function truncName(name: string, max = 12): string {
  const base = name.replace(/\.[^/.]+$/, '');
  return base.length <= max ? base : base.slice(0, max - 1) + '\u2026';
}

export interface ProfileCSS {
  badge: { color: string; background: string; border: string };
  conf: { color: string };
  after: { color: string };
  chevron: { color: string };
}

export function profileCSS(type: string): ProfileCSS {
  const c = PROFILE_COLORS[type] || [80, 210, 180];
  const [r, g, b] = c;
  return {
    badge: {
      color: `rgba(${r},${g},${b},.9)`,
      background: `rgba(${r},${g},${b},.08)`,
      border: `1px solid rgba(${r},${g},${b},.15)`,
    },
    conf: { color: `rgba(${r},${g},${b},.5)` },
    after: { color: `rgba(${r},${g},${b},.8)` },
    chevron: { color: `rgba(${r},${g},${b},.3)` },
  };
}
