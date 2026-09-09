const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Build-speed settings that must survive `expo prebuild --clean`.
 *
 * android/gradle.properties is regenerated from scratch by prebuild, so
 * editing it by hand lasts exactly until the next native rebuild. These are
 * reapplied as part of prebuild instead.
 *
 * The architecture list is the big one. React Native ships compiled native
 * libraries per CPU architecture, and the default builds all four — but a
 * phone only ever loads one. Every modern Android device is arm64-v8a, so the
 * other three are pure cost: roughly three quarters of the native build work,
 * and about two thirds of the APK size.
 *
 * If an APK ever refuses to install on some older device, restore the full
 * list here: armeabi-v7a,arm64-v8a,x86,x86_64
 */
const PROPERTIES = {
  reactNativeArchitectures: 'arm64-v8a',

  // Jetifier rewrites legacy support-library bytecode across every
  // dependency on every build. Nothing in an Expo 51 tree needs it.
  'android.enableJetifier': 'false',

  // Re-encoding PNGs saves a few KB and costs seconds on every build.
  'android.enablePngCrunchInReleaseBuilds': 'false',
};

module.exports = function withGradleTuning(config) {
  return withGradleProperties(config, (config) => {
    for (const [key, value] of Object.entries(PROPERTIES)) {
      const existing = config.modResults.find(
        (item) => item.type === 'property' && item.key === key
      );
      if (existing) {
        existing.value = value;
      } else {
        config.modResults.push({ type: 'property', key, value });
      }
    }
    return config;
  });
};
