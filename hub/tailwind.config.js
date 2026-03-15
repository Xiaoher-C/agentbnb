/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hub: {
          bg: '#08080C',
          surface: 'rgba(255, 255, 255, 0.03)',
          'surface-hover': 'rgba(255, 255, 255, 0.06)',
          border: 'rgba(255, 255, 255, 0.06)',
          'border-hover': 'rgba(255, 255, 255, 0.12)',
          accent: '#10B981',
          'accent-glow': 'rgba(16, 185, 129, 0.4)',
          'text-primary': 'rgba(255, 255, 255, 0.92)',
          'text-secondary': 'rgba(255, 255, 255, 0.55)',
          'text-tertiary': 'rgba(255, 255, 255, 0.30)',
          'text-muted': 'rgba(255, 255, 255, 0.40)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '16px',
        modal: '20px',
      },
    },
  },
  plugins: [],
};
