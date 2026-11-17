import type { Config } from 'tailwindcss';
import { foxbizTokens as tokens } from '../../packages/ui/src/tokens';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'fox-action': tokens.color.primaryHover,
        fox: { blue: tokens.color.primary, navy: tokens.color.navy, teal: tokens.color.teal, canvas: tokens.color.background, border: tokens.color.border, muted: tokens.color.muted, secondary: tokens.color.textSecondary, subtle: tokens.color.subtle, soft: tokens.color.primarySoft, success: tokens.color.success, warning: tokens.color.warning, danger: tokens.color.danger, info: tokens.color.info },
      },
      borderRadius: { card: '12px', panel: '16px' },
      boxShadow: tokens.shadow,
    },
  },
  plugins: [],
};
export default config;
