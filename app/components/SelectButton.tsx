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
      onClick={() => onClick(value)}
      className={`w-full bg-white rounded-4xl  mt-[13px] text-center border h-[50px] cursor-pointer ${
        isSelected
          ? 'border-[#09090B] border-2'
          : 'border-[#E4E4E7]'
      }`}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'tween', duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
    >
      
      <p className="text-[#71717a] text-center font-inter font-normal leading-[28px] tracking-[0.02em]">
        {label}
      </p>
    </motion.button>
  )
}

