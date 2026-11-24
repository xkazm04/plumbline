// Shared pieces for the film's heroes: the cover a concept draws over its beat's footage, the chapter tag, line
// icons that draw themselves, and the fingerprint strip. Frame-pure: every value is a function of the frame and props.
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { alpha, capsStyle, msToFrames, prog, type MomentCtx, type Style } from '@film/kit';

/** ms (from the moment's start) -> frames; the heroes take their cue times in ms, measured from the narration. */
export const fr = (ms: unknown, fallback = 0): number => msToFrames(typeof ms === 'number' && Number.isFinite(ms) ? ms : fallback);

/** Rise-and-fade entrance: 0..1 progress -> style. */
export const rise = (p: number, px = 28): CSSProperties => ({ opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * px}px)` });

/**
 * The ground a concept draws over its beat's footage. It is there from the first frame (a transition or the
 * previous beat covers the cut) and, when the concept ends before its beat, it leaves upward over its last
 * frames with an accent edge, uncovering the real page underneath.
 */
export function Cover({ f, ctx, s, children, outFrames = 14 }: { f: number; ctx: MomentCtx; s: Style; children: ReactNode; outFrames?: number }) {
  const exit = ctx.exits ? prog(f, ctx.durFrames - outFrames, outFrames, s.easeIn) : 0;
  const enter = ctx.enters ? prog(f, 0, 12, s.ease) : 1;
  const bottom = exit * 100;
  const top = (1 - enter) * 100;
  return (
    <AbsoluteFill style={{ clipPath: `inset(${top}% 0 ${bottom}% 0)` }}>
      <AbsoluteFill style={{ background: s.bg }} />
      <Grain s={s} />
      {children}
      {exit > 0 && exit < 1 ? <div style={{ position: 'absolute', left: 0, right: 0, top: `${100 - bottom}%`, height: 8, marginTop: -8, background: s.accent }} /> : null}
    </AbsoluteFill>
  );
}

/** A faint survey grid, the Desk's chart-paper look, so a cover is never a flat sheet. */
export function Grain({ s }: { s: Style }) {
  const line = alpha(s.fg, 0.045);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        backgroundSize: '96px 96px',
        backgroundPosition: '-1px -1px',
      }}
    />
  );
}

/** Top-left chapter tag: "01" in the accent, the chapter's name in spaced caps, a rule that draws. */
export function ChapterTag({ f, s, n, name, note }: { f: number; s: Style; n?: string; name: string; note?: string }) {
  const p = prog(f, 2, 16, s.ease);
  const r = prog(f, 8, 20, s.ease);
  return (
    <div style={{ position: 'absolute', left: 120, top: 96, display: 'flex', alignItems: 'center', gap: 22, ...rise(p, 14) }}>
      {n ? <span style={{ fontFamily: s.display, fontSize: 44, fontWeight: 700, color: s.accent, fontVariantNumeric: 'tabular-nums' }}>{n}</span> : null}
      {n ? <span style={{ width: 64 * r, height: 3, background: alpha(s.fg, 0.35) }} /> : null}
      <span style={{ ...capsStyle(s, 22), color: s.fg }}>{name}</span>
      {note ? <span style={{ ...capsStyle(s, 18), color: alpha(s.fg, 0.45), letterSpacing: '0.16em' }}>{note}</span> : null}
    </div>
  );
}

export type IconName = 'key' | 'house' | 'clinic' | 'agent' | 'eye' | 'checks' | 'file' | 'pin' | 'seal' | 'check';

/** Line icons on a 64-unit grid. `p` 0..1 draws the strokes (pathLength=1 dash), so an icon arrives as a drawing. */
export function Icon({ name, size, p = 1, color, width = 3.6, fill }: { name: IconName; size: number; p?: number; color: string; width?: number; fill?: string }) {
  const dash = { strokeDasharray: 1, strokeDashoffset: 1 - Math.max(0, Math.min(1, p)) };
  const st = { fill: 'none', stroke: color, strokeWidth: width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...dash };
  const P = (d: string, k?: string) => <path key={k ?? d} d={d} pathLength={1} style={st} />;
  const C = (cx: number, cy: number, r: number, k: string) => <circle key={k} cx={cx} cy={cy} r={r} pathLength={1} style={st} />;
  const parts: Record<IconName, ReactNode[]> = {
    key: [C(20, 32, 11, 'bow'), C(20, 32, 3.5, 'hole'), P('M31 32 H56'), P('M48 32 V41'), P('M55 32 V39')],
    house: [P('M10 30 L32 12 L54 30'), P('M16 26 V53 H48 V26'), P('M27 53 V39 H37 V53'), P('M42 18 V13 H47 V22')],
    clinic: [P('M14 10 H50 Q54 10 54 14 V50 Q54 54 50 54 H14 Q10 54 10 50 V14 Q10 10 14 10 Z'), P('M27 20 H37 V27 H44 V37 H37 V44 H27 V37 H20 V27 H27 Z')],
    agent: [P('M12 12 H52 Q56 12 56 16 V48 Q56 52 52 52 H12 Q8 52 8 48 V16 Q8 12 12 12 Z'), P('M18 26 L26 32 L18 38'), P('M30 40 H42')],
    eye: [P('M6 32 Q32 8 58 32 Q32 56 6 32 Z'), C(32, 32, 8, 'iris'), P('M32 32 L32 32.1')],
    checks: [C(14, 32, 8, 'a'), C(32, 32, 8, 'b'), C(50, 32, 8, 'c'), P('M10.5 32 L13 34.5 L17.5 29.5', 'ca'), P('M28.5 32 L31 34.5 L35.5 29.5', 'cb'), P('M46.5 32 L49 34.5 L53.5 29.5', 'cc')],
    file: [P('M16 8 H40 L50 18 V56 H16 Z'), P('M40 8 V18 H50'), P('M23 30 H43'), P('M23 38 H43'), P('M23 46 H36')],
    pin: [C(32, 22, 14, 'ring'), P('M32 4 V46'), C(32, 50, 5, 'bob')],
    seal: [C(32, 32, 24, 'o'), C(32, 32, 18, 'i'), P('M24 32 L30 38 L41 26')],
    check: [P('M14 33 L27 46 L51 19')],
  };
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: 'block', overflow: 'visible' }}>
      {fill ? <rect x={0} y={0} width={64} height={64} rx={14} fill={fill} /> : null}
      {parts[name]}
    </svg>
  );
}

/** A fingerprint drawn as bars from the name (a picture of "a fingerprint", never a figure someone could read). */
export function Fingerprint({ seed, p, color, width = 300, height = 22 }: { seed: string; p: number; color: string; width?: number; height?: number }) {
  let h = 2166136261;
  const bars: number[] = [];
  for (let i = 0; i < 40; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i * 31;
    h = Math.imul(h, 16777619) >>> 0;
    bars.push(1 + (h % 4));
  }
  const shown = Math.round(bars.length * Math.max(0, Math.min(1, p)));
  let x = 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      {bars.slice(0, shown).map((w, i) => {
        const r = <rect key={i} x={x} y={0} width={w * 1.6} height={height} rx={1} fill={color} opacity={0.55 + (w % 2) * 0.35} />;
        x += w * 1.6 + 3.4;
        return r;
      })}
    </svg>
  );
}

/** A small rounded label (pill). */
export function Pill({ s, children, color, bg, style }: { s: Style; children: ReactNode; color: string; bg: string; style?: CSSProperties }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderRadius: 999, background: bg, color, fontFamily: s.body, fontWeight: 600, fontSize: 27, letterSpacing: '0.01em', whiteSpace: 'nowrap', ...style }}>
      {children}
    </span>
  );
}

/** A white card on the cover. */
export const card = (s: Style, extra: CSSProperties = {}): CSSProperties => ({
  background: '#ffffff',
  borderRadius: s.radius + 6,
  border: `2px solid ${alpha(s.fg, 0.1)}`,
  boxShadow: `0 18px 48px ${alpha(s.fg, 0.1)}, 0 2px 6px ${alpha(s.fg, 0.06)}`,
  ...extra,
});
