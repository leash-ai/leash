/**
 * The mark, from logo/ in the repo.
 *
 * It had been sitting there unused since June while every header rendered the
 * word LEASH in the body font. The icon ships with an opaque #131417 plate
 * behind it, which is a grey square on a black page — public/ holds a copy with
 * that removed so it takes the colour of whatever it sits on.
 */
export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/Leash_logo_icon.svg" alt="" aria-hidden className={className} />
  );
}

/** Mark plus name, for the top-left of a page. */
export function Wordmark({ subdued = false }: { subdued?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo className="h-7 w-7" />
      <span
        className={`text-lg font-bold tracking-[0.2em] ${subdued ? "text-ink-dim" : "text-white"}`}
      >
        LEASH
      </span>
    </span>
  );
}
