# Web Butler promo video

A Remotion project that produces the Web Butler promo (`out/web-butler-promo.mp4`,
1920x1080, 36s, music and SFX included).

The product footage is not mocked: `scripts/record-footage.mjs` drives the real
homepage demo (`apps/homepage`, the same shell components the extension ships)
with Playwright and records each scenario (Answers, Alterations, Errands,
Reports) as MP4 into `public/footage/`.

## Rerunning

```bash
# 1. Homepage dev server (footage source)
npm run dev -w @web-butler/homepage   # from the repo root, serves :4180

# 2. Re-record footage (needs ffmpeg on PATH)
npm run footage

# 3. Preview / edit in Remotion Studio
npm run dev

# 4. Final render
npm run render
```

## Audio

- Music bed: "Chronos" (electronic, 120 BPM), public domain (CC0) via
  FreePD, mirrored at archive.org/details/freepd. No attribution required.
  `public/music-alt.mp3` ("City Sunshine", same license) is a chiller
  alternate; swap the file name in `src/Promo.tsx` to use it.
- SFX: whip, ding, switch, mouse click, page turn from remotion.media.

## Structure

Everything is cut on the music's beat grid (`src/beat.ts`): scene boundaries,
word slams, and SFX all land on beats of the 120 BPM track (one beat is
exactly 15 frames at 30fps).

- `src/Promo.tsx`: the timeline. Scene starts in beats, footage trims and
  playback rates, and the SFX map (synced to the demo's own event timings).
- `src/scenes/`: Intro (bowtie orbit spin), Headline (kinetic hero line with
  provider chips), Feature (word slams, ghost number, camera drift +
  punch zoom, camera-corner payoff brackets), Outro (dark CTA with a
  typewriter URL).
- `src/kinetic.tsx`: the motion vocabulary (Slam, Whip, Flash).
- `src/CornerFocus.tsx`: the extension's highlight brackets, drawn over the
  footage at each payoff.
- `src/brand.ts`: the homepage palette and IBM Plex fonts.
