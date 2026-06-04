import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use happy-dom for fast DOM simulation (30x faster than jsdom)
    environment: 'happy-dom',

    // Enable globals like describe, it, expect without imports
    globals: true,

    // Setup file to configure MSW and global test utilities
    setupFiles: ['./tests/setup.js'],

    // Test timeout (30 seconds)
    testTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      // Include all source JavaScript files
      include: [
        'public/**/*.js',
        'public/frontend.js',
        'public/enums.js',
        'public/skeleton.js',
        'public/script.js'
      ],
      exclude: [
        'tests/**',
        'node_modules/**',
        'public/dist/**',
        'public/sw.js', // Service worker
        'public/analytics.js', // Analytics
        'public/consent-banner.js', // Consent banner
        'public/asset-loader.js', // Asset loader
        'public/asset-loader-state.js', // Asset loader state
        'public/submit.js', // Form submission
        'public/html/**', // HTML directory
        'scripts/**',
        '*.config.js',
        '.netlify/**'
      ],
      // Set reasonable coverage thresholds
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0
      }
    },

    // Include test files
    include: ['tests/**/*.test.js', 'tests/**/*.spec.js'],

    // Exclude files
    exclude: [
      'node_modules/**',
      'public/dist/**',
      '.netlify/**'
    ]
  }
});
