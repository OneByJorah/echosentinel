/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0a0a09', 900: '#0a0a09', 850: '#0f100e', 800: '#141512', 750: '#191a17', 700: '#20211d', 600: '#2b2c27', 500: '#3a3b35' },
        bone: { DEFAULT: '#ecebe4', muted: '#a8a59b', dim: '#8a877e' },
        amber: { DEFAULT: '#FFB300', soft: '#ffc94d', deep: '#cc8f00', glow: 'rgba(255,179,0,0.18)' },
        ok: '#3ccf6e',
        bad: '#f2555a',
        warn: '#f5a524',
        speech: '#9b7bff',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.35)',
        live: '0 0 0 1px #FFB300, 0 0 24px rgba(255,179,0,0.22)',
      },
    },
  },
  plugins: [],
};
