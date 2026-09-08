import { Linking, Share } from 'react-native';
import { buildNudgeMessage, buildWhatsAppUrl } from './nudgeMessage';

export { buildNudgeMessage, buildWhatsAppUrl, sanitizePhoneForWhatsApp } from './nudgeMessage';

/**
 * Opens WhatsApp pre-filled with the nudge message. With a phone on file it
 * deep-links straight to that chat; without one (e.g. a ghost contact typed
 * with no number) it opens WhatsApp's own contact picker instead. Falls
 * back to the native share sheet if WhatsApp isn't installed.
 */
export async function sendNudge(name: string, amount: number, merchant: string, phone?: string | null): Promise<void> {
  const message = buildNudgeMessage(name, amount, merchant);
  const url = buildWhatsAppUrl(message, phone);

  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
    return;
  }

  await Share.share({ message });
}
