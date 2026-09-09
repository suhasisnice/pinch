const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Ships native libraries for one CPU architecture instead of four.
 *
 * `reactNativeArchitectures` in gradle.properties is not enough on its own —
 * it only controls what React Native *compiles*. Everything else with native
 * code (Hermes, expo-sqlite, the Fabric JNI layer) ships prebuilt .so files
 * for every architecture, and the packaging step happily includes all of
 * them. The result was a 70 MB APK of which roughly half could never execute
 * on the target phone.
 *
 * abiFilters is what the packaging step actually reads.
 *
 * arm64-v8a covers every Android phone made in roughly the last decade. If an
 * APK ever refuses to install on some older 32-bit device, add
 * 'armeabi-v7a' to the list here.
 */
const ABIS = ["'arm64-v8a'"];

const NDK_BLOCK = `        ndk {
            abiFilters ${ABIS.join(', ')}
        }
`;

module.exports = function withAbiFilter(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes('abiFilters')) return config;

    // Anchor on applicationId: it is the first line inside defaultConfig and
    // is stable across React Native template versions.
    const anchor = /(\n\s*applicationId .*\n)/;
    if (!anchor.test(contents)) {
      throw new Error('withAbiFilter: could not find applicationId in app/build.gradle');
    }

    contents = contents.replace(anchor, `$1${NDK_BLOCK}`);

    // Debug symbol tables are for Play Console crash reports. A sideloaded
    // build has nowhere to send them, and generating them is slow.
    //
    // Anchored on a line unique to the release block: `debug { ... }` sits
    // between `buildTypes {` and `release {`, so anchoring on that brace pair
    // silently matches nothing and the setting is quietly never applied.
    contents = contents.replace(
      /(\n\s*minifyEnabled enableProguardInReleaseBuilds\n)/,
      "$1            ndk {\n                debugSymbolLevel 'none'\n            }\n"
    );

    config.modResults.contents = contents;
    return config;
  });
};
