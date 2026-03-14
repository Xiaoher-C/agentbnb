/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hub: {
          bg: '#0f172a',        // slate-900
          surface: '#1e293b',   // slate-800
          border: '#334155',    // slate-700
          muted: '#64748b',     // slate-500
          text: '#f1f5f9',      // slate-100
          accent: '#6366f1',    // indigo-500
          'accent-hover': '#4f46e5', // indigo-600
          online: '#10b981',    // emerald-500
          offline: '#f43f5e',   // rose-500
        },
      },
    },
  },
  plugins: [],
};
