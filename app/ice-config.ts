/** TURN credentials are browser-facing relay credentials, never room encryption keys.
 * Configure an account-owned relay instead of relying on PeerJS's retired defaults.
 */
export function hasTurnRelay(): boolean {
  return Boolean(import.meta.env.VITE_TURN_URLS?.trim());
}

export async function createIceConfig(): Promise<RTCConfiguration> {
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const urls = (import.meta.env.VITE_TURN_URLS || '').split(',').map((url: string) => url.trim()).filter(Boolean);
  if (urls.length) {
    const username = import.meta.env.VITE_TURN_USERNAME;
    const credential = import.meta.env.VITE_TURN_CREDENTIAL;
    if (!username || !credential || urls.some((url: string) => !/^turns?:[^\s]+$/.test(url))) {
      throw new Error('Invalid TURN configuration');
    }
    iceServers.push({ urls, username, credential });
  }
  return { iceServers };
}
