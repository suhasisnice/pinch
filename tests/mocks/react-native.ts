/**
 * Test double for react-native.
 *
 * Like tests/mocks/expo-notifications.ts, this exists because the real
 * package ships Flow syntax that Jest's plain ts-jest transform never
 * understands — anything that imports it fails to parse, whether or not a
 * test ever touches a native API. Wired in via jest.config.js's
 * moduleNameMapper. Only what the services under test actually read is
 * stubbed; add to this as more of the app's service layer gets covered.
 */
export const Platform = { OS: 'android' as const };
