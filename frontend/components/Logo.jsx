// AdPulse logo — pure SVG/CSS, no external images.

export default function Logo({ dark = false, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#2a78d6] to-violet-600 shadow-sm">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="2 12 6 12 9 5 15 19 18 12 22 12" />
        </svg>
      </span>
      <span className={`text-lg font-bold tracking-tight ${dark ? "text-white" : "text-gray-900"}`}>
        AdPulse
      </span>
    </span>
  );
}
