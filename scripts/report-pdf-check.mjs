// The report's "PDF" action: clicking it must assemble a print-ready
// iframe — document title = report title (the PDF filename), masthead
// header, and the rendered markdown body. window.print() itself shows a
// native dialog we can't assert headlessly; the document is the contract.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 640 } });
await page.goto(
  'http://localhost:6006/iframe.html?id=side-panel-reportview--rich-markdown',
);
await page.waitForTimeout(900);

// Keep the frame around for inspection: neutralize print + its teardown.
await page.evaluate(() => {
  HTMLIFrameElement.prototype.remove = () => {};
});

await page.getByRole('button', { name: 'PDF' }).click();
await page.waitForTimeout(600);

const result = await page.evaluate(() => {
  const frame = document.querySelector('iframe[aria-hidden]');
  const doc = frame?.contentDocument;
  if (!doc) return null;
  return {
    title: doc.title,
    hasHeader: doc.querySelector('header h1') != null,
    headerText: doc.querySelector('header h1')?.textContent ?? '',
    bodyChildren: doc.body.children.length,
    hasMarkdown: doc.body.textContent.length > 200,
    styled: doc.querySelector('style')?.textContent.includes('@page') ?? false,
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();

if (
  !result ||
  !result.title ||
  !result.hasHeader ||
  !result.hasMarkdown ||
  !result.styled
) {
  console.error('FAIL: print document incomplete');
  process.exit(1);
}
console.log('PASS: print-ready document assembled');
