/** Herbarium palette: a pressed-specimen sheet. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sheet: '#E4E9DC',
        paper: '#F1F2E8',
        card: '#F7F6EE',
        rule: '#CBD3BE',
        mist: '#EBEEE2',
        moss: { DEFAULT: '#3E6B48', deep: '#2F5638' },
        fern: '#7FA36B',
        bark: '#8A6A4A',
        petal: { DEFAULT: '#A9566B', soft: '#C98FA0' },
        ink: { DEFAULT: '#24301F', soft: '#3E4A38', muted: '#55634D' },
        tape: 'rgba(214,204,160,.8)',
      },
      fontFamily: {
        display: ['"Young Serif"', 'Georgia', 'serif'],
        sans: ['Figtree', '"Segoe UI"', 'system-ui', 'sans-serif'],
        label: ['"Courier Prime"', '"Courier New"', 'monospace'],
      },
      borderRadius: {
        leaf: '30px 8px 30px 8px',
        'leaf-sm': '14px 4px 14px 4px',
        'leaf-md': '20px 6px 20px 6px',
      },
      boxShadow: {
        specimen: '0 12px 22px -14px rgba(40,60,30,.5)',
        lift: '0 18px 30px -16px rgba(40,60,30,.55)',
      },
    },
  },
  plugins: [],
};
