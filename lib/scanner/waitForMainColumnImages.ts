import type { Page } from 'puppeteer-core'

/**
 * Resolve lazy-loaded PDP images before DOM heuristics (gift rows, thumbnails).
 * Vercel runs slower than typical laptops — short timeouts yield 0×0 rects.
 */
export async function waitForMainColumnImages(
  page: Page,
  options?: { perImageBudgetMs?: number; maxImages?: number }
): Promise<void> {
  const perImageBudgetMs = options?.perImageBudgetMs ?? 2800
  const maxImages = options?.maxImages ?? 140

  try {
    await page.evaluate(async (budget: number, cap: number) => {
      const imgs = Array.from(document.querySelectorAll('main img, [role="main"] img')).slice(
        0,
        cap,
      ) as HTMLImageElement[]
      await Promise.all(
        imgs.map(
          (el) =>
            new Promise<void>((resolve) => {
              const finish = () => resolve()
              if (!el.src && !(el.srcset || '').trim() && !(el.dataset.src || '').trim()) {
                finish()
                return
              }
              if (el.complete && (el.naturalWidth > 6 || !(el.src || '').length)) {
                finish()
                return
              }
              const id = window.setTimeout(finish, budget)
              el.addEventListener(
                'load',
                () => {
                  window.clearTimeout(id)
                  finish()
                },
                { once: true },
              )
              el.addEventListener(
                'error',
                () => {
                  window.clearTimeout(id)
                  finish()
                },
                { once: true },
              )
            }),
        ),
      )
    }, perImageBudgetMs, maxImages)
  } catch {
    /* snapshot still runs without this hydration */
  }
}
