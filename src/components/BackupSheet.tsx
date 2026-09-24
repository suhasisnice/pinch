import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button, Field, Sheet } from './ui';
import { palette, spacing, typography } from '../theme/theme';
import { BackupError, MIN_PASSPHRASE } from '../services/backupService';
import { pickBackupText, restoreFromText, shareBackup } from '../services/backupFiles';

/**
 * Save or restore an encrypted backup. One passphrase field (two when
 * saving, so a typo cannot lock the user out of their own file), one action.
 */
export default function BackupSheet({
  mode,
  onClose,
  onRestored,
}: {
  mode: 'SAVE' | 'RESTORE' | null;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassphrase('');
    setAgain('');
    setError(null);
    setBusy(false);
  }, [mode]);

  const saving = mode === 'SAVE';
  const ready = saving
    ? passphrase.length >= MIN_PASSPHRASE && passphrase === again
    : passphrase.length > 0;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      if (saving) {
        await shareBackup(passphrase);
        onClose();
      } else {
        const text = await pickBackupText();
        if (text === null) return;
        await restoreFromText(text, passphrase);
        onRestored();
      }
    } catch (e) {
      setError(e instanceof BackupError ? e.message : 'Something went wrong. Nothing changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={mode !== null}
      onClose={onClose}
      title={saving ? 'Save a backup' : 'Restore a backup'}
    >
      <Text style={styles.body}>
        {saving
          ? 'Everything in Pinch, locked with a passphrase you choose. Keep the file wherever you like; without the passphrase it is unreadable, even to Pinch. Forget it and the backup is gone for good.'
          : 'Pick a Pinch backup and type its passphrase. What is on this phone now will be replaced.'}
      </Text>
      <Field
        label="Passphrase"
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        hint={
          saving ? `At least ${MIN_PASSPHRASE} characters. A short sentence works well.` : undefined
        }
      />
      {saving ? (
        <Field
          label="Once more"
          value={again}
          onChangeText={setAgain}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={busy ? 'Working…' : saving ? 'Save and share' : 'Choose the file'}
        onPress={go}
        disabled={!ready || busy}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: palette.textSecondary,
    marginBottom: spacing.md,
  },
  error: {
    ...typography.body,
    color: palette.danger,
    marginBottom: spacing.md,
  },
});
