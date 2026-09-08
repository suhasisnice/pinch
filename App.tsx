import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { initDatabase } from './src/db/dbService';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initDatabase().then(() => setReady(true));
  }, []);

  return (
    <View style={styles.container}>
      <Text>{ready ? 'Pinch — database ready' : 'Pinch — initializing...'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
