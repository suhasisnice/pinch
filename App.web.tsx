import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDatabase } from './src/db/dbService';
import RootNavigator from './src/navigation/RootNavigator';
import { DialogHost } from './src/components/Dialog';
import { seedDemoData } from './src/dev/demoData';
import { palette } from './src/theme/theme';

/**
 * Browser entry for the design preview (`npm run preview`) — never shipped.
 *
 * Metro picks this over App.tsx for web. It skips everything that needs the
 * phone (SMS capture, notifications, revalidation) and fills a fresh
 * in-memory database with invented demo data, so the real screens can be
 * looked at and screenshotted at phone size in a desktop browser.
 */
/** `?h=2400` renders a tall frame, so a headless screenshot captures a whole scroll. */
function frameHeight(): number {
  const h = Number(new URLSearchParams(globalThis.location?.search ?? '').get('h'));
  return Number.isFinite(h) && h > 0 ? h : 915;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await initDatabase();
      await seedDemoData();
      setReady(true);
    })().catch((e) => setError(String(e?.stack ?? e)));
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background, padding: 20 }}>
        <Text style={{ color: palette.danger }}>{error}</Text>
      </View>
    );
  }
  if (!ready) return <View style={{ flex: 1, backgroundColor: palette.background }} />;

  // A phone-sized frame, so layouts are judged at the width they ship at.
  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'flex-start' }}>
      <View
        style={{
          width: '100%',
          maxWidth: 412,
          height: '100%',
          maxHeight: frameHeight(),
          overflow: 'hidden',
          backgroundColor: palette.background,
        }}
      >
        <SafeAreaProvider>
          <RootNavigator />
          <DialogHost />
        </SafeAreaProvider>
      </View>
    </View>
  );
}
