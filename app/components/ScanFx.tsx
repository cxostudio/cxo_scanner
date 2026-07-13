'use client';

import { motion } from 'framer-motion';

/** One rolling digit column (0-9), translated to show the current digit. */
function Digit({ value }: { value: number }) {
  return (
    <span
      className="relative inline-block overflow-hidden align-baseline"
      style={{ height: '1em', width: '0.62em', lineHeight: 1 }}
    >
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col items-center"
        animate={{ y: `-${value}em` }}
        transition={{ type: 'spring', stiffness: 260, damping: 26, mass: 0.6 }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span
            key={n}
            className="flex items-center justify-center"
            style={{ height: '1em', lineHeight: 1 }}
          >
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/** Slot-machine style percentage. Value clamped 0-100; renders each digit as a rolling column. */
export function Odometer({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const digits = String(clamped).split('');
  return (
    <span className="inline-flex items-baseline tabular-nums">
      {digits.map((d, i) => (
        // key by position-from-right so digit columns stay stable as the count grows (1 -> 2 -> 3 chars)
        <Digit key={digits.length - i} value={Number(d)} />
      ))}
      <span>%</span>
    </span>
  );
}

/** Small monochrome radar dish with a rotating sweep + a couple of static blips. */
export function RadarSweep({ reduce = false }: { reduce?: boolean }) {
  return (
    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-gray-300 bg-gray-100 ring-1 ring-black/[0.03]">
      <span className="absolute inset-[3px] rounded-full border border-gray-200" />
      <span className="absolute inset-[9px] rounded-full border border-gray-200" />
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gray-200" />
      <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-gray-200" />
      {!reduce && (
        <span
          className="radar-sweep absolute inset-0"
          style={{
            background:
              'conic-gradient(from 0deg, rgba(75,85,99,0.5), rgba(75,85,99,0.12) 55deg, transparent 90deg)',
          }}
        />
      )}
      <span className="absolute h-1 w-1 rounded-full bg-gray-600" style={{ top: '30%', left: '58%' }} />
      <span className="absolute h-1 w-1 rounded-full bg-gray-400" style={{ top: '62%', left: '36%' }} />
    </div>
  );
}
