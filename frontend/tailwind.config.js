/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
        /*
         * Navy-leaning blue. Lively mid-tones keep buttons/links from looking
         * dull, deep-navy 700-950 anchor the header + dark mode. Deeper + a touch
         * less saturated than Tailwind's default blue, so it's easier on the eyes
         * across light/dark and reads professional. (Blue is also the most
         * color-blind-safe primary — off the red-green axis.)
         */
        brand: {
          50: "#eff4ff",
          100: "#dbe6fe",
          200: "#c0d3fd",
          300: "#94b3f9",
          400: "#5f87f2",
          500: "#3a61e6",
          600: "#2849cf",
          700: "#2139ab",
          800: "#1f3288",
          900: "#1d2d6b",
          950: "#141d42",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06)",
      },
    },
  },
  plugins: [],
};
