'use client'

import { Gift, Package, Sparkles, CheckCircle2 } from 'lucide-react'

export type WhatsIncludedItem = {
  /** Line shown in the bullet list */
  text: string
  /** Optional muted subline under the bullet */
  subtext?: string
  /** Use a distinct visual treatment (still compact) */
  emphasized?: boolean
}

export type WhatsIncludedNearCtaProps = {
  className?: string
  /** Heading id for `aria-labelledby` */
  headingId?: string
  /** Section title — keep short */
  title?: string
  /** Intro line above the main list */
  primaryLead?: string
  /** Label for the first list */
  gettingLabel?: string
  includedItems: WhatsIncludedItem[]
  /** Optional second block (e.g. bonus gifts) */
  bonusLabel?: string
  bonusItems?: WhatsIncludedItem[]
  /** Small trust line under lists */
  footnote?: string
}

/**
 * PDP pattern: concise “what’s in the box” immediately above or below the primary buy button.
 * Copy into Shopify Liquid / theme sections by mirroring structure + classes.
 */
export default function WhatsIncludedNearCta({
  className = '',
  headingId = 'whats-included-heading',
  title = "What's included",
  primaryLead,
  gettingLabel = "You're getting:",
  includedItems,
  bonusLabel = 'Bonus:',
  bonusItems,
  footnote,
}: WhatsIncludedNearCtaProps) {
  const list = (items: WhatsIncludedItem[], keyPrefix: string) => (
    <ul className="mt-2 space-y-2.5 sm:space-y-3" role="list">
      {items.map((item, i) => (
        <li
          key={`${keyPrefix}-${i}`}
          className={`flex gap-3 text-left ${item.emphasized ? 'font-medium text-zinc-900' : 'text-zinc-800'}`}
        >
          <span className="mt-0.5 shrink-0 text-emerald-600" aria-hidden>
            <CheckCircle2 className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <span className="min-w-0 leading-snug">
            <span className="block">{item.text}</span>
            {item.subtext ? (
              <span className="mt-0.5 block text-xs sm:text-sm font-normal text-zinc-500">{item.subtext}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )

  return (
    <section
      className={`w-full max-w-xl rounded-2xl border-2 border-emerald-200/90 bg-linear-to-b from-emerald-50/95 via-white to-white p-4 shadow-[0_8px_30px_-12px_rgba(16,185,129,0.35)] ring-1 ring-emerald-100/80 sm:p-5 ${className}`}
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-start gap-2 border-b border-emerald-100/90 pb-3 sm:gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm sm:h-11 sm:w-11"
          aria-hidden
        >
          <Package className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-['Inter_Tight',Inter,sans-serif] text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl">
            {title}
          </h2>
          {primaryLead ? (
            <p className="mt-1 text-sm leading-relaxed text-zinc-600 sm:text-[0.9375rem]">{primaryLead}</p>
          ) : null}
        </div>
        <span
          className="ml-auto hidden items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800 sm:inline-flex"
          aria-hidden
        >
          <Sparkles className="h-3.5 w-3.5" />
          Value
        </span>
      </div>

      <div className="mt-4">
        <p className="flex items-center gap-2 font-['Inter_Tight',Inter,sans-serif] text-sm font-semibold text-emerald-900 sm:text-base">
          <span className="text-base leading-none sm:text-lg" aria-hidden>
            ✔
          </span>
          {gettingLabel}
        </p>
        {list(includedItems, 'inc')}
      </div>

      {bonusItems && bonusItems.length > 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-emerald-200/90 bg-emerald-50/50 p-3.5 sm:p-4">
          <p className="flex items-center gap-2 font-['Inter_Tight',Inter,sans-serif] text-sm font-semibold text-emerald-900 sm:text-base">
            <Gift className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
            {bonusLabel}
          </p>
          {list(bonusItems, 'bonus')}
        </div>
      ) : null}

      {footnote ? (
        <p className="mt-4 border-t border-emerald-100/80 pt-3 text-center text-xs leading-relaxed text-zinc-500 sm:text-sm">
          {footnote}
        </p>
      ) : null}
    </section>
  )
}
