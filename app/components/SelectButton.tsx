'use client'

import { motion } from 'framer-motion'

interface SelectButtonProps {
  label: string
  value: string
  selectedValue: string | null
  onClick: (value: string) => void
}

export default function SelectButton({
  label,
  value,
  selectedValue,
  onClick,
}: SelectButtonProps) {
  const isSelected = selectedValue === value

  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={() => onClick(value)}
      className={`w-full rounded-4xl mt-[13px] text-center border h-[50px] cursor-pointer transition-shadow duration-200 ease-out max-sm:transition-none ${
        isSelected
          ? 'border border-[#09090b] bg-linear-to-b from-white to-zinc-100/90 shadow-[0_3px_10px_-2px_rgba(0,0,0,0.08),inset_0_1px_0_0_rgba(255,255,255,0.95)]'
          : 'border border-[#E4E4E7] bg-white shadow-none'
      }`}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'tween', duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <p
        className={`text-center font-inter font-normal leading-[28px] tracking-[0.02em] ${
          isSelected ? 'text-[#09090b] font-medium' : 'text-[#71717a]'
        }`}
      >
        {label}
      </p>
    </motion.button>
  )
}

