import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './mobile/index.html', './src/**/*.{ts,tsx}', '!./src/tests/**'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'rgb(var(--lh-brand-50) / <alpha-value>)',
          100: 'rgb(var(--lh-brand-100) / <alpha-value>)',
          200: 'rgb(var(--lh-brand-200) / <alpha-value>)',
          300: 'rgb(var(--lh-brand-300) / <alpha-value>)',
          400: 'rgb(var(--lh-brand-400) / <alpha-value>)',
          500: 'rgb(var(--lh-brand-500) / <alpha-value>)',
          600: 'rgb(var(--lh-brand-600) / <alpha-value>)',
          700: 'rgb(var(--lh-brand-700) / <alpha-value>)',
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
        glow: '0 0 0 1px rgb(var(--lh-brand-500) / 0.38), 0 8px 24px -8px rgb(var(--lh-brand-500) / 0.45)',
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
