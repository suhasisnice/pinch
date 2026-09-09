import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  PhoneContact,
  hasContactsPermission,
  isCaptureAvailable,
  readContacts,
  requestContactsPermission,
} from '../../modules/pinch-capture';
import { palette, spacing, typography } from '../theme/theme';
import { Button, EmptyState, Field, Loading, Row, Sheet } from './ui';

type Phase = 'IDLE' | 'LOADING' | 'DENIED' | 'READY';

/**
 * Picks a person out of the phone's contacts.
 *
 * Names typed by hand drift ("Rahul", "rahul k", "Rahul Kumar") and each
 * spelling becomes a separate balance, which is exactly the thing this screen
 * exists to avoid. Picking from contacts also carries the phone number
 * through, so the WhatsApp nudge has somewhere to go.
 */
export default function ContactPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (contact: PhoneContact) => void;
}) {
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!isCaptureAvailable) {
      setPhase('DENIED');
      return;
    }
    setPhase('LOADING');
    const granted = hasContactsPermission() || (await requestContactsPermission());
    if (!granted) {
      setPhase('DENIED');
      return;
    }
    setContacts(await readContacts());
    setPhase('READY');
  }, []);

  useEffect(() => {
    if (visible) load();
    else setQuery('');
  }, [visible, load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = needle
      ? contacts.filter((c) => c.name.toLowerCase().includes(needle))
      : contacts;
    // The full list can run to thousands; the search box is the way through it.
    return source.slice(0, 80);
  }, [contacts, query]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Pick a friend">
      {phase === 'LOADING' ? <Loading label="Reading contacts…" /> : null}

      {phase === 'DENIED' ? (
        <EmptyState
          icon="contacts"
          title="No contacts access"
          body="Pinch only reads contacts so you can pick who a bill is split with. You can still type a name instead."
          action={<Button label="Try again" variant="secondary" onPress={load} />}
        />
      ) : null}

      {phase === 'READY' ? (
        <>
          <Field label="Search" value={query} onChangeText={setQuery} placeholder="Type a name" />
          {filtered.length === 0 ? (
            <EmptyState icon="search" title="No matches" body="Try a different spelling." />
          ) : (
            <View>
              {filtered.map((contact) => (
                <Row
                  key={`${contact.name}-${contact.phone ?? ''}`}
                  title={contact.name}
                  subtitle={contact.phone ?? 'No number saved'}
                  onPress={() => onPick(contact)}
                />
              ))}
              {contacts.length > filtered.length ? (
                <Text style={styles.more}>
                  Showing {filtered.length} of {contacts.length} — search to narrow it down.
                </Text>
              ) : null}
            </View>
          )}
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  more: {
    ...typography.micro,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
