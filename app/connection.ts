import type { Stroke } from './board';

export type RoomState = 'idle' | 'creating' | 'waiting' | 'full' | 'joining' | 'connected' | 'ended' | 'error';
type Events = {
  state: (state: RoomState, detail?: string) => void;
  invite: (url: string) => void;
  stroke: (stroke: Stroke) => void;
  clear: () => void;
  away: (away: boolean) => void;
};
type Message = { type: 'hello' | 'stroke' | 'clear' | 'presence'; seq?: number; at?: number; points?: number[]; color?: number; ttl?: number; away?: boolean };
type Reply = { state: 'waiting' | 'full' | 'connected' | 'left'; partner?: string; session?: string; packets?: string[] };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
function hex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
export function parseInvite(hash: string): { host: string; secret: string } | null {
  const match = /^#room=(lb-[a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(hash);
  return match ? { host: match[1], secret: match[2] } : null;
}

/** Relay-only HTTPS. No WebRTC, peer addresses, persistent storage, or drawing replay. */
export class LightRoom {
  private key?: CryptoKey;
  private roomId = '';
  private roomHash = '';
  private identity = hex(crypto.getRandomValues(new Uint8Array(16)));
  private token = hex(crypto.getRandomValues(new Uint8Array(32)));
  private endpoint = '';
  private session = '';
  private partner = '';
  private joined = false;
  private disposed = false;
  private hidden = false;
  private sent = 0;
  private received = 0;
  private offset = 0;
  private lastSeen = 0;
  private epoch = 0;
  private clearEpoch = 0;
  private clearPending = false;
  private discardIncoming = false;
  private lastPresence = 0;
  private drawing?: { points: Map<number, number>; color: number; ttl: number };
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private tabChannel?: BroadcastChannel;
  private lastState = '';
  constructor(private events: Events) {}

  private state(state: RoomState, detail = '') {
    const value = `${state}:${detail}`;
    if (value !== this.lastState) { this.lastState = value; this.events.state(state, detail); }
  }
  async start(invite?: { host: string; secret: string }) {
    this.state(invite ? 'joining' : 'creating');
    try {
      if (!window.isSecureContext || !crypto.subtle) throw new Error('secure_context');
      const secret = invite?.secret || encode(crypto.getRandomValues(new Uint8Array(32)));
      this.roomId = invite?.host || 'lb-' + crypto.randomUUID().replace(/-/g, '');
      this.key = await crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
      // The relay gets a domain-separated capability hash, never the fragment or encryption key.
      this.roomHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`afterglow-relay-v1:${this.roomId}:${secret}`))));
      if (this.disposed) return;
      this.endpoint = ['localhost', '127.0.0.1'].includes(location.hostname) ? '/relay.php' : 'https://litebrite.it/relay.php';
      const url = `${location.origin}${location.pathname}#room=${this.roomId}.${secret}`;
      history.replaceState(null, '', url); this.events.invite(url);
      this.claimBrowserTab();
      void this.poll();
    } catch {
      this.destroy(); this.state('error', 'A secure room could not be created. Open this link in an up-to-date browser over HTTPS.');
    }
  }
  private claimBrowserTab() {
    if (typeof BroadcastChannel === 'undefined') return;
    const stamp = `${String(Date.now()).padStart(16, '0')}:${crypto.randomUUID()}`;
    const channel = new BroadcastChannel(`afterglow-room:${this.roomId}`);
    this.tabChannel = channel;
    channel.onmessage = ({ data }) => {
      if (!data || data.type !== 'claim' || typeof data.stamp !== 'string' || !/^[0-9]{16}:[a-f0-9-]{36}$/.test(data.stamp)) return;
      if (data.stamp > stamp) this.end(true, 'This room is open in another tab in this browser. Use that tab, or rejoin here to move it back.');
      else if (data.stamp < stamp) channel.postMessage({ type: 'claim', stamp });
    };
    channel.postMessage({ type: 'claim', stamp });
  }
  private resetSession(session = '', partner = '') {
    if (this.session === session && this.partner === partner) return;
    this.epoch++; this.session = session; this.partner = partner;
    this.joined = false; this.received = 0; this.lastSeen = 0; this.lastPresence = 0;
    this.drawing = undefined; this.clearPending = false;
    this.events.clear(); this.events.away(false);
  }
  private async pack(message: Message): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = encoder.encode(JSON.stringify({ ...message, seq: ++this.sent, at: Date.now() }));
    try {
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
        additionalData: encoder.encode(`${this.session}:${this.identity}:${this.partner}`) }, this.key!, bytes);
      return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
    } finally { bytes.fill(0); }
  }
  private async makePackets() {
    if (!this.session || !this.partner || !this.key || this.disposed) return [];
    const messages: Message[] = [];
    if (!this.joined || performance.now() - this.lastPresence >= 1000) {
      messages.push({ type: 'hello', away: this.hidden }); this.lastPresence = performance.now();
    }
    if (this.clearPending) { messages.push({ type: 'clear' }); this.clearPending = false; }
    const drawing = this.drawing; this.drawing = undefined;
    if (drawing && this.joined && !this.hidden) {
      const now = performance.now();
      const points = [...drawing.points].filter(entry => now - entry[1] < 300).map(entry => entry[0]);
      if (points.length) messages.push({ type: 'stroke', points, color: drawing.color, ttl: drawing.ttl });
    }
    const epoch = this.epoch, clearEpoch = this.clearEpoch;
    const packets: string[] = [];
    for (const message of messages) {
      const packet = await this.pack(message);
      if (epoch !== this.epoch || this.disposed) return [];
      if (message.type !== 'stroke' || clearEpoch === this.clearEpoch) packets.push(packet);
    }
    return packets;
  }
  private async receive(raw: string, discardStrokes = false) {
    if (!this.key || raw.length > 5000) return;
    const parts = raw.split('.'); if (parts.length !== 2 || parts[0].length !== 16) return;
    const epoch = this.epoch;
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[0]),
      additionalData: encoder.encode(`${this.session}:${this.partner}:${this.identity}`) }, this.key, decode(parts[1]));
    let msg: Message;
    try { msg = JSON.parse(decoder.decode(bytes)); } finally { new Uint8Array(bytes).fill(0); }
    if (epoch !== this.epoch || this.disposed || !msg || !Number.isSafeInteger(msg.seq) || msg.seq! <= this.received || !Number.isFinite(msg.at)) return;
    this.received = msg.seq!;
    if (msg.type === 'hello') {
      if (!this.joined) {
        this.offset = Date.now() - msg.at!;
        this.joined = true; this.events.clear(); this.state('connected');
        // Authenticate in both directions even if our first hello was lost.
        this.lastPresence = 0;
      }
      this.lastSeen = performance.now(); this.events.away(!!msg.away); return;
    }
    if (!this.joined) return;
    this.lastSeen = performance.now();
    if (msg.type === 'clear') { this.drawing = undefined; this.events.clear(); }
    else if (msg.type === 'presence') this.events.away(!!msg.away);
    else if (msg.type === 'stroke' && !this.hidden && !discardStrokes) {
      const age = Math.max(0, Date.now() - (msg.at! + this.offset));
      if (!Array.isArray(msg.points) || msg.points.length > 120 || !msg.points.every(p => Number.isInteger(p) && p >= 0 && p < 2016) || !Number.isInteger(msg.color) || msg.color! < 0 || msg.color! > 5 || ![1000, 2000, 3000].includes(msg.ttl!) || age >= msg.ttl!) return;
      this.events.stroke({ points: msg.points, color: msg.color!, ttl: msg.ttl! - age });
    }
  }
  private async poll() {
    if (this.disposed) return;
    let delay = 100;
    const controller = new AbortController(); this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const packets = await this.makePackets();
      if (this.disposed) return;
      const epoch = this.epoch, clearEpoch = this.clearEpoch, discardIncoming = this.discardIncoming;
      const response = await fetch(this.endpoint, { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ action: 'poll', room: this.roomHash, token: this.token, id: this.identity, session: this.session, packets }) });
      if (!response.ok) throw new Error('relay_unavailable');
      const reply: Reply = await response.json();
      if (this.disposed || epoch !== this.epoch) return;
      if (reply.state === 'left') { this.end(false); return; }
      if (reply.state === 'full') {
        this.resetSession(); this.state('full', 'This room already has two people. Close another tab or leave on another device to make space.'); delay = 1200;
      } else if (reply.state === 'waiting') {
        const wasConnected = this.joined;
        this.resetSession(); this.state('waiting', wasConnected ? 'The other person disconnected. Waiting for them to return.' : ''); delay = 500;
      } else if (reply.state === 'connected' && /^[a-f0-9]{32}$/.test(reply.session || '') && /^[a-f0-9]{32}$/.test(reply.partner || '') && reply.partner !== this.identity) {
        this.resetSession(reply.session!, reply.partner!);
        if (!this.joined) this.state('joining', 'Making an encrypted connection through the server.');
        if (Array.isArray(reply.packets) && reply.packets.length <= 8 && clearEpoch === this.clearEpoch) {
          for (const packet of reply.packets) if (typeof packet === 'string') {
            try { await this.receive(packet, discardIncoming); } catch { /* Discard unauthenticated data without logging it. */ }
          }
        }
        if (this.joined && performance.now() - this.lastSeen > 5000) {
          this.joined = false; this.drawing = undefined; this.events.clear(); this.state('joining', 'Waiting for the other browser to respond securely.');
        }
        if (clearEpoch === this.clearEpoch) this.discardIncoming = this.hidden;
        delay = this.hidden ? 700 : 100;
      } else throw new Error('invalid_relay_response');
    } catch {
      if (!this.disposed) {
        this.resetSession(); this.drawing = undefined;
        this.state('waiting', 'The private server connection is interrupted. Retrying automatically.'); delay = 1000;
      }
    } finally {
      clearTimeout(timeout); if (this.request === controller) this.request = undefined;
      if (!this.disposed) this.timer = setTimeout(() => { void this.poll(); }, delay);
    }
  }
  draw(stroke: Stroke) {
    if (!this.joined || this.hidden || this.disposed) return;
    if (!this.drawing || this.drawing.color !== stroke.color || this.drawing.ttl !== stroke.ttl) {
      this.drawing = { points: new Map(), color: stroke.color, ttl: stroke.ttl };
    }
    for (const point of stroke.points) {
      this.drawing.points.delete(point); this.drawing.points.set(point, performance.now());
      if (this.drawing.points.size > 120) this.drawing.points.delete(this.drawing.points.values().next().value!);
    }
  }
  blackout() { this.clearEpoch++; this.drawing = undefined; this.clearPending = true; this.events.clear(); }
  presence(away: boolean) { this.hidden = away; this.discardIncoming = true; this.blackout(); this.lastPresence = 0; }
  end(notify = true, detail = 'You left the room. Rejoin here or reopen the same link anytime.') {
    if (this.disposed) return;
    // All exits release the server seat, including local offline transitions.
    void notify;
    this.destroy(); this.state('ended', detail);
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.epoch++;
    clearTimeout(this.timer); this.request?.abort();
    this.tabChannel?.close(); this.tabChannel = undefined;
    // keepalive lets pagehide release the seat; a server tombstone rejects late in-flight polls.
    if (this.roomHash && this.endpoint) void fetch(this.endpoint, { method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'leave', room: this.roomHash, token: this.token, id: this.identity }) }).catch(() => undefined);
    this.key = undefined; this.drawing = undefined; this.joined = false;
    this.events.clear(); this.events.away(false);
  }
}
