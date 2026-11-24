'use client'

// The thank-you page tab of the full report, before (or instead of) results: the buyer uploads
// screenshots of their order confirmation. Images are shrunk in the browser (Vercel caps a request
// at 4.5 MB) and sent to /api/report/upload, which judges and pins them.
import { useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { api } from '@/lib/base'
import { MonitorIcon, PhoneIcon, type Device } from './PinnedPage'

const MAX_SHOTS = 4
const MAX_WIDTH = { desktop: 1400, mobile: 900 }
const MAX_HEIGHT = 7000

type Picked = { id: string; name: string; preview: string; device: Device; file: File }

async function shrink(file: File, device: Device): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url })
    const scale = Math.min(1, MAX_WIDTH[device] / img.naturalWidth, MAX_HEIGHT / img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale)
    c.height = Math.round(img.naturalHeight * scale)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    // under ~1.1 MB each, so four fit in one request
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const d = c.toDataURL('image/jpeg', q)
      if (d.length < 1_500_000) return d
    }
    return c.toDataURL('image/jpeg', 0.3)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** A phone screenshot is narrow and tall: a good first guess, the buyer can switch it. */
async function guessDevice(file: File): Promise<Device> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url })
    return img.naturalWidth < 1000 || img.naturalHeight / img.naturalWidth > 1.8 ? 'mobile' : 'desktop'
  } catch { return 'desktop' } finally { URL.revokeObjectURL(url) }
}

export function ThankYouUpload({ reportId, checks, onDone, onCancel }: { reportId: string; checks: number; onDone: () => void; onCancel?: () => void }) {
  const [picked, setPicked] = useState<Picked[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)

  const add = async (files: FileList | File[]) => {
    setError(null)
    const imgs = Array.from(files).filter((f) => /^image\/(png|jpe?g|webp|heic|heif)$/i.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name))
    if (!imgs.length) { setError('Choose PNG or JPG screenshots.'); return }
    const room = MAX_SHOTS - picked.length
    if (imgs.length > room) setError(`Up to ${MAX_SHOTS} screenshots: we kept the first ${Math.max(room, 0)}.`)
    const next = await Promise.all(imgs.slice(0, Math.max(room, 0)).map(async (f) => ({
      id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, name: f.name, preview: URL.createObjectURL(f), device: await guessDevice(f), file: f,
    })))
    setPicked((p) => [...p, ...next])
  }
  const remove = (id: string) => setPicked((p) => p.filter((x) => x.id !== id))
  const setDev = (id: string, device: Device) => setPicked((p) => p.map((x) => (x.id === id ? { ...x, device } : x)))

  const send = async () => {
    if (!picked.length || busy) return
    setBusy(true); setError(null)
    try {
      const shots = await Promise.all(picked.map(async (p) => ({ device: p.device, dataUrl: await shrink(p.file, p.device) })))
      const r = await fetch(api('/report/upload'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: reportId, shots }) })
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok || !d.ok) { setError(d.error || 'Something went wrong. Try again.'); return }
      onDone()
    } catch {
      setError("We couldn't read one of the screenshots. Try a PNG or JPG.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-6 max-[560px]:p-5">
      <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">
        Our scan can't place an order on your store, so it can't see your thank-you page. Upload screenshots of it and we check <b className="text-[var(--text)]">{checks} more points</b> in about a minute.
      </p>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-[14px] leading-[1.6] text-[var(--text-muted)]">
        <li>Place a test order on your store (a 100% discount code works).</li>
        <li>Screenshot the page you land on after paying, on your phone and on your computer. A full-page screenshot is best.</li>
        <li>Have a post-purchase offer before the thank-you page? Add that screenshot too.</li>
      </ol>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) add(e.dataTransfer.files) }}
        onClick={() => picked.length < MAX_SHOTS && input.current?.click()}
        role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click() }}
        className={`mt-5 grid cursor-pointer place-items-center rounded-[14px] border border-dashed px-4 py-8 text-center transition-colors ${drag ? 'border-[var(--text)] bg-[var(--surface-muted)]' : 'border-[var(--border-strong)] hover:bg-[var(--surface-muted)]'}`}>
        <ImagePlus className="h-6 w-6 text-[var(--text-muted)]" aria-hidden />
        <p className="mt-2 text-[14px] font-semibold text-[var(--text)]">Drop up to {MAX_SHOTS} screenshots, or choose files</p>
        <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">PNG or JPG</p>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }} />
      </div>

      {picked.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {picked.map((p) => (
            <li key={p.id} className="relative overflow-hidden rounded-[12px] border border-[var(--border)]">
              <img src={p.preview} alt={p.name} className="block h-36 w-full object-cover object-top" />
              <button type="button" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`} className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-[var(--surface)] shadow">
                <X className="h-4 w-4" aria-hidden />
              </button>
              <div role="group" aria-label="Device" className="flex gap-0.5 border-t border-[var(--border)] bg-[var(--surface-muted)] p-1">
                {(['desktop', 'mobile'] as Device[]).map((d) => (
                  <button key={d} type="button" onClick={() => setDev(p.id, d)} aria-pressed={p.device === d}
                    className={`inline-flex flex-1 items-center justify-center gap-1 rounded-full py-1 text-[12px] font-semibold ${p.device === d ? 'bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgba(9,9,11,.12)]' : 'text-[var(--text-muted)]'}`}>
                    {d === 'desktop' ? <MonitorIcon /> : <PhoneIcon />}{d === 'desktop' ? 'Desktop' : 'Mobile'}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 rounded-[12px] bg-[var(--surface-muted)] px-4 py-3 text-[14px] text-[var(--text)]">{error}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={send} disabled={!picked.length || busy} className="cxo-btn cxo-btn-primary disabled:opacity-50">
          {busy ? 'Checking your screenshots, about a minute…' : 'Check my thank-you page'}
        </button>
        {onCancel && !busy && <button type="button" onClick={onCancel} className="text-[14px] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]">Keep my current results</button>}
      </div>
    </div>
  )
}
