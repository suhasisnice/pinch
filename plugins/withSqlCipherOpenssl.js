const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * SQLCipher needs OpenSSL's libcrypto.so at runtime, and nothing packaged it.
 *
 * expo-sqlite (useSQLCipher) links libexpo-sqlite.so against libcrypto.so but
 * takes the OpenSSL AAR as `compileOnly`, and that AAR carries the library
 * only as a prefab (headers + libs for native builds), never as jniLibs. So
 * 0.9.17's first build loaded fine on a desktop but on the phone
 * System.loadLibrary("expo-sqlite") failed and every database open threw
 * "NoClassDefFoundError: expo.modules.sqlite.NativeDatabaseBinding".
 *
 * This copies libcrypto.so for each ABI out of the prefab into a generated
 * jniLibs folder before the build. Keep the version in step with
 * node_modules/expo-sqlite/android/build.gradle.
 */
const OPENSSL = 'io.github.ronickg:openssl:3.3.2-1@aar';
const MARKER = '// pinch: sqlcipher libcrypto';

const GRADLE = `
${MARKER} (plugins/withSqlCipherOpenssl.js)
configurations { sqlcipherOpenssl }
dependencies { sqlcipherOpenssl '${OPENSSL}' }
def opensslJniDir = new File(buildDir, 'generated/opensslJniLibs')
tasks.register('extractSqlcipherCrypto', Copy) {
    from({ zipTree(configurations.sqlcipherOpenssl.singleFile) }) {
        include 'prefab/modules/crypto/libs/*/libcrypto.so'
        eachFile { details ->
            def abi = details.relativePath.segments[4].replace('android.', '')
            details.relativePath = new RelativePath(true, abi, 'libcrypto.so')
        }
    }
    includeEmptyDirs = false
    into opensslJniDir
}
android.sourceSets.main.jniLibs.srcDirs += opensslJniDir
preBuild.dependsOn 'extractSqlcipherCrypto'
`;

module.exports = function withSqlCipherOpenssl(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += GRADLE;
    }
    return cfg;
  });
};
