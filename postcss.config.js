export default {
  plugins: {
    // Only apply optimizations in production
    ...(process.env.NODE_ENV === 'production' && {
      cssnano: {
        preset: ['default', {
          discardComments: {
            removeAll: true,
          },
          normalizeWhitespace: true,
          mergeRules: true,
          uniqueSelectors: true,
          minifySelectors: true,
        }],
      },
    }),
  },
};