import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { canUseAppLock, confirmIdentity } from './AppLock';

/**
 * The bank balance and net worth, hidden until the owner proves it is them
 * (0.9.21, docs/FIX_QUEUE.md).
 *
 * Separate from the whole-app lock (LockGate): that one keeps a stranger out
 * of the app entirely, while this one covers the phone glanced at over a
 * shoulder in a canteen queue, with the app already open. Budget and
 * spending figures stay visible, since those are what gets checked ten
 * times a day. Only the figures that say how much money there is are hidden.
 *
 * One reveal shows them all, and they stay shown until the app goes to the
 * background. A phone without a fingerprint or face enrolled has nothing to
 * check against, so a tap reveals them, which is how it worked before.
 */

interface MoneyReveal {
  revealed: boolean;
  /** Asks for a fingerprint or face (or the device PIN). Resolves to whether it worked. */
  reveal: () => Promise<boolean>;
  hide: () => void;
}

const Context = createContext<MoneyReveal>({
  revealed: false,
  reveal: async () => false,
  hide: () => undefined,
});

export function MoneyRevealProvider({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const prompting = useRef(false);

  const reveal = useCallback(async () => {
    if (prompting.current) return false;
    prompting.current = true;
    try {
      const ok = (await canUseAppLock()) ? await confirmIdentity('Show your balance') : true;
      if (ok) setRevealed(true);
      return ok;
    } finally {
      prompting.current = false;
    }
  }, []);

  const hide = useCallback(() => setRevealed(false), []);

  useEffect(() => {
    // 'background', not 'inactive': the biometric prompt itself briefly makes
    // the app inactive, and hiding then would undo the reveal it just granted.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') setRevealed(false);
    });
    return () => sub.remove();
  }, []);

  return <Context.Provider value={{ revealed, reveal, hide }}>{children}</Context.Provider>;
}

export function useMoneyReveal(): MoneyReveal {
  return useContext(Context);
}

/** What a hidden figure shows in place of the number. */
export const MASK = '••••••';
