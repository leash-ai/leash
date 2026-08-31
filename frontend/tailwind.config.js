/**
 * Motorsport live timing, not a crypto dashboard.
 *
 * A duel is two entrants, one clock, a gap and a leader — which is a race, and
 * races already have a visual language far older and more precise than anything
 * in trading UI. Trackside timing screens encode meaning in colour rather than
 * decorating with it: purple is the outright best of the session, green is a
 * personal best, yellow is losing time. Those are the names below.
 *
 * The palette this replaces was #000 with a single acid green — which is what
 * every generated crypto front looks like, and the reason this one read as
 * templated. Asphalt is a blue-grey, never pure black; the two entrants get
 * livery colours that are equals, and no accent is doing double duty as both
 * "brand" and "winning".
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        track: {
          DEFAULT: "#0B0D10",   // asphalt
          soft: "#12151A",      // panel
          line: "#1F242C",      // painted line
          edge: "#2A313B",      // kerb
        },
        ink: {
          DEFAULT: "#E8EAF0",
          dim: "#9AA2B1",
          faint: "#5C6472",
        },
        // Timing semantics. Purple outranks green outranks yellow, as on a
        // trackside screen — the reader already knows this order.
        best: "#B79CFF",        // session best — the leader
        gain: "#3DDC97",        // improving on itself
        lose: "#F2B441",        // losing time
        // Liveries. Two entrants, equal weight, distinguishable at a glance and
        // at any size — neither is the brand colour.
        lane: {
          a: "#22D3EE",
          b: "#F472B6",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        board: "0.18em",        // the spacing of a timing board header
      },
    },
  },
  plugins: [],
};
