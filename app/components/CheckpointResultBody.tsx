'use client'

import ReactMarkdown from 'react-markdown'

export type CheckpointPresentation = {
  /** Still sent by the API / localStorage; not shown in the UI. */
  requiredActions?: string
  justificationsBenefits: string
  examples: Array<{ url: string; filename: string; thumbnailUrl: string }>
}

const mdClass =
  'text-sm text-gray-700 leading-relaxed [&_a]:font-medium [&_a]:text-violet-600 [&_a]:underline [&_strong]:font-semibold [&_strong]:text-gray-900'

export function CheckpointResultBody({
  checkpoint,
  summaryLine,
  passed,
}: {
  checkpoint: CheckpointPresentation
  summaryLine: string
  passed: boolean
}) {
  return (
    <div className="space-y-5">
      {summaryLine.trim() ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Scan summary
          </p>
          <p className="text-sm leading-relaxed text-gray-800">{summaryLine}</p>
        </div>
      ) : null}

      {checkpoint.justificationsBenefits.trim() ? (
        <div className="rounded-lg border border-zinc-200/80 bg-white/80 p-3 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
            Justifications &amp; benefits
          </p>
          <div className={mdClass}>
            <ReactMarkdown>{checkpoint.justificationsBenefits}</ReactMarkdown>
          </div>
        </div>
      ) : null}

      {checkpoint.examples.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
            Examples
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {checkpoint.examples.map((ex) => (
              <a
                key={ex.url}
                href={ex.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 shadow-sm transition hover:border-violet-300 hover:shadow-md"
              >
                <div className="relative aspect-[480/308] w-full overflow-hidden bg-zinc-100">
                  <img
                    src={ex.thumbnailUrl}
                    alt={ex.filename}
                    className="h-full w-full object-cover object-top transition group-hover:opacity-95"
                    loading="lazy"
                  />
                </div>
                <p className="line-clamp-2 px-2 py-1.5 text-[11px] font-medium text-zinc-700">
                  {ex.filename}
                </p>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {!checkpoint.justificationsBenefits.trim() &&
        checkpoint.examples.length === 0 &&
        !summaryLine.trim() && (
          <p className="text-sm text-gray-600">
            {passed ? 'No extra checkpoint details for this rule.' : 'No checkpoint details available.'}
          </p>
        )}
    </div>
  )
}
