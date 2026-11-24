// IntroHero: the film's welcome. The plumb line drops, its bob swings and settles true, the ring closes into the
// Desk's mark, and the name rises beside it; then the three promises arrive as the narrator says them.
// props: { tagAt, cues: [signed, checked, watched] } (ms from the beat's start, measured from the intro clip)
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { alpha, capsStyle, prog, useStyle, type MomentProps } from '@film/kit';
import { Grain, Icon, fr, rise, type IconName } from './parts.tsx';

const PILLARS: { icon: IconName; word: string; sub: string }[] = [
  { icon: 'key', word: 'Signed', sub: 'by the owner' },
  { icon: 'checks', word: 'Checked', sub: 'before it ships' },
  { icon: 'eye', word: 'Watched', sub: 'every day after' },
];

/** The mark, drawn: a line that drops, a bob on a damped swing, a ring that closes. k = px per logo unit. */
function Mark({ f, k, s }: { f: number; k: number; s: ReturnType<typeof useStyle> }) {
  const drop = prog(f, 0, 14, s.ease);
  const t = Math.max(0, f - 8) / 30;
  const swing = 24 * Math.exp(-t / 0.42) * Math.cos(2 * Math.PI * (t / 0.86)) * Math.min(1, f / 8);
  const ring = prog(f, 12, 26, s.ease);
  const len = 50 * drop;
  return (
    <svg width={48 * k} height={64 * k} viewBox="0 0 48 64" style={{ overflow: 'visible', display: 'block' }}>
      <circle cx={24} cy={24} r={20.5} fill="none" stroke={s.fg} strokeWidth={4.5} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - ring} transform="rotate(-90 24 24)" />
      <g transform={`rotate(${swing} 24 0)`}>
        <rect x={22.25} y={0} width={3.5} height={len} fill={s.accent} />
        <circle cx={24} cy={4 + len} r={7 * Math.min(1, drop * 1.2)} fill={s.accent} />
      </g>
    </svg>
  );
}

export function IntroHero({ props }: MomentProps) {
  const f = useCurrentFrame();
  const s = useStyle();
  const cues = Array.isArray(props.cues) ? (props.cues as number[]) : [3780, 4740, 6200];
  const tagAt = fr(props.tagAt, 1390);
  const first = fr(cues[0]);

  const nameP = prog(f, 14, 22, s.ease);
  const tagP = prog(f, tagAt, 20, s.ease);
  // the lockup sits centred, then rises to make room for the promises
  const lift = prog(f, first - 18, 22, s.ease);
  const lineP = prog(f, first - 6, Math.max(12, fr(cues[2]) - first + 18), s.ease);

  return (
    <AbsoluteFill style={{ background: s.bg }}>
      <Grain s={s} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 56, transform: `translateY(${interpolate(lift, [0, 1], [40, -150])}px)` }}>
          <Mark f={f} k={4.1} s={s} />
          <div>
            <div style={{ fontFamily: s.display, fontSize: 196, fontWeight: 700, color: s.fg, letterSpacing: `${-0.03 + 0.012 * (1 - nameP)}em`, lineHeight: 0.95, ...rise(nameP, 40) }}>Plumbline</div>
            <div style={{ fontFamily: s.display, fontStyle: 'italic', fontSize: 50, color: s.accent2, marginTop: 18, ...rise(tagP, 18) }}>a plumb line for agentic websites</div>
          </div>
        </div>
      </AbsoluteFill>

      <div style={{ position: 'absolute', left: 0, right: 0, top: 700, display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', gap: 120 }}>
          <div style={{ position: 'absolute', left: 60, right: 60, top: 59, height: 3, background: alpha(s.accent, 0.5), transform: `scaleX(${lineP})`, transformOrigin: 'left' }} />
          {PILLARS.map((pl, i) => {
            const at = fr(cues[i]);
            const p = prog(f, at, 18, s.ease);
            const ic = prog(f, at + 2, 22, s.ease);
            return (
              <div key={pl.word} style={{ width: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', ...rise(p, 30) }}>
                <div style={{ width: 120, height: 120, borderRadius: 999, background: s.bg, border: `3px solid ${alpha(s.fg, 0.16)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <Icon name={pl.icon} size={70} p={ic} color={i === 0 ? s.accent : s.fg} />
                </div>
                <div style={{ ...capsStyle(s, 30), color: s.fg, marginTop: 26 }}>{pl.word}</div>
                <div style={{ fontFamily: s.body, fontSize: 28, color: s.muted, marginTop: 8 }}>{pl.sub}</div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
