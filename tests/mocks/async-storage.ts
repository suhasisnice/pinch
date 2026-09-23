/**
 * An in-memory AsyncStorage.
 *
 * The real module needs the native bridge, so every call through it threw
 * under Jest. That was invisible for a long time because the one place the
 * app read settings during ingestion sat inside a `catch {}` — so tests
 * were quietly exercising the failure path and passing anyway. Anything
 * that genuinely depends on a stored setting needs this to behave.
 *
 * Deliberately not reset between tests by the mock itself: a suite that
 * seeds a setting does so in its own `beforeEach`, and `__resetStorage` is
 * there for the ones that care.
 */
const store = new Map<string, string>();

export function __resetStorage(): void {
  store.clear();
}

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return store.has(key) ? (store.get(key) as string) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key);
  },
  async clear(): Promise<void> {
    store.clear();
  },
  async getAllKeys(): Promise<string[]> {
    return [...store.keys()];
  },
  async multiGet(keys: string[]): Promise<Array<[string, string | null]>> {
    return keys.map((key) => [key, store.has(key) ? (store.get(key) as string) : null]);
  },
  async multiSet(pairs: Array<[string, string]>): Promise<void> {
    for (const [key, value] of pairs) store.set(key, value);
  },
  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) store.delete(key);
  },
};

export default AsyncStorage;
