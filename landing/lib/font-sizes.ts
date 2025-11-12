export const silkscreenSizes = {
  xs: 'text-xs font-silkscreen',    // 12px
  sm: 'text-sm font-silkscreen',    // 14px
  base: 'text-base font-silkscreen', // 16px
  lg: 'text-lg font-silkscreen',    // 18px
  xl: 'text-xl font-silkscreen',    // 20px
  '2xl': 'text-2xl font-silkscreen', // 24px
} as const

export type SilkscreenSize = keyof typeof silkscreenSizes
