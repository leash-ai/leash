/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        green: { DEFAULT: "#00ff88" },
        red: { DEFAULT: "#ff3b3b" },
      },
    },
  },
  plugins: [],
};
