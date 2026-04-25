/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hub: {
          // Base
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

          // Surface tiers (same hue, luminance only — gives cards real depth)
          'surface-sunken': '#04040A',
          'surface-0': '#0D0D15',
          'surface-1': '#13131E',
          'surface-2': '#1A1A28',

          // Border tiers (hairline → hero)
          'border-hairline': 'rgba(255, 255, 255, 0.04)',
          'border-default': 'rgba(255, 255, 255, 0.08)',
          'border-emphasis': 'rgba(255, 255, 255, 0.14)',
          'border-hero': 'rgba(255, 255, 255, 0.24)',

          // Semantic tone anchors (shared with Skills Inspector chip palette)
          live: '#10B981',   // emerald — active / in-progress / credit / tracked
          pinned: '#0EA5E9', // sky — pinned / discussing / shortlisted-info
          team: '#8B5CF6',   // violet — team / proposal / forming / selected
          warn: '#F59E0B',   // amber — attention / untracked / review / stale
          danger: '#F43F5E', // rose — conflict / blocked / rejected
          mute: '#94A3B8',   // slate — completed-neutral / registered / paused
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
      keyframes: {
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(calc(-100% - var(--gap)))' },
        },
        'marquee-vertical': {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(calc(-100% - var(--gap)))' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        orbit: {
          '0%': {
            transform:
              'rotate(calc(var(--angle) * 1deg)) translateY(calc(var(--radius) * 1px)) rotate(calc(var(--angle) * -1deg))',
          },
          '100%': {
            transform:
              'rotate(calc(var(--angle) * 1deg + 360deg)) translateY(calc(var(--radius) * 1px)) rotate(calc((var(--angle) * -1deg) - 360deg))',
          },
        },
      },
      animation: {
        marquee: 'marquee var(--duration) infinite linear',
        'marquee-vertical': 'marquee-vertical var(--duration) linear infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        orbit: 'orbit calc(var(--duration) * 1s) linear infinite',

        // Hub motion system (compositor-friendly only)
        'hub-shimmer': 'hub-shimmer 5s linear infinite',
        'hub-pulse-dot': 'hub-pulse-dot 2s ease-in-out infinite',
        'hub-fade-up': 'hub-fade-up 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'hub-slide-in-right': 'hub-slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'hub-slide-in-left': 'hub-slide-in-left 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'hub-glow-breathe': 'hub-glow-breathe 3.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
