import { Audio } from '@remotion/media';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { ACCENT } from './brand';
import { GRID, TOTAL_FRAMES, beat } from './beat';
import { Flash } from './kinetic';
import { Feature, type FeatureSpec } from './scenes/Feature';
import { Headline } from './scenes/Headline';
import { Intro } from './scenes/Intro';
import { OUTRO_BEAT_2, Outro } from './scenes/Outro';

export { TOTAL_FRAMES };
export const FPS = 30;

/**
 * Footage tuning. Payoff timestamps are the demo's own event timings
 * (raw footage seconds), mapped through trim + rate to scene frames.
 */
const FEATURES: FeatureSpec[] = [
  {
    id: 'ask',
    index: 0,
    kicker: 'Answers',
    title: ['Ask the', 'page itself.'],
    sub: 'Point at anything. It answers from the page.',
    trimSec: 1.2,
    rate: 1.45,
    payoffAt: 128,
    focusLabel: 'Answered',
    focus: { x: 230, y: 578, w: 1260, h: 130 },
  },
  {
    id: 'edit',
    index: 1,
    kicker: 'Alterations',
    title: ['Changes', 'that stick.'],
    sub: 'Say it once. It reapplies on every visit.',
    trimSec: 1.2,
    rate: 1.45,
    payoffAt: 128,
    focusLabel: 'Installed',
    focus: { x: 230, y: 552, w: 1260, h: 212 },
  },
  {
    id: 'form',
    index: 2,
    kicker: 'Errands',
    title: ['Errands,', 'run for you.'],
    sub: 'Forms filled behind a cursor you can watch.',
    trimSec: 3.4,
    rate: 1.9,
    payoffAt: 150,
    focusLabel: 'Filled',
    focus: { x: 415, y: 285, w: 895, h: 345 },
  },
  {
    id: 'report',
    index: 3,
    kicker: 'Reports',
    title: ['Reports,', 'filed neatly.'],
    sub: 'Long answers become documents in the side panel.',
    trimSec: 1.2,
    rate: 1.8,
    payoffAt: 150,
    focusLabel: 'Filed',
    focus: { x: 910, y: 195, w: 618, h: 700 },
  },
];

const Sfx: React.FC<{ name: string; at: number; volume: number }> = ({
  name,
  at,
  volume,
}) => (
  <Sequence from={at}>
    <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
  </Sequence>
);

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        height: 6,
        width: `${(frame / TOTAL_FRAMES) * 100}%`,
        backgroundColor: ACCENT,
        zIndex: 30,
      }}
    />
  );
};

export const Promo: React.FC = () => {
  const featureStarts = GRID.features.map(beat);
  const cutFrames = [
    beat(GRID.headline),
    ...featureStarts,
    beat(GRID.outro),
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: '#ffffff' }}>
      <Sequence durationInFrames={beat(GRID.headline)}>
        <Intro />
      </Sequence>
      <Sequence
        from={beat(GRID.headline)}
        durationInFrames={beat(GRID.features[0]) - beat(GRID.headline)}
      >
        <Headline />
      </Sequence>
      {FEATURES.map((feature, i) => (
        <Sequence
          key={feature.id}
          from={featureStarts[i]}
          durationInFrames={beat(12)}
        >
          <Feature {...feature} />
        </Sequence>
      ))}
      <Sequence from={beat(GRID.outro)}>
        <Outro />
      </Sequence>

      {cutFrames.map((f) => (
        <Flash key={f} at={f} />
      ))}
      <ProgressBar />

      {/* Music: Chronos (CC0 via FreePD), trimmed past its build so the
          first downbeat hits frame 0. */}
      <Audio
        src={staticFile('music-bed.mp3')}
        trimBefore={128}
        volume={(f) =>
          interpolate(
            f,
            [0, 8, TOTAL_FRAMES - 45, TOTAL_FRAMES - 2],
            [0, 0.5, 0.5, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          )
        }
      />

      {/* Whips on every hard cut. */}
      <Sfx name="whip" at={0} volume={0.25} />
      {cutFrames.map((f) => (
        <Sfx key={`whip-${f}`} name="whip" at={f} volume={0.3} />
      ))}

      {/* Payoffs, synced to the footage's own events. */}
      <Sfx name="ding" at={featureStarts[0] + 128} volume={0.4} />
      <Sfx name="switch" at={featureStarts[1] + 128} volume={0.4} />
      {[82, 99, 117, 136].map((f) => (
        <Sfx
          key={`fill-${f}`}
          name="mouse-click"
          at={featureStarts[2] + f}
          volume={0.28}
        />
      ))}
      <Sfx name="ding" at={featureStarts[2] + 150} volume={0.35} />
      <Sfx name="mouse-click" at={featureStarts[3] + 128} volume={0.5} />
      <Sfx name="page-turn" at={featureStarts[3] + 142} volume={0.4} />

      {/* Outro: chips click in, the address dings when it lands. */}
      {[2, 2.5, 3].map((k) => (
        <Sfx
          key={`chip-${k}`}
          name="mouse-click"
          at={beat(GRID.outro + k)}
          volume={0.22}
        />
      ))}
      <Sfx
        name="ding"
        at={beat(GRID.outro + OUTRO_BEAT_2) + 34}
        volume={0.35}
      />
    </AbsoluteFill>
  );
};
