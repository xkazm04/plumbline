// The three examples' openers. Each draws the example's idea as a diagram over the first seconds of its beat,
// timed to the narration, then lifts away to the real page that proves it. Names on screen are the stage's real
// ones (the fixture's files, the stage repository's tools, the lock's file name); no figure is invented.
import { interpolate, useCurrentFrame } from 'remotion';
import { alpha, capsStyle, prog, useStyle, type MomentProps } from '@film/kit';
import { ChapterTag, Cover, Fingerprint, Icon, Pill, card, fr, rise } from './parts.tsx';

const LARCH_GREEN = '#3d5a3c';
const LARCH_CREAM = '#fbf8ef';

/** 01, the guesthouse: the page and its agent say the same price, and the lock holds that fact. */
export function GuesthouseConcept({ props, ctx }: MomentProps) {
  const f = useCurrentFrame();
  const s = useStyle();
  const bubbleAt = fr(props.bubbleAt, 1830);
  const lockAt = fr(props.lockAt, 2700);
  const pageP = prog(f, 4, 20, s.ease);
  const bubbleP = prog(f, bubbleAt, 16, s.ease);
  const text = 'A double room is €89 a night.';
  const typed = text.slice(0, Math.max(0, Math.min(text.length, Math.floor((f - bubbleAt - 6) * 1.7))));
  const link = prog(f, lockAt - 8, 18, s.ease);
  const lock = prog(f, lockAt, 16, s.ease);
  const hi = prog(f, lockAt + 4, 12, s.ease);

  return (
    <Cover f={f} ctx={ctx} s={s}>
      <ChapterTag f={f} s={s} n="01" name="A guesthouse" note="Larch House" />
      {/* the page */}
      <div style={{ position: 'absolute', left: 180, top: 300, ...rise(pageP, 40) }}>
        <div style={{ ...capsStyle(s, 20), marginBottom: 18 }}>The page</div>
        <div style={card(s, { width: 700, height: 400, overflow: 'hidden', background: LARCH_CREAM })}>
          <div style={{ height: 76, background: LARCH_GREEN, color: LARCH_CREAM, display: 'flex', alignItems: 'center', padding: '0 34px', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 32 }}>Larch House</div>
          <div style={{ padding: '30px 40px', fontFamily: 'Georgia, serif', color: LARCH_GREEN }}>
            <div style={{ fontSize: 44 }}>Rooms and prices</div>
            <div style={{ marginTop: 34, borderTop: `2px solid ${alpha(LARCH_GREEN, 0.15)}`, borderBottom: `2px solid ${alpha(LARCH_GREEN, 0.15)}`, padding: '22px 0', display: 'flex', justifyContent: 'space-between', fontSize: 34, color: '#22301f' }}>
              <span>Double room</span>
              <span style={{ padding: '2px 12px', margin: '-2px -12px', borderRadius: 8, outline: `4px solid ${alpha(s.accent, hi)}`, background: alpha(s.accent, 0.08 * hi) }}>€89 per night</span>
            </div>
            <div style={{ marginTop: 20, fontSize: 28, color: alpha('#22301f', 0.45) }}>Single room · Garden room</div>
          </div>
        </div>
      </div>
      {/* its agent */}
      <div style={{ position: 'absolute', left: 1110, top: 400, ...rise(bubbleP, 40) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 999, background: s.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="agent" size={38} color="#ffffff" width={4.5} />
          </div>
          <div style={capsStyle(s, 20)}>Its agent, to a guest</div>
        </div>
        <div style={card(s, { width: 620, minHeight: 96, padding: '30px 36px', boxSizing: 'border-box', borderTopLeftRadius: 4, fontFamily: s.body, fontSize: 38, color: s.fg })}>
          {typed}
          <span style={{ opacity: typed.length < text.length && f > bubbleAt ? 1 : 0, color: s.accent }}>▍</span>
        </div>
      </div>
      {/* the lock holds the fact both say */}
      <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        <path d="M 880 612 C 980 612, 1010 560, 1110 560" fill="none" stroke={s.accent} strokeWidth={4} pathLength={1} style={{ strokeDasharray: `${link} 1` }} />
      </svg>
      <div style={{ position: 'absolute', left: 995 - 36, top: 586 - 36, width: 72, height: 72, borderRadius: 999, background: s.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.3 + 0.7 * lock})`, opacity: Math.min(1, lock * 2), boxShadow: `0 10px 24px ${alpha(s.accent, 0.35)}` }}>
        <Icon name="pin" size={46} color="#ffffff" width={4.5} />
      </div>
      <div style={{ position: 'absolute', left: 1110, top: 650, ...rise(prog(f, lockAt + 6, 16, s.ease), 14) }}>
        <Pill s={s} color={s.accent} bg={alpha(s.accent, 0.1)}>Plumbline locks the fact</Pill>
      </div>
    </Cover>
  );
}

const CLINIC_FILES = ['agent-manifest.json', 'links.json', 'northgate_clinic.network.json'];

/** 02, the clinic: its agent files, a fingerprint each, signed with a key only the clinic holds, for its own address. */
export function ClinicConcept({ props, ctx }: MomentProps) {
  const f = useCurrentFrame();
  const s = useStyle();
  const filesAt = fr(props.filesAt, 1100);
  const keyAt = fr(props.keyAt, 2100);
  const signAt = fr(props.signAt, 3000);
  const origin = typeof props.origin === 'string' ? props.origin : 'northgate-clinic.localhost';
  const em = prog(f, 4, 20, s.ease);
  const keyP = prog(f, keyAt, 16, s.ease);
  const travel = prog(f, signAt - 10, 18, s.ease);
  const stamp = prog(f, signAt + 6, 10, s.ease);

  return (
    <Cover f={f} ctx={ctx} s={s}>
      <ChapterTag f={f} s={s} n="02" name="A clinic" note="Northgate Clinic" />
      <div style={{ position: 'absolute', left: 200, top: 300, width: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', ...rise(em, 40) }}>
        <Icon name="clinic" size={190} p={prog(f, 6, 26, s.ease)} color={s.accent2} width={3.4} />
        <div style={{ fontFamily: s.display, fontWeight: 700, fontSize: 52, color: s.fg, marginTop: 26 }}>Northgate Clinic</div>
        <div style={{ fontFamily: s.mono, fontSize: 24, color: s.muted, marginTop: 8 }}>{origin}</div>
      </div>
      {/* the files, each with its fingerprint */}
      <div style={{ position: 'absolute', left: 820, top: 300, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {CLINIC_FILES.map((name, i) => {
          const p = prog(f, filesAt + i * 5, 18, s.ease);
          return (
            <div key={name} style={{ ...card(s, { width: 860, height: 128, padding: '0 34px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 28 }), ...rise(p, 30) }}>
              <Icon name="file" size={64} p={prog(f, filesAt + i * 5 + 2, 18, s.ease)} color={s.fg} width={3.6} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: s.mono, fontSize: 30, color: s.fg }}>{name}</div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ ...capsStyle(s, 15), letterSpacing: '0.18em' }}>sha-256</span>
                  <Fingerprint seed={name} p={prog(f, filesAt + i * 5 + 8, 22, (t) => t)} color={s.muted} width={360} height={18} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* the key: only the clinic holds it; it travels to the files to sign them */}
      <div style={{ position: 'absolute', left: 300 + interpolate(travel, [0, 1], [0, 1292]), top: 720 - interpolate(travel, [0, 1], [0, 440]), opacity: Math.min(1, keyP * 2) * (1 - stamp), transform: `scale(${0.6 + 0.4 * keyP})`, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 96, height: 96, borderRadius: 999, background: s.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 10px 24px ${alpha(s.accent, 0.35)}` }}>
          <Icon name="key" size={60} p={prog(f, keyAt + 2, 18, s.ease)} color="#ffffff" width={4.5} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 170, width: 480, top: 840, textAlign: 'center', fontFamily: s.display, fontStyle: 'italic', fontSize: 34, color: s.accent, opacity: prog(f, keyAt + 10, 14, s.ease) * (1 - travel) }}>
        a key only the clinic holds
      </div>
      {/* the signature, for this address */}
      <div style={{ position: 'absolute', left: 1540, top: 230, transform: `rotate(-8deg) scale(${interpolate(stamp, [0, 1], [1.7, 1])})`, opacity: stamp, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 200, height: 200, borderRadius: 999, background: alpha(s.accent, 0.08), border: `5px solid ${s.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="seal" size={140} color={s.accent} width={3.4} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 820, top: 800, ...rise(prog(f, signAt + 12, 16, s.ease), 14) }}>
        <Pill s={s} color={s.accent} bg={alpha(s.accent, 0.1)}>
          Signed by the clinic, for <span style={{ fontFamily: s.mono, fontWeight: 500 }}>{origin}</span>
        </Pill>
      </div>
    </Cover>
  );
}

const AGENT_PARTS = [
  { file: 'CLAUDE.md', what: 'its instructions' },
  { file: '.claude/settings.json', what: 'its settings' },
  { file: 'notes server', what: 'every tool: search_notes, add_note' },
];

/** 03, the coding agent: its instructions, its settings and every tool, each pinned into the lock. */
export function AgentConcept({ props, ctx }: MomentProps) {
  const f = useCurrentFrame();
  const s = useStyle();
  const cues = Array.isArray(props.cues) ? (props.cues as number[]) : [2720, 3600, 4290];
  const ag = prog(f, 4, 20, s.ease);
  const lockAt = fr(cues[2]) + 22;
  const lockP = prog(f, lockAt, 16, s.ease);
  const AX = 1300;
  const AY = 560;

  return (
    <Cover f={f} ctx={ctx} s={s}>
      <ChapterTag f={f} s={s} n="03" name="A coding agent" note="your repository" />
      <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0 }}>
        {AGENT_PARTS.map((_, i) => {
          const y = 330 + i * 190 + 70;
          const p = prog(f, fr(cues[i]) + 6, 16, s.ease);
          return <path key={i} d={`M 900 ${y} C 1060 ${y}, 1120 ${AY}, ${AX} ${AY}`} fill="none" stroke={alpha(s.fg, 0.28)} strokeWidth={3} pathLength={1} style={{ strokeDasharray: `${p} 1` }} />;
        })}
      </svg>
      {AGENT_PARTS.map((part, i) => {
        const at = fr(cues[i]);
        const p = prog(f, at, 16, s.ease);
        const pin = prog(f, at + 12, 12, s.ease);
        return (
          <div key={part.file} style={{ position: 'absolute', left: 220, top: 330 + i * 190, ...rise(p, 30) }}>
            <div style={card(s, { width: 680, height: 140, padding: '0 32px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 26, position: 'relative' })}>
              <Icon name="file" size={60} p={prog(f, at + 2, 18, s.ease)} color={s.fg} />
              <div>
                <div style={{ fontFamily: s.mono, fontSize: 30, color: s.fg }}>{part.file}</div>
                <div style={{ fontFamily: s.display, fontStyle: 'italic', fontSize: 30, color: s.muted, marginTop: 6 }}>{part.what}</div>
              </div>
              <div style={{ position: 'absolute', right: -26, top: -26, width: 66, height: 66, borderRadius: 999, background: s.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.3 + 0.7 * pin})`, opacity: Math.min(1, pin * 2), boxShadow: `0 8px 20px ${alpha(s.accent, 0.35)}` }}>
                <Icon name="pin" size={42} color="#ffffff" width={4.5} />
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: AX, top: AY - 170, width: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', ...rise(ag, 40) }}>
        <div style={{ ...card(s, { width: 300, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: s.fg, border: 'none' }) }}>
          <Icon name="agent" size={190} p={prog(f, 6, 26, s.ease)} color="#ffffff" width={3.2} />
        </div>
        <div style={{ ...capsStyle(s, 24), color: s.fg, marginTop: 26 }}>The coding agent</div>
      </div>
      <div style={{ position: 'absolute', left: AX - 170, width: 740, top: AY + 230, textAlign: 'center', ...rise(lockP, 14) }}>
        <Pill s={s} color={s.accent} bg={alpha(s.accent, 0.1)}>
          pinned in <span style={{ fontFamily: s.mono, fontWeight: 500 }}>plumbline.agent.lock.json</span>
        </Pill>
      </div>
    </Cover>
  );
}

