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

  // Gradle ships conservative defaults meant for a machine it knows nothing
  // about. This one has twenty cores and 25 GB of RAM, and was using one
  // worker and a 2 GB heap.
  //
  // Parallel builds the independent modules at once — an Expo tree is
  // dozens of small sibling modules, which is close to the best case for it.
  'org.gradle.parallel': 'true',

  // The build cache reuses task outputs across builds, including after a
  // prebuild --clean wipes android/. Without it every clean rebuild
  // recompiles dependencies that never changed.
  'org.gradle.caching': 'true',

  // A 2 GB heap makes the compiler and the Hermes step spend their time in
  // garbage collection rather than work. Still leaves most of the machine
  // free — this is a ceiling, not a reservation.
  'org.gradle.jvmargs': '-Xmx6144m -XX:MaxMetaspaceSize=1024m',
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
