interface OriginCoworksSymbolProps {
  className?: string
}

/** OriginCoworks mark for onboarding, splash, and app chrome. */
export function OriginCoworksSymbol({ className }: OriginCoworksSymbolProps) {
  return (
    <svg
      viewBox="0 0 128 128"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="8" y="8" width="112" height="112" rx="28" fill="currentColor" opacity="0.12" />
      <path
        fill="currentColor"
        d="M64 28c-19.9 0-36 16.1-36 36s16.1 36 36 36c9.2 0 17.6-3.5 24-9.2V76H64c-6.6 0-12-5.4-12-12s5.4-12 12-12h24V40.8c-6.4-5.7-14.8-9.2-24-9.2z"
      />
    </svg>
  )
}
