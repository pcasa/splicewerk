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
        card: '#161616',
        input: '#111111',
        border: {
          DEFAULT: '#2A2A2A',
          input: '#3A3A3A',
        },
        brand: {
          red: '#E02828',
          orange: '#F46E2C',
        },
        text: {
          primary: '#F4F4F5',
          muted: '#A1A1AA',
          subtle: '#71717A',
        },
      },
      fontFamily: {
        sans: ['var(--font-montserrat)', 'Montserrat', 'sans-serif'],
      },
      borderColor: {
        DEFAULT: '#2A2A2A',
      },
    },
  },
  plugins: [],
}

export default config
