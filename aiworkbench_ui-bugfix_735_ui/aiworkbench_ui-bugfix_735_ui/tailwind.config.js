/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        display: ['"DM Sans"', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        navy: {
          50: '#f4f6fb',
          100: '#e8ecf7',
          200: '#c5cfe8',
          300: '#8fa0cc',
          400: '#5b6fad',
          500: '#3a4f94',
          600: '#18246C',
          700: '#141d5a',
          800: '#0f1748',
          900: '#0B0F4F',
          950: '#070a33',
        },
        'depth-blue': '#0A2D72',
        cyan: {
          400: '#5ADAF0',
          500: '#13C7E8',
          600: '#0BA8C7',
        },
        surface: {
          DEFAULT: 'var(--wb-surface)',
          muted: 'var(--wb-surface-muted)',
          elevated: 'var(--wb-surface-elevated)',
        },
        ink: {
          DEFAULT: 'var(--wb-ink)',
          muted: 'var(--wb-ink-muted)',
          subtle: 'var(--wb-ink-subtle)',
        },
        line: 'var(--wb-line)',
        accent: 'var(--wb-accent)',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(11, 15, 79, 0.04), 0 8px 24px rgba(11, 15, 79, 0.06)',
        'panel-dark': '0 1px 2px rgba(0, 0, 0, 0.2), 0 8px 28px rgba(0, 0, 0, 0.28)',
      },
      backgroundImage: {
        'app-mesh':
          'radial-gradient(ellipse 80% 50% at 10% -10%, rgba(19, 199, 232, 0.12), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(24, 36, 108, 0.1), transparent 50%)',
        'app-mesh-dark':
          'radial-gradient(ellipse 80% 50% at 10% -10%, rgba(19, 199, 232, 0.08), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(24, 36, 108, 0.35), transparent 50%)',
      },
    },
  },
  plugins: [],
};
