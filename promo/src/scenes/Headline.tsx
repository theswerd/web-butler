import { AbsoluteFill } from 'remotion';
import { CLAUDE, INK, LINE, PAPER, SERIF } from '../brand';
import { ChatGPTLogo, ClaudeLogo, GrokLogo } from '../ProviderLogos';
import { Slam, Whip } from '../kinetic';
import { beat } from '../beat';

const CHIP = 108;

const chip: React.CSSProperties = {
  alignItems: 'center',
  justifyContent: 'center',
  width: CHIP,
  height: CHIP,
  borderRadius: '50%',
  backgroundColor: PAPER,
  border: `2px solid ${LINE}`,
  boxShadow: '0 4px 18px rgba(0,0,0,0.10)',
};

/** The hero line, one slam per beat, chips whipping in between. */
export const Headline: React.FC = () => {
  const b = (k: number) => beat(k); // local: scene starts at a boundary

  return (
    <AbsoluteFill
      style={{
        backgroundColor: PAPER,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 44,
          fontFamily: SERIF,
          fontWeight: 500,
          fontSize: 138,
          letterSpacing: '-0.02em',
          color: INK,
        }}
      >
        <Slam at={b(0)}>
          Your <em>AI subscription</em>
        </Slam>
        <span style={{ display: 'inline-flex' }}>
          <Whip at={b(1)} tilt={-10} style={{ ...chip, zIndex: 3 }}>
            <ChatGPTLogo size={58} color={INK} />
          </Whip>
          <Whip
            at={b(1.5)}
            tilt={9}
            style={{ ...chip, marginLeft: -28, zIndex: 2 }}
          >
            <ClaudeLogo size={58} color={CLAUDE} />
          </Whip>
          <Whip
            at={b(2)}
            tilt={-8}
            style={{ ...chip, marginLeft: -28, zIndex: 1 }}
          >
            <GrokLogo size={52} color={INK} />
          </Whip>
        </span>
      </div>
      <div
        style={{
          fontFamily: SERIF,
          fontWeight: 500,
          fontSize: 138,
          letterSpacing: '-0.02em',
          color: INK,
        }}
      >
        <Slam at={b(3)}>on every page.</Slam>
      </div>
    </AbsoluteFill>
  );
};
