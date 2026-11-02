/** Original EchoSentinel mark: a shield outline holding a five-bar waveform. */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="EchoSentinel">
      <defs>
        <linearGradient id="es-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFC94D" />
          <stop offset="1" stopColor="#FFB300" />
        </linearGradient>
      </defs>
      <path d="M32 6 54 14.5v16C54 44 45 54 32 58 19 54 10 44 10 30.5v-16z" fill="rgba(255,179,0,0.08)" stroke="url(#es-g)" strokeWidth="3.5" strokeLinejoin="round" />
      <g stroke="url(#es-g)" strokeWidth="3.6" strokeLinecap="round">
        <path d="M21 30v6" />
        <path d="M26.5 24v18" />
        <path d="M32 18v30" />
        <path d="M37.5 24v18" />
        <path d="M43 30v6" />
      </g>
    </svg>
  );
}

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <LogoMark className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[17px] font-bold sm:text-[19px] tracking-tight text-bone">
          Echo<span className="text-amber">Sentinel</span>
        </div>
        {!compact && <div className="hidden truncate text-[11.5px] text-bone-muted sm:block">Audio Surveillance • AI Recognition • Transcription</div>}
      </div>
    </div>
  );
}
