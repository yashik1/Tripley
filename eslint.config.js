// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'supabase/functions/*', 'tests/e2e/*', 'public/maplibre-gl-worker.mjs'],
  },
  {
    // Node-only CommonJS scripts (web server, migrations).
    files: ['scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // The web app's service worker.
    files: ['public/sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
]);
