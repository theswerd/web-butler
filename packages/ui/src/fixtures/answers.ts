import type { AnswerTier } from '../lib/shell';

/**
 * Static prompt → response pairs for exercising the answer surfaces without
 * a model in the loop. Used by the Storybook scenario harness, and intended
 * for the extension's mock run mode too — send one of these prompts and the
 * shell can look up the canned response by matching id/prompt.
 *
 * The spread is deliberate: each tier gets prompts that would realistically
 * produce it, plus edge shapes (very short, scrolling-length, code-heavy).
 */
export type AnswerFixture = {
  id: string;
  tier: AnswerTier;
  /** What the user typed. */
  prompt: string;
  /** Artifact name; unused by other tiers. */
  title?: string;
  /** Artifact one-liner — what the report is. */
  description?: string;
  /** Canned response, markdown (GFM: tables, images, task lists). */
  text: string;
  /** Answer tier: suggested follow-up prompts (chips that prefill the input). */
  hints?: string[];
  /** Answer tier: multiple-choice follow-up — agent asks, user picks. */
  choices?: string[];
  /** 'single' (default) picks one; 'multi' toggles many. Submit sends. */
  choiceMode?: 'single' | 'multi';
  /** Submit button label; defaults to 'Submit'. */
  choiceSubmitLabel?: string;
};

/** Case/punctuation-insensitive prompt matching for mock playback. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Look up the canned response for a typed prompt — exact normalized match
 * first, then containment either way ("summarize this article" hits the
 * three-sentence fixture).
 */
export function findAnswerFixture(prompt: string): AnswerFixture | undefined {
  const needle = normalize(prompt);
  if (!needle) return undefined;
  return (
    ANSWER_FIXTURES.find((fixture) => normalize(fixture.prompt) === needle) ??
    ANSWER_FIXTURES.find((fixture) => {
      const canned = normalize(fixture.prompt);
      return canned.includes(needle) || needle.includes(canned);
    })
  );
}

export const ANSWER_FIXTURES: AnswerFixture[] = [
  // --- status: side effects, one-line confirmations -------------------------
  {
    id: 'status-sticky-header',
    tier: 'status',
    prompt: 'make the header sticky',
    text: 'Header pinned. It stays put while scrolling. Undo with ⌘Z.',
  },
  {
    id: 'status-cookie-banner',
    tier: 'status',
    prompt: 'hide the cookie banner forever',
    text: 'Cookie banner hidden. It stays hidden on future visits to this site.',
  },
  {
    id: 'status-job-started',
    tier: 'status',
    prompt: 'watch this page and tell me when the price drops below $200',
    text: 'Watching. You\u2019ll get a notification when the price drops below $200.',
  },

  // --- answer: questions with prose answers ---------------------------------
  {
    id: 'answer-subscribe-button',
    tier: 'answer',
    prompt: 'what does the subscribe button actually do?',
    text: 'It posts to `/api/newsletter` with the email from the form field. Validation is **client-side only**: the endpoint accepts any string, and there\u2019s no double-opt-in step.',
  },
  {
    id: 'answer-tracking',
    tier: 'answer',
    prompt: 'is this page tracking me?',
    text: `Yes. **3 trackers** load before first paint:

- \`gtag.js\`: Google Analytics 4, from the document head
- \`fbevents.js\`: Meta Pixel, injected by the tag manager
- \`clarity.js\`: Microsoft Clarity session recording

All three are loaded through the tag manager, so blocking \`googletagmanager.com\` removes them together.`,
    hints: ['block all three trackers', 'show me what data they send'],
  },
  {
    id: 'answer-article-summary',
    tier: 'answer',
    prompt: 'summarize this article in three sentences',
    text: 'The author argues that most performance regressions come from dependency creep rather than application code, based on a year of bundle-size audits across 40 production apps. The median app shipped **2.3x** more JavaScript than it executed on a typical page view. They recommend budget checks in CI as the only intervention that stuck across teams.',
  },
  {
    id: 'answer-slow-page',
    tier: 'answer',
    prompt: 'why does this page load so slowly?',
    text: `Three main causes, in order of impact:

- A **4.2 MB hero video** loads eagerly before anything else
- Web fonts block render (no \`font-display: swap\`)
- The product grid makes **14 sequential** API calls instead of batching

The video alone accounts for about 60% of the load time on a fast connection.`,
    hints: ['lazy-load the hero video', 'write this up as a report'],
  },

  // --- answers with choice follow-ups: the agent needs a decision before it
  // can act. Pick (one or many), then the submit button sends. --------------
  {
    id: 'answer-cleanup-choice',
    tier: 'answer',
    prompt: 'clean up this page',
    text: 'I can do that a few ways. How aggressive should I be?',
    choices: [
      'Hide ads only',
      'Ads + floating widgets and banners',
      'Reader mode: keep just the article',
    ],
  },
  {
    id: 'answer-blockers-multi',
    tier: 'answer',
    prompt: 'block the trackers on this site',
    text: 'Found **3 trackers**. Which should I block? This persists for future visits.',
    choices: ['Google Analytics', 'Meta Pixel', 'Microsoft Clarity'],
    choiceMode: 'multi',
    choiceSubmitLabel: 'Block selected',
  },

  // --- artifact: serious reports — render in the Chrome side panel, not
  // in-page. The in-page surface is just the "report ready" handoff card. ----
  {
    id: 'artifact-pricing-table',
    tier: 'artifact',
    prompt: 'extract the pricing table as markdown',
    title: 'Pricing table',
    description: 'All three tiers extracted as markdown, annual rates.',
    text: `Extracted from \`#pricing\`: three tiers, annual billing shown:

| Plan | Price/mo | Seats | Support |
|------|---------:|-------|---------|
| Free | $0 | 1 | Community |
| Pro | $19 | Up to 10 | Email, 24h SLA |
| Enterprise | Custom | Unlimited | Dedicated CSM |

Note: the page shows monthly prices only after toggling. These are the **annual** rates. The Enterprise row links to a contact form rather than a checkout.`,
  },
  {
    id: 'artifact-monitor-comparison',
    tier: 'artifact',
    prompt: 'compare the three monitors on this page',
    title: 'Monitor comparison',
    description: 'The three 27-inch monitors, specs and verdict.',
    text: `## The short version

The **ProView 27** is the pick unless you need USB-C power delivery, where only the Studio Display qualifies.

![Monitor on a desk](https://picsum.photos/seed/webbutler-monitor/640/320)

## Side by side

| Spec | ProView 27 | Studio Display | PixelMax Q |
|------|-----------|----------------|------------|
| Panel | IPS, 165 Hz | IPS, 60 Hz | VA, 144 Hz |
| Resolution | 1440p | 5K | 4K |
| USB-C PD | ~~90 W~~ none | 96 W | 15 W |
| Price | **$379** | $1,599 | $529 |

## Before you buy

- [x] Confirmed the ProView price includes the stand
- [x] Checked all three are in stock at this store
- [ ] Ask about the dead-pixel return window: the listing doesn't say

> The PixelMax listing shows last year's model in the photos; the Q revision has a different port layout.`,
  },
  {
    id: 'artifact-userscript',
    tier: 'artifact',
    prompt: 'write a userscript that auto-expands all collapsed comments',
    title: 'Auto-expand comments',
    description: 'Userscript that clicks every collapsed comment open.',
    text: `Runs on page load and again whenever new comments stream in:

\`\`\`
const expand = () =>
  document
    .querySelectorAll('button[aria-expanded="false"].comment-toggle')
    .forEach((el) => el.click());

expand();
new MutationObserver(expand).observe(
  document.querySelector('#comments'),
  { childList: true, subtree: true },
);
\`\`\`

The observer is scoped to \`#comments\` so it won\u2019t fire on unrelated DOM churn. If the site renames the toggle class, update the selector on line 3.`,
  },
  {
    id: 'artifact-support-email',
    tier: 'artifact',
    prompt: 'draft an email to support about being double charged this month',
    title: 'Draft: double charge',
    description: 'Refund request for the duplicate $29 charge, ready to send.',
    text: `Subject: **Duplicate charge on my account (invoice #4821)**

Hi,

I was charged twice for my subscription this month: once on the 1st and again on the 3rd, both for $29.00 on the same card ending in 4242. My account should only have one active plan.

Could you refund the duplicate charge and confirm my billing is back to a single subscription? Happy to forward both receipts if that helps.

Thanks,
Ben`,
  },
];
