'use client'

import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'

/** Markdown from Airtable often includes raw URLs as links; open them in a new tab like example cards. */
const markdownOpenLinksInNewTab: Partial<Components> = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />
  },
}

export type CheckpointPresentation = {
  /** Still sent by the API / localStorage; not shown in the UI. */
  requiredActions?: string
  justificationsBenefits: string
  examples: Array<{ url: string; filename: string; thumbnailUrl: string }>
}

const mdClass =
  'flex flex-col gap-2 text-sm text-gray-700 leading-relaxed [&_a]:font-medium [&_a]:text-violet-600 [&_a]:underline [&_strong]:font-semibold [&_strong]:text-gray-900 custom-list'

export function CheckpointResultBody({
  checkpoint,
  passed,
}: {
  checkpoint: CheckpointPresentation
  passed: boolean
}) {
  return (
    <div className="space-y-5">
      {checkpoint.requiredActions?.trim() ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-zinc-200/80 bg-white/80 p-5 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Required actions
          </p>
          <div className={mdClass}>
            <ReactMarkdown components={markdownOpenLinksInNewTab}>
              {checkpoint.requiredActions}
            </ReactMarkdown>
          </div>
        </div>
      ) : null}

      {checkpoint.justificationsBenefits.trim() ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-zinc-200/80 bg-white/80 p-5 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Justifications &amp; benefits
          </p>
          <div className={mdClass}>
            <ReactMarkdown components={markdownOpenLinksInNewTab}>
              {checkpoint.justificationsBenefits}
            </ReactMarkdown>
          </div>
        </div>
      ) : null}

      {checkpoint.examples.length > 0 ? (
        <div className="flex flex-col gap-2.5"> 
          <p className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Examples
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 cursor-pointer">
            {checkpoint.examples.map((ex) => (
              <a
                key={ex.url}
                href={ex.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 shadow-sm transition hover:border-violet-300 hover:shadow-md"
              >
                <div className="relative aspect-auto sm:aspect-video w-full overflow-hidden bg-zinc-100">
                  <img
                    src={ex.thumbnailUrl}
                    alt={ex.filename}
                    className="h-full w-full object-contain object-top transition group-hover:opacity-95"
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

      {!checkpoint.requiredActions?.trim() &&
        !checkpoint.justificationsBenefits.trim() &&
        checkpoint.examples.length === 0 &&
        (
          <p className="text-sm text-gray-600">
            {passed ? 'No extra checkpoint details for this rule.' : 'No checkpoint details available.'}
          </p>
        )}
    </div>
  )
}
