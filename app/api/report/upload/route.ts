// The buyer's thank-you page screenshots: POST { id, shots: [{ dataUrl, device }] }.
// Judged against the "Customer upload" checkpoints, pinned, and kept on the report.
// The report id is the private link from the email, the same key the report page uses.
import { NextRequest, NextResponse } from 'next/server'
import { getJob, updateDoneSnapshot } from '@/lib/scanJobs/store'
import { saveImage } from '@/lib/fullReport/images'
import { visionPins } from '@/lib/fullReport/visionPins'
import { judgeUpload, toRows, uploadCheckpoints, MAX_SHOTS, MAX_TRIES, type UploadDevice, type UploadPin, type UploadState } from '@/lib/fullReport/upload'
import type { ReportSnapshot } from '@/lib/fullReport/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// the browser shrinks screenshots before sending (Vercel caps a request at 4.5 MB)
const MAX_CHARS = 1_600_000
const DATA_URL = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/

type Snap = ReportSnapshot & { upload?: UploadState; uploadTries?: number }

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string; shots?: { dataUrl?: string; device?: string }[] } | null
  const id = body?.id || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Unknown report' }, { status: 404 })
  const parent = await getJob(id).catch(() => null)
  if (!parent || !parent.scan_id.startsWith('report_') || parent.scan_id.includes('__')) return NextResponse.json({ error: 'Unknown report' }, { status: 404 })
  if (parent.status !== 'done' || !parent.snapshot) return NextResponse.json({ error: 'Your report is still being built. Try again in a minute.' }, { status: 409 })

  const shots = (body?.shots || []).slice(0, MAX_SHOTS).map((s) => ({ dataUrl: s.dataUrl || '', device: (s.device === 'mobile' ? 'mobile' : 'desktop') as UploadDevice }))
  if (!shots.length) return NextResponse.json({ error: 'Add at least one screenshot.' }, { status: 400 })
  if (shots.some((s) => s.dataUrl.length > MAX_CHARS || !DATA_URL.test(s.dataUrl))) return NextResponse.json({ error: 'One of the files is not a screenshot we can read (use PNG or JPG).' }, { status: 400 })

  const snap = parent.snapshot as Snap
  const tries = snap.uploadTries || 0
  if (tries >= MAX_TRIES) return NextResponse.json({ error: 'You reached the upload limit for this report. Reply to the report email and we will check your screenshots by hand.' }, { status: 429 })
  // count the try first, so a failing call still counts
  await updateDoneSnapshot(parent.id, { ...snap, uploadTries: tries + 1 } as never)

  try {
    const { rules, presentation } = await uploadCheckpoints()
    if (!rules.length) return NextResponse.json({ error: 'This part of the report is not available yet.' }, { status: 503 })
    const judged = await judgeUpload(shots, rules)
    if (!judged.isOrderPage) {
      return NextResponse.json({ error: "These screenshots don't look like an order confirmation page. Place a test order and screenshot the page you land on after paying." }, { status: 422 })
    }
    const results = toRows(judged, rules, presentation)
    const stamp = Date.now().toString(36)
    const saved = await Promise.all(shots.map(async (s, i) => ({
      file: await saveImage(`${parent.id}/upload-${stamp}-${i + 1}-${s.device}.${s.dataUrl.startsWith('data:image/png') ? 'png' : 'jpg'}`, s.dataUrl),
      device: s.device, dataUrl: s.dataUrl,
    })))

    // pin the issues, per device, on that device's screenshots
    const fails = results.filter((r) => r.status === 'fail').map((r) => ({ id: r.ruleId, title: r.ruleTitle, reason: r.reason }))
    const pins: UploadPin[] = []
    for (const device of ['desktop', 'mobile'] as UploadDevice[]) {
      const mine = saved.filter((s) => s.device === device)
      if (!mine.length || !fails.length) continue
      const got = await visionPins(mine.map((s) => s.dataUrl), fails, 'order confirmation page (after paying)', device).catch(() => [])
      for (const p of got) pins.push({ file: mine[p.image].file, findingId: p.findingId, box: p.box })
    }

    const upload: UploadState = { at: new Date().toISOString(), shots: saved.map(({ file, device }) => ({ file, device })), results, pins }
    await updateDoneSnapshot(parent.id, { ...snap, uploadTries: tries + 1, upload } as never)
    return NextResponse.json({ ok: true, checked: results.length })
  } catch (e) {
    console.error('[report upload]', parent.id, e)
    return NextResponse.json({ error: 'Something went wrong while checking your screenshots. Try again, or reply to the report email.' }, { status: 502 })
  }
}
