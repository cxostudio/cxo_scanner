'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { MiniDualViewportCard } from './MiniDualViewportCard';

type Props = {
  quadrants: string[];
  quadrantLabels: string[];
  previewDesktop?: string | null;
  previewMobile?: string | null;
};

const ENTER_MS = 600;
const SCAN_MS = 2800;
const SETTLE_MS = 700;

const easeSmooth = [0.22, 1, 0.36, 1] as const;

/** Left = completed thumbs; right = active scan; pending enters bottom → up; “In progress” above active card */
export function QuadrantScanSequence({
  quadrants,
  quadrantLabels,
  previewDesktop,
  previewMobile,
}: Props) {
  const [rowStack, setRowStack] = useState<{ src: string; label: string; key: number }[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'enter' | 'scan' | 'settle'>('idle');
  const runIdRef = useRef(0);

  useEffect(() => {
    if (quadrants.length === 0) return;

    const runId = ++runIdRef.current;
    setRowStack([]);
    setActiveIndex(null);
    setPhase('idle');
    let cancelled = false;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    (async () => {
      for (let i = 0; i < quadrants.length; i++) {
        if (cancelled || runId !== runIdRef.current) return;

        setActiveIndex(i);
        setPhase('enter');
        await wait(ENTER_MS);

        if (cancelled || runId !== runIdRef.current) return;
        setPhase('scan');
        await wait(SCAN_MS);

        if (cancelled || runId !== runIdRef.current) return;
        setPhase('settle');
        await wait(SETTLE_MS);

        if (cancelled || runId !== runIdRef.current) return;

        setRowStack((prev) => [
          ...prev,
          {
            src: quadrants[i],
            label: quadrantLabels[i] ?? `Part ${i + 1}`,
            key: i,
          },
        ]);

        if (i === quadrants.length - 1) {
          setActiveIndex(null);
          setPhase('idle');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quadrants, quadrantLabels]);

  const label = (i: number) => quadrantLabels[i] ?? `Part ${i + 1}`;
  const currentSrc = activeIndex !== null ? quadrants[activeIndex] : null;

  return (
    <LayoutGroup>
      <div className="mx-auto flex w-full max-w-full min-w-0 flex-col gap-4 px-0">
        {/* Single horizontal line: no wrap — scroll on small viewports (scrollbar hidden) */}
        <div className="scrollbar-auto sm:scrollbar-none flex w-full min-w-0 flex-nowrap items-end justify-start gap-2 overflow-x-auto md:overflow-x-visible sm:gap-3">
          <motion.div
            layout
            className="flex min-h-[120px] mt-[50px] shrink-0 flex-row flex-nowrap items-end justify-start gap-2 overflow-y-hidden"
          >
            {previewDesktop && (
              <MiniDualViewportCard previewDesktop={previewDesktop} previewMobile={previewMobile} />
            )}
            <AnimatePresence initial={false}>
              {rowStack.map((item) => (
                <motion.figure
                  key={item.key}
                  layout
                  initial={{ opacity: 0, scale: 0.45, y: 24 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0,
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 380,
                    damping: 26,
                    mass: 0.55,
                  }}
                  className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-zinc-200/90 bg-white shadow-md ring-1 ring-black/5 sm:h-32 sm:w-32"
                  title={item.label}
                >
                  <figcaption className="absolute left-0 right-0 top-0 z-10 truncate bg-black/55 px-1 py-0.5 text-center text-[8px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 sm:text-[9px]">
                    {item.label}
                  </figcaption>
                  <img
                    src={item.src}
                    alt=""
                    className="h-full w-full object-cover object-top"
                  />
                </motion.figure>
              ))}
            </AnimatePresence>
          </motion.div>

          {/* Only mount while scanning — empty w-48/w-72 was stealing space and left-aligning the 4 thumbs */}
          {currentSrc !== null && activeIndex !== null && (
            <div className="flex w-20 shrink-0 flex-col items-stretch sm:w-32">
              <p className="mb-2 w-full text-center text-[11px] font-semibold uppercase tracking-wide text-violet-600 sm:text-xs">
                In progress
              </p>
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeIndex}
                  layout
                  className="relative w-full overflow-hidden rounded-lg border border-violet-400/45 bg-white shadow-md ring-1 ring-violet-300/25"
                  initial={{ y: 110, opacity: 0, scale: 0.88 }}
                  animate={
                    phase === 'settle'
                      ? {
                          x: -112,
                          y: 0,
                          scale: 0.42,
                          opacity: 0,
                          filter: 'blur(2px)',
                          transition: {
                            duration: SETTLE_MS / 1000,
                            ease: easeSmooth,
                          },
                        }
                      : {
                          x: 0,
                          y: 0,
                          scale: 1,
                          opacity: 1,
                          filter: 'blur(0px)',
                          transition:
                            phase === 'enter'
                              ? {
                                  type: 'spring',
                                  stiffness: 280,
                                  damping: 28,
                                  mass: 0.75,
                                }
                              : { duration: 0.2 },
                        }
                  }
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  <div className="border-b border-zinc-100 bg-zinc-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 sm:text-[11px]">
                    {label(activeIndex)}
                  </div>
                  <div className="relative aspect-square w-full">
                    <img
                      src={currentSrc}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover object-top"
                    />
                    {phase === 'scan' && (
                      <div className="pointer-events-none absolute inset-0" aria-hidden>
                        <div className="absolute inset-0 bg-violet-600/25" />
                        <div
                          className="absolute inset-0 opacity-35"
                          style={{
                            backgroundImage:
                              'linear-gradient(rgba(139, 92, 246, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 92, 246, 0.4) 1px, transparent 1px)',
                            backgroundSize: '18px 18px',
                          }}
                        />
                        <motion.div
                          className="absolute left-0 right-0 z-10 h-[2px] rounded-full bg-violet-400 shadow-[0_0_20px_rgba(167,139,250,0.95)]"
                          initial={{ top: 0 }}
                          animate={{ top: 'calc(100% - 2px)' }}
                          transition={{
                            duration: SCAN_MS / 1000,
                            ease: 'linear',
                          }}
                        />
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>

      </div>
    </LayoutGroup>
  );
}
