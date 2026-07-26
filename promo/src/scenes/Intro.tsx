import { AbsoluteFill } from 'remotion';
import { Bowtie } from '../Bowtie';
import { INK, PAPER, SERIF } from '../brand';
import { Slam } from '../kinetic';
import { beat } from '../beat';

/** Two bars: the bowtie spins in, the name slams under it. Then cut. */
export const Intro: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: PAPER,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 30,
      }}
    >
      <Bowtie size={150} from={2} />
      <Slam
        at={beat(2)}
        style={{
          fontFamily: SERIF,
          fontWeight: 600,
          fontSize: 112,
          letterSpacing: '-0.02em',
          color: INK,
        }}
      >
        Web Butler
      </Slam>
    </AbsoluteFill>
  );
};
