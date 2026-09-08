import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { initDatabase } from './src/db/dbService';
import ParserScreen from './src/screens/ParserScreen';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initDatabase().then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={styles.container}>
        <Text>Pinch — initializing...</Text>
      </View>
    );
  }

  return <ParserScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
