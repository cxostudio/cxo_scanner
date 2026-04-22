'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Components } from 'react-markdown'
import { X } from 'lucide-react'
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
  'flex flex-col gap-2 text-sm text-gray-700 leading-relaxed [&_a]:font-medium [&_a]:text-violet-600 [&_a]:underline [&_strong]:font-semibold custom-list'

export function CheckpointResultBody({
  checkpoint,
  passed,
}: {
  checkpoint: CheckpointPresentation
  passed: boolean
}) {
  const [examplePreview, setExamplePreview] = useState<
    CheckpointPresentation['examples'][number] | null
  >(null)

  useEffect(() => {
    if (!examplePreview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExamplePreview(null)
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [examplePreview])

  return (
    <div className="space-y-5">
      {checkpoint.requiredActions?.trim() ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-zinc-200/80 bg-white/80 p-5 shadow-sm">
          <p className="text-sm  uppercase tracking-wide text-black font-bold ">
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
          <p className="text-sm  uppercase tracking-wide text-black font-bold ">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {checkpoint.examples.map((ex) => (
              <button
                key={ex.url}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setExamplePreview(ex)
                }}
                className="group w-full cursor-pointer overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 text-left shadow-sm transition hover:border-violet-300 hover:shadow-md"
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
              </button>
            ))}
          </div>

          {examplePreview &&
            createPortal(
              <div
                className="fixed inset-0 z-200 overflow-y-auto bg-zinc-900/60"
                role="presentation"
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setExamplePreview(null)
                }}
              >
                {/* min-h-[100dvh] + flex center: works below sm (640px) where Flowbite modal sat at top */}
                <div className="flex min-h-dvh w-full items-center justify-center p-3">
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="example-image-modal-title"
                    className="relative my-4 w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-3 py-3 sm:px-5">
                      <h3
                        id="example-image-modal-title"
                        className="min-w-0 flex-1 text-left text-base font-medium leading-snug text-zinc-900"
                      >
                        {examplePreview.filename}
                      </h3>
                      <button
                        type="button"
                        aria-label="Close"
                        className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
                        onClick={() => setExamplePreview(null)}
                      >
                        <X className="h-5 w-5" aria-hidden />
                      </button>
                    </div>
                    <div className="max-h-[min(75dvh,calc(100dvh-8rem))] overflow-y-auto p-3 sm:p-4">
                      <div className="flex justify-center rounded-lg bg-zinc-50 p-2">
                        <img
                          src={examplePreview.url}
                          alt={examplePreview.filename}
                          className="max-h-[min(70dvh,800px)] w-full object-contain"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>,
              document.body,
            )}
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
