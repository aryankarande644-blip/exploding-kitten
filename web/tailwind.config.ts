import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Fredoka', 'cursive', 'sans-serif'],
        handwriting: ['Caveat', 'cursive'],
      },
      colors: {
        'game-bg': '#190a0f',
        'table-edge': '#2b0c16',
        'table-surface': '#521422',
        'card-nope': '#e2253c',
        'card-attack': '#f69e25',
        'card-future': '#9648d8',
        'card-shuffle': '#147bf0',
        'card-defuse': '#10a352',
        'card-cat': '#e03a67',
      },
      boxShadow: {
        'table-inner':
          'inset 0 0 100px 30px rgba(10, 2, 5, 0.85), inset 0 20px 40px rgba(255, 120, 100, 0.15)',
        card: '0 8px 16px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0,0,0,0.2)',
        'card-hover': '0 14px 28px rgba(0, 0, 0, 0.6), 0 0 15px rgba(255, 255, 255, 0.2)',
      },
    },
  },
  plugins: [],
};
export default config;