import type { PickedElement } from '@web-butler/ui';

export const SAMPLE_ELEMENTS: PickedElement[] = [
  {
    id: 'story-1',
    selector: 'main > button.subscribe',
    label: 'button.subscribe',
    tag: 'button',
    text: 'Subscribe',
    html: '<button class="subscribe">Subscribe</button>',
  },
  {
    id: 'story-2',
    selector: 'header nav.site-nav',
    label: 'nav.site-nav',
    tag: 'nav',
    text: 'Home Products About',
    html: '<nav class="site-nav">…</nav>',
  },
  {
    id: 'story-3',
    selector: '#pricing table',
    label: 'table#pricing',
    tag: 'table',
    text: 'Free Pro Enterprise',
    html: '<table id="pricing">…</table>',
  },
];
