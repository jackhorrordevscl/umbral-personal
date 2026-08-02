/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"DM Serif Display"', 'serif'],
        sans: ['"DM Sans"', 'sans-serif'],
      },
      colors: {
        slate: {
          950: '#0a0f1e',
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
        },
        sage: {
          50:  '#f2f7f4',
          100: '#e0ede6',
          200: '#c1dbc9',
          300: '#94c2a4',
          400: '#5fa37a',
          500: '#3d8560',
          600: '#2d6b4c',
          700: '#25573e',
        },
        cream: {
          50:  '#fdfcf8',
          100: '#faf8f0',
          200: '#f5f0e4',
        }
      },
    },
  },
  plugins: [],
}