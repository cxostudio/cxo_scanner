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
    <button
      onClick={() => onClick(value)}
      className={`w-full bg-white rounded-4xl p-[18px] my-[13px] text-center border transition cursor-pointer ${
        isSelected
          ? 'border-black border-2'
          : 'border-[#E4E4E7]'
      }`}
    >
      <p className="text-sm font-semibold text-black">
        {label}
      </p>
    </button>
  )
}

