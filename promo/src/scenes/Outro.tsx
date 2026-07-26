import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { Bowtie } from '../Bowtie';
import { CLAUDE, MONO, SANS, SERIF } from '../brand';
import { ChatGPTLogo, ClaudeLogo, GrokLogo } from '../ProviderLogos';
import { Slam, Whip } from '../kinetic';
import { beat } from '../beat';

export const OUTRO_BEAT_2 = 8; // beats into the scene

const chip: React.CSSProperties = {
  alignItems: 'center',
  gap: 16,
  backgroundColor: '#232323',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 999,
  padding: '18px 34px',
  fontFamily: SANS,
  fontWeight: 600,
  fontSize: 30,
  color: '#fff',
};

const URL = 'butler.swerdlow.dev';

/** The close: pitch slams on ink, then the address types itself out. */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const b2 = beat(OUTRO_BEAT_2);

  const beat1Opacity = interpolate(frame, [b2 - 8, b2], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Typewriter with a blinking caret.
  const typed = Math.round(
    interpolate(frame, [b2 + 10, b2 + 34], [0, URL.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.linear,
    }),
  );
  const caretOn = Math.floor(frame / 8) % 2 === 0 || typed < URL.length;

  return (
    <AbsoluteFill style={{ backgroundColor: '#171717' }}>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 56,
          opacity: beat1Opacity,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: SERIF,
            fontWeight: 500,
            fontSize: 96,
            letterSpacing: '-0.015em',
            color: '#fff',
            textAlign: 'center',
            lineHeight: 1.1,
            maxWidth: 1400,
          }}
        >
          <Slam at={beat(0)}>Works with the AI</Slam>{' '}
          <Slam at={beat(1)}>
            you <em>already pay for.</em>
          </Slam>
        </h2>
        <div style={{ display: 'flex', gap: 22 }}>
          <Whip at={beat(2)} tilt={-9} style={chip}>
            <ChatGPTLogo size={34} color="#fff" />
            ChatGPT
          </Whip>
          <Whip at={beat(2.5)} tilt={8} style={chip}>
            <ClaudeLogo size={34} color={CLAUDE} />
            Claude
          </Whip>
          <Whip at={beat(3)} tilt={-7} style={chip}>
            <GrokLogo size={32} color="#fff" />
            Grok
          </Whip>
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 42,
          opacity: interpolate(frame, [b2, b2 + 10], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <Bowtie size={120} ink="#fff" from={b2 + 2} />
        <p
          style={{
            margin: 0,
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: 54,
            letterSpacing: '0.05em',
            color: '#fff',
          }}
        >
          {URL.slice(0, typed)}
          <span style={{ opacity: caretOn ? 1 : 0 }}>▌</span>
        </p>
        <Slam
          at={b2 + 38}
          style={{
            fontFamily: SANS,
            fontSize: 28,
            color: 'rgba(255,255,255,0.55)',
          }}
        >
          Free · Open source · Chrome
        </Slam>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
