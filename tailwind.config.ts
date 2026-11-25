import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}', '!./src/tests/**'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        surface: {
          canvas: '#070b14',
          card: '#0e1526',
          elevated: '#141d33',
          hover: '#1b2742',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -12px rgba(15, 23, 42, 0.12)',
        'card-dark':
          '0 1px 0 0 rgba(255, 255, 255, 0.04) inset, 0 12px 32px -16px rgba(0, 0, 0, 0.65)',
        glow: '0 0 0 1px rgba(99, 102, 241, 0.35), 0 8px 24px -8px rgba(99, 102, 241, 0.4)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'scale-in': 'scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
