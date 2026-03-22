import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0A0A0A',
        card: '#111111',
        input: '#0D0D0D',
        border: {
          DEFAULT: '#222222',
          input: '#333333',
        },
        brand: {
          red: '#E02828',
          orange: '#F46E2C',
        },
        text: {
          primary: '#F7F6F5',
          muted: '#888888',
          subtle: '#444444',
        },
      },
      fontFamily: {
        sans: ['var(--font-montserrat)', 'Montserrat', 'sans-serif'],
      },
      borderColor: {
        DEFAULT: '#222222',
      },
    },
  },
  plugins: [],
}

export default config
