// ExamplesHero: the three examples as three cards, each arriving as the narrator names it, with the question
// the example answers. The close reprises them (variant "reprise"): a check lands on each as the line says
// Plumbline keeps each one what its owner approved, and the cover lifts to the Desk.
// props: { cues: [ms, ms, ms], kicker, variant?: 'reprise', checkAt?: ms }
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { alpha, capsStyle, prog, str, useStyle, type MomentProps } from '@film/kit';
import { ChapterTag, Cover, Icon, card, fr, rise, type IconName } from './parts.tsx';

export const EXAMPLES: { n: string; icon: IconName; title: string; who: string; q: string; tool: string }[] = [
  { n: '01', icon: 'house', title: 'A guesthouse', who: 'Larch House', q: 'Does its agent still say what the page says?', tool: 'the daily watch' },
  { n: '02', icon: 'clinic', title: 'A clinic', who: 'Northgate Clinic', q: 'Who really published these files?', tool: 'the signature' },
  { n: '03', icon: 'agent', title: 'A coding agent', who: 'your repository', q: 'Did one of its tools change overnight?', tool: 'the agent lock' },
];

export function ExamplesHero({ props, ctx }: MomentProps) {
  const f = useCurrentFrame();
  const s = useStyle();
  const reprise = props.variant === 'reprise';
  const cues = Array.isArray(props.cues) ? (props.cues as number[]) : [1620, 2300, 3120];
  const checkAt = fr(props.checkAt, 2300);
  const kicker = str(props.kicker) ?? 'Three examples';

  return (
    <Cover f={f} ctx={ctx} s={s}>
      {reprise ? null : <ChapterTag f={f} s={s} name={kicker} />}
      {reprise ? (
        <div style={{ position: 'absolute', top: 150, left: 0, right: 0, textAlign: 'center', fontFamily: s.display, fontSize: 64, color: s.fg, ...rise(prog(f, checkAt - 6, 18, s.ease), 18) }}>
          Each one kept <span style={{ color: s.accent2, fontStyle: 'italic' }}>what its owner approved</span>
        </div>
      ) : null}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: reprise ? 120 : 40 }}>
        <div style={{ display: 'flex', gap: 56 }}>
          {EXAMPLES.map((e, i) => {
            const at = fr(cues[i]);
            const p = prog(f, at, 18, s.ease);
            const ic = prog(f, at + 3, 24, s.ease);
            const q = prog(f, at + 10, 18, s.ease);
            const chk = reprise ? prog(f, checkAt + i * 5, 14, s.ease) : 0;
            return (
              <div key={e.n} style={{ ...card(s, { width: 500, height: reprise ? 420 : 580, padding: '44px 44px 40px', boxSizing: 'border-box', position: 'relative', display: 'flex', flexDirection: 'column' }), ...rise(p, 60) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Icon name={e.icon} size={104} p={ic} color={s.fg} />
                  <span style={{ fontFamily: s.display, fontSize: 40, fontWeight: 700, color: alpha(s.fg, 0.22), fontVariantNumeric: 'tabular-nums' }}>{e.n}</span>
                </div>
                <div style={{ fontFamily: s.display, fontSize: 54, fontWeight: 700, color: s.fg, marginTop: 30, letterSpacing: '-0.015em', whiteSpace: 'nowrap' }}>{e.title}</div>
                <div style={{ fontFamily: s.body, fontSize: 28, color: s.muted, marginTop: 6 }}>{e.who}</div>
                {reprise ? null : (
                  <>
                    <div style={{ height: 2, background: alpha(s.fg, 0.1), margin: '30px 0 26px', transform: `scaleX(${q})`, transformOrigin: 'left' }} />
                    <div style={{ fontFamily: s.display, fontStyle: 'italic', fontSize: 36, lineHeight: 1.22, color: s.accent, ...rise(q, 14) }}>{e.q}</div>
                    <div style={{ flex: 1 }} />
                    <div style={{ ...capsStyle(s, 18), color: alpha(s.fg, 0.5), opacity: q }}>{e.tool}</div>
                  </>
                )}
                {reprise ? (
                  <div
                    style={{
                      position: 'absolute', right: -22, top: -22, width: 76, height: 76, borderRadius: 999, background: s.accent2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.4 + 0.6 * chk})`, opacity: Math.min(1, chk * 2),
                      boxShadow: `0 8px 20px ${alpha(s.accent2, 0.35)}`,
                    }}
                  >
                    <Icon name="check" size={44} p={prog(f, checkAt + i * 5 + 4, 12, s.ease)} color="#ffffff" width={6} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Cover>
  );
}
