"use client";
// Browser side of a scan job (see lib/scanJobs/store.ts). The scan page registers the scan, sends a
// heartbeat while it runs, says when the tab is hidden or closed, and hands over the finished scan.
// If the page goes quiet, the server finishes the scan and the results email still goes out.
// Nothing here can break a scan: every call fails silently.
import { api } from "@/lib/base";
import type { ScanSnapshot } from "./store";

const BEAT_MS = 10_000;

/** Make a preview image small enough to send (a data URL, max 1280px wide, JPEG). */
async function shrink(src: string | null): Promise<string | null> {
  if (!src || !src.startsWith("data:image")) return src;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = Math.min(1280, img.naturalWidth);
    const h = Math.round((img.naturalHeight / img.naturalWidth) * w);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.75);
  } catch {
    return null;
  }
}

/** What the results page needs, read back from where the scan page left it. */
export async function snapshotFromStorage(): Promise<ScanSnapshot | null> {
  try {
    const ls = localStorage, ss = sessionStorage;
    const results = JSON.parse(ls.getItem("scanResults") || "[]");
    const scanUrl = ls.getItem("scanUrl") || "";
    if (!Array.isArray(results) || !results.length || !scanUrl) return null;
    const get = (k: string) => ss.getItem(k) ?? ls.getItem(k);
    return {
      results, scanUrl,
      revenue: ls.getItem("scanRevenue") || "", aov: ls.getItem("scanAov") || "", cr: ls.getItem("scanCr") || "",
      locale: ls.getItem("scanLocale") || "en",
      pageChecks: Number(ls.getItem("scanPageChecks") || 0) || undefined,
      resolvedFrom: ls.getItem("scanResolvedFrom") || undefined, resolvedHow: ls.getItem("scanResolvedHow") || undefined,
      labId: ls.getItem("scanLabId"),
      previewDesktop: await shrink(get("scanPreviewDesktop") || ss.getItem("lastScreenshot")),
      previewMobile: await shrink(get("scanPreviewMobile")),
    };
  } catch {
    return null;
  }
}

export type ScanJobHandle = { done: () => Promise<void>; stop: () => void };

export function startScanJob(input: { scanId: string; email: string; url: string }): ScanJobHandle {
  let id: string | null = null;
  let timer = 0;
  let stopped = false;
  const ls = (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };

  const beat = () => { if (id && !stopped) fetch(api(`/scan/job/${id}/beat`), { method: "POST", keepalive: true }).catch(() => {}); };
  const leave = () => { if (id && !stopped) try { navigator.sendBeacon(api(`/scan/job/${id}/leave`), "1"); } catch { /* ignore */ } };
  const onVis = () => (document.visibilityState === "hidden" ? leave() : beat());

  const ready = fetch(api("/scan/job"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      locale: ls("scanLocale") || "en",
      answers: { revenue: ls("scanRevenue"), aov: ls("scanAov"), cr: ls("scanCr") },
      origin: window.location.origin,
    }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { id?: string } | null) => {
      if (!d?.id || stopped) return;
      id = d.id;
      try { localStorage.setItem("scanJobId", id); } catch { /* ignore */ }
      timer = window.setInterval(beat, BEAT_MS);
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("pagehide", leave);
    })
    .catch(() => {});

  const stop = () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", leave);
  };

  const done = async () => {
    await ready;
    if (!id) return stop();
    const jobId = id;
    stop();
    const snap = await snapshotFromStorage();
    if (!snap) return;
    await fetch(api(`/scan/job/${jobId}/done`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snap), keepalive: snap.previewDesktop ? false : true }).catch(() => {});
  };

  return { done, stop };
}
