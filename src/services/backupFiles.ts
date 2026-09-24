import {
  backupFileName,
  collectBackup,
  openBackup,
  restoreBackup,
  sealBackup,
} from './backupService';

/**
 * The phone side of backups: writing the sealed file and handing it to the
 * share sheet, and picking one back up. Kept apart from backupService so the
 * format and the crypto stay testable in Jest without native modules.
 */

/** Seals a backup and opens the share sheet so the user decides where it lives. */
export async function shareBackup(passphrase: string): Promise<void> {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const Crypto = require('expo-crypto');
  const { File, Paths } = require('expo-file-system');
  const Sharing = require('expo-sharing');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const sealed = await sealBackup(await collectBackup(), passphrase, (n: number) =>
    Crypto.getRandomBytes(n)
  );
  const file = new File(Paths.cache, backupFileName());
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(sealed));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/octet-stream',
    dialogTitle: 'Keep your Pinch backup somewhere safe',
  });
}

/** Lets the user choose a backup file; null when they back out. */
export async function pickBackupText(): Promise<string | null> {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const DocumentPicker = require('expo-document-picker');
  const { File } = require('expo-file-system');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  return new File(result.assets[0].uri).text();
}

export async function restoreFromText(text: string, passphrase: string) {
  return restoreBackup(await openBackup(text, passphrase));
}
