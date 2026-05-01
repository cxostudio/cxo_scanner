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
      data-selected={isSelected ? 'true' : 'false'}
      onClick={() => onClick(value)}
      className="cxo-select-option w-full bg-white rounded-4xl mt-[13px] text-center border border-[#E4E4E7] h-[50px] cursor-pointer"
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'tween', duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <p
        className={`text-center font-inter font-normal leading-[28px] tracking-[0.02em] ${
          isSelected ? 'text-[#09090b] font-semibold' : 'text-[#71717a]'
        }`}
      >
        {label}
      </p>
    </motion.button>
  )
}

