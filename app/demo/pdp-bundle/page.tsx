import Link from 'next/link'
import WhatsIncludedNearCta from '@/app/components/WhatsIncludedNearCta'

/** Mock PDP column — illustrates placement directly under the primary CTA (responsive). */
export default function DemoBundlePdpPage() {
  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-10 font-sans text-zinc-900 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/"
          className="inline-flex text-sm font-medium text-emerald-700 underline-offset-4 hover:text-emerald-800 hover:underline"
        >
          ← Back to scanner
        </Link>

        <p className="mt-6 font-['Inter_Tight',Inter,sans-serif] text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Demo / reference layout
        </p>
        <h1 className="mt-1 font-['Inter_Tight',Inter,sans-serif] text-2xl font-bold tracking-tight sm:text-3xl">
          Product column with “What’s included” near Add to bag
        </h1>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:gap-12">
          <div className="aspect-[4/5] rounded-2xl bg-gradient-to-br from-zinc-200 to-zinc-300 shadow-inner lg:aspect-auto lg:min-h-[420px]" aria-hidden />

          <div className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-lg ring-1 ring-zinc-200/80 sm:p-6 lg:sticky lg:top-8 lg:h-fit lg:self-start">
            <p className="text-xs font-medium uppercase tracking-wide text-violet-600">Starter kit · Coffee</p>
            <h2 className="font-['Inter_Tight',Inter,sans-serif] text-2xl font-bold leading-tight sm:text-[1.75rem]">
              Rainbow Dust — Starter Kit
            </h2>
            <p className="text-sm text-zinc-600">Functional blend with daily ritual support. Ships on your schedule.</p>

            <div className="rounded-xl bg-zinc-50 p-3 text-sm ring-1 ring-zinc-200/80">
              <span className="font-semibold text-zinc-900">Flexible plan:</span> 1 month supply · 30 servings
            </div>

            <button
              type="button"
              className="w-full rounded-xl bg-zinc-900 py-3.5 text-center text-base font-semibold text-white shadow-md transition hover:bg-zinc-800 active:scale-[0.99] sm:py-4"
            >
              Add to bag
            </button>

            <WhatsIncludedNearCta
              primaryLead="Everything in your first shipment — listed below the buy button so shoppers don’t hunt in gallery images."
              includedItems={[
                { text: 'Rainbow Dust Starter Kit', emphasized: true },
                { text: 'Free electric whisk' },
                { text: 'Free mug' },
                { text: 'Free spoon' },
              ]}
              bonusItems={[{ text: 'Free gifts included at no extra cost' }]}
              footnote="Ships with your first order. Bundle items may vary by region — keep this list in sync with checkout."
            />

            <p className="text-xs text-zinc-500">
              In production (e.g. Shopify), render this block in the product form section, immediately after the{' '}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.7rem]">product-form</code> submit button on
              desktop and mobile.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
