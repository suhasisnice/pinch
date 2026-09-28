const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Signs the Play bundle with a private upload key (0.9.22,
 * docs/PLAY_READINESS.md, "Signing key").
 *
 * The key and its passwords live outside the repo, in
 * ~/.pinch-keys/signing.properties (override with PINCH_SIGNING). They are
 * read at build time and never copied into android/.
 *
 * Only `npm run aab` (-PpinchUpload) uses it. `npm run apk` stays on the
 * template debug key on purpose: Android refuses to install an APK signed
 * with a different key over the one on the phone, so switching would mean
 * an uninstall, and uninstalling erases the encrypted database with its
 * Keystore key. The sideload build changes keys only once there is a
 * backup to restore from.
 */
const BLOCK = `
def pinchSigning = new Properties()
def pinchSigningFile = file(System.getenv('PINCH_SIGNING') ?: "\${System.getProperty('user.home')}/.pinch-keys/signing.properties")
def pinchUpload = project.hasProperty('pinchUpload')
if (pinchUpload) {
    if (!pinchSigningFile.exists()) {
        throw new GradleException("pinchUpload: no signing file at \${pinchSigningFile}")
    }
    pinchSigningFile.withInputStream { pinchSigning.load(it) }
}
`;

const UPLOAD_CONFIG = `        upload {
            if (pinchUpload) {
                storeFile file(pinchSigning['storeFile'])
                storePassword pinchSigning['storePassword']
                keyAlias pinchSigning['keyAlias']
                keyPassword pinchSigning['keyPassword']
            }
        }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes('pinchUpload')) return config;

    const android = /\nandroid \{\n/;
    const signing = /(\n\s*signingConfigs \{\n)/;
    const release = /(\n\s*release \{\n(?:\s*\/\/.*\n)*)(\s*)signingConfig signingConfigs\.debug\n/;
    if (!android.test(contents) || !signing.test(contents) || !release.test(contents)) {
      throw new Error('withReleaseSigning: app/build.gradle no longer has the expected shape');
    }

    contents = contents.replace(android, `\n${BLOCK}\nandroid {\n`);
    contents = contents.replace(signing, `$1${UPLOAD_CONFIG}`);
    contents = contents.replace(
      release,
      '$1$2signingConfig pinchUpload ? signingConfigs.upload : signingConfigs.debug\n'
    );

    config.modResults.contents = contents;
    return config;
  });
};
