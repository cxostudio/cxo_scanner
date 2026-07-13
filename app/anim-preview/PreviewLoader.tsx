'use client';

import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';

export type InstantPreviewHint = {
  host: string;
  faviconUrl: string;
};

type DualViewportLoaderProps = {
  /** null = empty pane while URL capture is in flight */
  previewDesktop: string | null;
  /** null = empty mobile pane while URL capture is in flight */
  previewMobile?: string | null;
  /** Shown immediately (favicon + host) before the first streamed desktop screenshot arrives */
  instantPreview?: InstantPreviewHint | null;
  statusText?: string;
  scanning?: boolean;
  /** `start` = left-align mockups (analyze + progress layout); default centered */
  align?: 'center' | 'start';
  /** Opt-in bigger/brighter overlay FX (inspect boxes, spotlight, chips, ripple pings). Used by the preview sandbox. */
  loud?: boolean;
};

/** Faint monochrome "data rain" columns — deterministic content to avoid hydration mismatch. */
const RAIN_COLUMNS = [
  { left: '12%', dur: '2.6s', delay: '0s', text: '1\n0\n1\n1\n0\n1\n0\n0' },
  { left: '28%', dur: '3.4s', delay: '0.6s', text: '0\n1\n0\n0\n1\n1\n0\n1' },
  { left: '45%', dur: '2.2s', delay: '0.3s', text: '1\n1\n0\n1\n0\n0\n1\n0' },
  { left: '62%', dur: '3.0s', delay: '0.9s', text: '0\n0\n1\n0\n1\n0\n1\n1' },
  { left: '78%', dur: '2.8s', delay: '0.2s', text: '1\n0\n0\n1\n1\n0\n0\n1' },
  { left: '90%', dur: '3.6s', delay: '0.5s', text: '0\n1\n1\n0\n0\n1\n1\n0' },
] as const;

const PINGS = [
  { top: '18%', left: '26%' },
  { top: '34%', left: '68%' },
  { top: '52%', left: '40%' },
  { top: '70%', left: '62%' },
  { top: '82%', left: '30%' },
] as const;

const BRACKETS = [
  { pos: 'top-1.5 left-1.5', sides: ['t', 'l'] },
  { pos: 'top-1.5 right-1.5', sides: ['t', 'r'] },
  { pos: 'bottom-1.5 left-1.5', sides: ['b', 'l'] },
  { pos: 'bottom-1.5 right-1.5', sides: ['b', 'r'] },
] as const;

// Full border-side utilities for both widths so Tailwind keeps them (no dynamic class strings).
const BRACKET_BORDER: Record<string, { normal: string; loud: string }> = {
  t: { normal: 'border-t-2', loud: 'border-t-[3px]' },
  r: { normal: 'border-r-2', loud: 'border-r-[3px]' },
  b: { normal: 'border-b-2', loud: 'border-b-[3px]' },
  l: { normal: 'border-l-2', loud: 'border-l-[3px]' },
};

/** Cartoon magnifying glass (blue glass, dark rim + handle, glare) for the colourful preview scan. */
function MagnifierGlass() {
  return (
    <svg
      viewBox="0 0 64 64"
      className="h-full w-full drop-shadow-[0_2px_5px_rgba(0,0,0,0.28)]"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* handle (drawn first so the rim overlaps it) */}
      <line x1="40" y1="40" x2="57" y2="57" stroke="#0f172a" strokeWidth="9" strokeLinecap="round" />
      {/* glass — semi-transparent so it tints/magnifies what's underneath */}
      <circle cx="26" cy="26" r="20" fill="#dbeafe" fillOpacity="0.55" stroke="#0f172a" strokeWidth="5" />
      <circle cx="26" cy="26" r="15" fill="#ffffff" fillOpacity="0.22" />
      {/* glare */}
      <path d="M15 23 A15 15 0 0 1 26 13" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      <circle cx="18.5" cy="20" r="2.4" fill="#ffffff" opacity="0.85" />
    </svg>
  );
}

/** Scan overlay.
 *  `loud` = the simple, colourful preview look: a soft colour wash, one colour scan beam, and a roaming magnifier.
 *  Otherwise = the original monochrome overlay used by the live scanner (grid, data rain, pings, focus dot, brackets). */
function ScanOverlay({
  reduce,
  compact = false,
  loud = false,
}: {
  reduce: boolean;
  compact?: boolean;
  loud?: boolean;
}) {
  // ── Simple + colourful (preview / loud): colour wash + corner brackets + one colour scan beam + roaming magnifier. ──
  if (loud) {
    const mag = compact ? 'h-8 w-8' : 'h-10 w-10';
    return (
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        {/* soft colour wash */}
        <div className="absolute inset-0 bg-gradient-to-br from-sky-400/12 via-indigo-400/10 to-fuchsia-400/12" />

        {/* viewfinder corner brackets */}
        {BRACKETS.map((b, i) => {
          const borders = b.sides.map((s) => BRACKET_BORDER[s].loud).join(' ');
          return (
            <span
              key={i}
              className={`absolute h-6 w-6 border-cyan-300/90 ${b.pos} ${borders} ${
                reduce ? 'opacity-60' : 'viewfinder-pulse'
              }`}
              style={reduce ? undefined : { animationDelay: `${i * 0.15}s` }}
            />
          );
        })}

        {/* violet scan beam */}
        {reduce ? (
          <div className="absolute inset-x-0 top-1/2 h-[3px] bg-violet-500" />
        ) : (
          <div className="scan-sweep-gray absolute inset-x-0 h-[20%]">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-violet-400/25" />
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-violet-500 shadow-[0_0_22px_rgba(139,92,246,0.9)]" />
          </div>
        )}

        {/* roaming magnifying glass */}
        {!reduce && (
          <span className={`focus-roam absolute ${mag}`}>
            <MagnifierGlass />
          </span>
        )}
      </div>
    );
  }

  // ── Original monochrome overlay (live scanner) ──
  const dot = compact ? 12 : 14;
  const rainCols = compact ? RAIN_COLUMNS.slice(0, 3) : RAIN_COLUMNS;
  const pings = compact ? PINGS.slice(0, 3) : PINGS;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {/* dotted grid */}
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(82,82,91,0.4) 1px, transparent 1px)',
          backgroundSize: `${dot}px ${dot}px`,
        }}
      />
      {/* grid lines (subtle flicker) */}
      <div
        className={`absolute inset-0 ${reduce ? 'opacity-[0.16]' : 'grid-flicker'}`}
        style={{
          backgroundImage:
            'linear-gradient(rgba(82,82,91,0.32) 1px, transparent 1px), linear-gradient(90deg, rgba(82,82,91,0.32) 1px, transparent 1px)',
          backgroundSize: `${dot * 2}px ${dot * 2}px`,
        }}
      />
      {/* base tint */}
      <div className="absolute inset-0 bg-zinc-600/12" />

      {/* data rain */}
      {!reduce &&
        rainCols.map((c, i) => (
          <div
            key={i}
            className="data-rain-col absolute top-0 whitespace-pre text-center font-mono text-[8px] leading-[1.15] text-zinc-500/40"
            style={{ left: c.left, animationDuration: c.dur, animationDelay: c.delay }}
          >
            {c.text}
          </div>
        ))}

      {/* scan reveal sweep: brightening trail with a leading line */}
      {reduce ? (
        <div className="absolute inset-x-0 top-1/2 h-[2px] bg-zinc-400/80" />
      ) : (
        <div className="scan-sweep-gray absolute inset-x-0 h-[14%]">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/25" />
          <div className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-zinc-50 shadow-[0_0_18px_rgba(228,228,231,0.9),0_0_6px_rgba(113,113,122,0.9)]" />
        </div>
      )}

      {/* laser "finds things" pings — flash as the sweep passes their row */}
      {!reduce &&
        pings.map((p, i) => (
          <span
            key={i}
            className="scan-ping absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_2px_rgba(212,212,216,0.9)]"
            style={{ top: p.top, left: p.left, animationDelay: `${(parseFloat(p.top) / 100) * 2.6}s` }}
          />
        ))}

      {/* roaming focus dot */}
      {!reduce && (
        <span className="focus-roam absolute h-3 w-3 rounded-full border border-zinc-300/80 bg-zinc-200/30 shadow-[0_0_10px_rgba(228,228,231,0.7)]" />
      )}

      {/* viewfinder brackets */}
      {BRACKETS.map((b, i) => {
        const borders = b.sides.map((s) => BRACKET_BORDER[s].normal).join(' ');
        return (
          <span
            key={i}
            className={`absolute h-4 w-4 border-zinc-100 ${b.pos} ${borders} ${
              reduce ? 'opacity-60' : 'viewfinder-pulse'
            }`}
            style={reduce ? undefined : { animationDelay: `${i * 0.15}s` }}
          />
        );
      })}
    </div>
  );
}

/** Desktop-only browser mockup with optional UX-Ray scan overlay on the viewport. */
function InstantSitePlaceholder({ hint }: { hint: InstantPreviewHint }) {
  return (
    <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-zinc-50/95 via-zinc-100/95 to-zinc-200/95 px-4">
      <img
        src={hint.faviconUrl}
        alt=""
        width={56}
        height={56}
        className="h-14 w-14 rounded-xl border border-zinc-200/80 bg-white object-contain p-1.5 shadow-sm"
      />
      <p className="max-w-[90%] truncate text-center text-xs font-semibold text-zinc-700 sm:text-sm">
        {hint.host}
      </p>
      <p className="text-center text-[0.65rem] font-medium text-zinc-500 sm:text-xs">Loading preview…</p>
    </div>
  );
}

export function PreviewLoader({
  previewDesktop,
  previewMobile = null,
  instantPreview = null,
  statusText = 'Capturing page screenshots',
  scanning = true,
  align = 'center',
  loud = false,
}: DualViewportLoaderProps) {
  const reduce = useReducedMotion() ?? false;
  const desktopReady = previewDesktop != null && previewDesktop.length > 0;
  const mobileReady = previewMobile != null && previewMobile.length > 0;
  const mobileSrc = mobileReady ? previewMobile! : desktopReady ? previewDesktop! : null;
  const instant = instantPreview ?? null;
  const showInstantDesktop = !desktopReady && instant != null;
  const showInstantMobile = !mobileSrc && instant != null;
  const isStart = align === 'start';

  // 3D tilt — mouse-driven, desktop only; disabled under reduced motion / when not scanning.
  const enableTilt = scanning && !reduce;
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [6, -6]), { stiffness: 150, damping: 18 });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-8, 8]), { stiffness: 150, damping: 18 });

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!enableTilt || !sceneRef.current) return;
    const r = sceneRef.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  const handleLeave = () => {
    px.set(0);
    py.set(0);
  };

  const scene = (
    <div className="relative mx-auto w-full h-full md:h-auto min-h-[406px] mobile-set-height flex items-center md:items-start">
      <div className="relative z-0 w-full max-w-[min(100%,40rem)] shrink-0 lg:min-w-0 sm:pe-[60px] lg:pe-0 shadow-[0_32px_90px_-22px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.04] rounded-[1.8rem] overflow-hidden h-full">
        <div className="flex h-10 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" aria-hidden />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden />
        </div>
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-100">
          {desktopReady ? (
            <img
              src={previewDesktop!}
              alt=""
              className="absolute inset-0 z-0 h-full w-full object-cover object-top"
            />
          ) : (
            <div
              className="absolute inset-0 z-0 bg-gradient-to-b from-zinc-50 via-zinc-100 to-zinc-200"
              aria-hidden
            />
          )}
          {showInstantDesktop && instant ? <InstantSitePlaceholder hint={instant} /> : null}
          {scanning && <ScanOverlay reduce={reduce} loud={loud} />}
        </div>
      </div>

      <div className="w-full max-w-[200px] sm:max-w-[190px] md:max-w-[216px] lg:max-w-[14.2rem] self-center absolute right-0 top-0 sm:z-30 sm:mt-0 mobile-view">
        <div className="rounded-[2.25rem] border border-zinc-200 bg-white p-2.5 shadow-none ring-1 ring-black/[0.05]">
          <div className="overflow-hidden rounded-[1.8rem] bg-white ring-1 ring-zinc-200/90">
            <div className="flex justify-center border-b border-zinc-100 bg-white px-3 pb-2 pt-3">
              <div className="h-[1.15rem] w-[4.25rem] rounded-full bg-zinc-900" aria-hidden />
            </div>
            <div className="relative mx-2 aspect-[9/17.5] overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-100">
              {mobileSrc ? (
                <img
                  src={mobileSrc}
                  alt=""
                  className="absolute inset-0 z-0 h-full w-full object-cover object-top"
                />
              ) : (
                <div
                  className="absolute inset-0 z-0 bg-gradient-to-b from-zinc-50 via-zinc-100 to-zinc-200"
                  aria-hidden
                />
              )}
              {showInstantMobile && instant ? <InstantSitePlaceholder hint={instant} /> : null}
              {scanning && <ScanOverlay reduce={reduce} compact loud={loud} />}
            </div>
            <div className="bg-white px-2 pb-2.5 pt-1.5 text-center">
              <p className="text-[0.7rem] font-bold leading-tight text-zinc-900 sm:text-xs">
                Mobile view
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={
        isStart
          ? 'w-full max-w-none px-0 sm:pr-2'
          : 'mx-auto w-full max-w-5xl px-3 sm:px-4'
      }
    >
      <div
        className={`relative mx-auto flex w-full pb-0 ${isStart ? 'mx-0 pt-0 sm:pb-0' : 'pt-2 sm:pb-8'}`}
      >
        <div
          className="pointer-events-none absolute inset-x-3 inset-y-2 -z-10 rounded-[2.2rem] bg-gradient-to-br from-zinc-200/70 via-zinc-100/45 to-white/20 blur-2xl sm:inset-x-6"
          aria-hidden
        />

        {/* Tilt wrapper (outer) + breathing (inner) so the two transforms compose instead of clobbering. */}
        <div
          ref={sceneRef}
          className="w-full"
          style={enableTilt ? { perspective: 1000 } : undefined}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        >
          {enableTilt ? (
            <motion.div style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }} className="w-full">
              <div className="scene-breathe w-full">{scene}</div>
            </motion.div>
          ) : (
            scene
          )}
        </div>
      </div>

      {scanning && (
        <div
          className={`pointer-events-none mt-8 flex sm:max-w-md ${isStart ? 'mx-0 justify-center sm:justify-start' : 'mx-auto justify-center'}`}
        >
          <div className="flex max-w-[min(100%-1rem,28rem)] items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur-sm">
            <span
              className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-zinc-300 shadow-[0_0_12px_rgba(212,212,216,0.9)]"
              aria-hidden
            />
            <span className="truncate font-medium tracking-tight">{statusText}</span>
          </div>
        </div>
      )}
    </div>
  );
}
