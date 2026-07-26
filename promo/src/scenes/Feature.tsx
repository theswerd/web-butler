import { Video } from '@remotion/media';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ACCENT, INK, INK_2, MONO, PAPER, SANS, SERIF } from '../brand';
import { CornerFocus } from '../CornerFocus';
import { Slam } from '../kinetic';

/**
 * One product scene, cut to the beat:
 * - an oversized ghost number drifts behind everything (parallax)
 * - kicker pill whips in, headline words slam one by one
 * - the demo window flies in with a slight tilt and keeps drifting
 * - at the payoff the whole frame punch-zooms toward the moment and
 *   the extension's camera-corner brackets snap around it
 *
 * Footage: 1720x1280, window at x=200 y=112 w=1320 (record-footage.mjs).
 */
const FOOTAGE = { width: 1720, height: 1280, window: { x: 200, y: 112, w: 1320 } };
const SLOT = { x: 724, y: 116, windowWidth: 1076 };

export type FeatureSpec = {
  id: string;
  index: number;
  kicker: string;
  title: string[];
  sub: string;
  trimSec: number;
  rate: number;
  /** Scene-local frame of the payoff moment. */
  payoffAt: number;
  focusLabel: string;
  /** Payoff region in raw footage pixels. */
  focus: { x: number; y: number; w: number; h: number };
};

export const Feature: React.FC<FeatureSpec> = ({
  id,
  index,
  kicker,
  title,
  sub,
  trimSec,
  rate,
  payoffAt,
  focusLabel,
  focus,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const scale = SLOT.windowWidth / FOOTAGE.window.w;
  const videoLeft = SLOT.x - FOOTAGE.window.x * scale;
  const videoTop = SLOT.y - FOOTAGE.window.y * scale;

  const focusRect = {
    left: videoLeft + focus.x * scale,
    top: videoTop + focus.y * scale,
    width: focus.w * scale,
    height: focus.h * scale,
  };
  const focusCenter = {
    x: focusRect.left + focusRect.width / 2,
    y: focusRect.top + focusRect.height / 2,
  };

  // Camera: slow push all scene long, punch at the payoff. Only the
  // footage rides the camera; the copy stays planted.
  const drift = interpolate(frame, [0, durationInFrames], [1.0, 1.04]);
  const punch = interpolate(frame, [payoffAt - 2, payoffAt + 9], [0, 0.08], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.2, 1.3, 0.4, 1),
  });
  const camera = drift + punch;

  // Window flies in from the right with a settling tilt.
  const entry = interpolate(frame, [0, 14], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.2, 1.2, 0.4, 1),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: PAPER, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          scale: String(camera),
          transformOrigin: `${focusCenter.x}px ${focusCenter.y}px`,
        }}
      >
        {/* The ghost number, drifting slowly against the camera. */}
        <span
          style={{
            position: 'absolute',
            left: 46,
            bottom: -110,
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: 560,
            lineHeight: 1,
            color: 'rgba(23, 23, 23, 0.045)',
            translate: `${interpolate(frame, [0, durationInFrames], [0, -60])}px 0`,
            zIndex: 0,
          }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>

        <div
          style={{
            position: 'absolute',
            left: videoLeft,
            top: videoTop,
            width: FOOTAGE.width * scale,
            height: FOOTAGE.height * scale,
            zIndex: 1,
            opacity: entry,
            translate: `${(1 - entry) * 320}px ${(1 - entry) * 40}px`,
            rotate: `${(1 - entry) * 3}deg`,
            transformOrigin: '80% 20%',
          }}
        >
          <Video
            src={staticFile(`footage/${id}.mp4`)}
            trimBefore={Math.round(trimSec * fps)}
            playbackRate={rate}
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        <CornerFocus at={payoffAt} label={focusLabel} rect={focusRect} />
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          paddingLeft: 110,
          width: 680,
          gap: 26,
        }}
      >
          <Slam
            at={4}
            style={{
              alignSelf: 'flex-start',
              backgroundColor: ACCENT,
              color: '#fff',
              fontFamily: MONO,
              fontWeight: 500,
              fontSize: 25,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '10px 22px',
              borderRadius: 999,
            }}
          >
            {kicker}
          </Slam>
          <h2
            style={{
              margin: 0,
              fontFamily: SERIF,
              fontWeight: 500,
              fontSize: 96,
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
              color: INK,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            {title.map((word, i) => (
              <Slam key={word} at={8 + i * 4}>
                {word}
              </Slam>
            ))}
          </h2>
          <Slam
            at={8 + title.length * 4 + 2}
            style={{
              fontFamily: SANS,
              fontSize: 31,
              lineHeight: 1.45,
              color: INK_2,
              maxWidth: 470,
            }}
          >
            {sub}
          </Slam>
      </div>
    </AbsoluteFill>
  );
};
