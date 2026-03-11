/**
 * Gradually scrolls the page to the bottom so lazy-loaded content is triggered.
 * Waits between steps so the DOM stabilizes before we take a snapshot.
 */

const SCROLL_STEP_RATIO = 0.4
const STEP_DELAY_MS = 450
const SETTLE_AFTER_SCROLL_MS = 5000

export async function scrollPageToBottom(page: import('puppeteer-core').Page): Promise<void> {
  await page.evaluate(
    async (stepRatio: number, stepDelayMs: number) => {
      await new Promise<void>((resolve) => {
        const vh = window.innerHeight
        const maxScroll = Math.max(0, document.body.scrollHeight - vh)
        let y = 0
        const step = Math.max(vh * stepRatio, 200)
        const timer = setInterval(() => {
          y += step
          window.scrollTo(0, Math.min(y, maxScroll))
          if (y >= maxScroll) {
            clearInterval(timer)
            window.scrollTo(0, document.body.scrollHeight)
            resolve()
          }
        }, stepDelayMs)
      })
    },
    SCROLL_STEP_RATIO,
    STEP_DELAY_MS
  )
}

export function getSettleDelayMs(): number {
  return SETTLE_AFTER_SCROLL_MS
}
