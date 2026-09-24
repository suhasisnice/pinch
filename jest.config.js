/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  transform: {
    // The app's tsconfig targets the Metro bundler (module: preserve); Jest
    // runs plain CommonJS on Node, so tests compile with that instead.
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node10',
          customConditions: null,
          ignoreDeprecations: '6.0',
          noEmit: false,
        },
      },
    ],
  },
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts', '**/src/**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  moduleNameMapper: {
    // The real module imports expo-modules-core, which ships ESM-only JS
    // that fails to parse under Jest regardless of whether a test ever
    // exercises a native call. See modules/pinch-capture/__mocks__/index.ts.
    '(\\.\\./)+modules/pinch-capture$': '<rootDir>/modules/pinch-capture/__mocks__/index.ts',
    // Same problem, one level further down the import chain: services that
    // touch notifications pull this in too. See tests/mocks/expo-notifications.ts.
    '^expo-notifications$': '<rootDir>/tests/mocks/expo-notifications.ts',
    // react-native itself ships Flow syntax plain ts-jest cannot parse. See
    // tests/mocks/react-native.ts.
    '^react-native$': '<rootDir>/tests/mocks/react-native.ts',
    // Needs the native bridge, so every call threw under Jest. See
    // tests/mocks/async-storage.ts.
    '^@react-native-async-storage/async-storage$': '<rootDir>/tests/mocks/async-storage.ts',
  },
};
