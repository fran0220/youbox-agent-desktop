import origincoworksLogo from '@/assets/origincoworks_logo.svg'

interface OriginCoworksAppIconProps {
  className?: string
  size?: number
}

export function OriginCoworksAppIcon({ className, size = 64 }: OriginCoworksAppIconProps) {
  return (
    <img
      src={origincoworksLogo}
      alt="OriginAI"
      width={size}
      height={size}
      className={className}
    />
  )
}
