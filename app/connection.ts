import type { Peer, DataConnection } from 'peerjs';
import type { Stroke } from './board';
import { createIceConfig, hasTurnRelay } from './ice-config';

export type RoomState = 'idle' | 'creating' | 'waiting' | 'full' | 'joining' | 'connected' | 'ended' | 'error';
type Events = {
  state: (state: RoomState, detail?: string) => void;
  invite: (url: string) => void;
  stroke: (stroke: Stroke) => void;
  clear: () => void;
  away: (away: boolean) => void;
};
type Message = { type: string; seq?: number; at?: number; points?: number[]; color?: number; ttl?: number; away?: boolean };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export function parseInvite(hash: string): { host: string; secret: string } | null {
  const match = /^#room=(lb-[a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(hash);
  return match ? { host: match[1], secret: match[2] } : null;
}

/** No persistence, telemetry, transcript, or message replay. Keys live only in this object. */
export class LightRoom {
  private peer?: Peer;
  private identity = ''; 
  private key?: CryptoKey;
  private active?: DataConnection;
  private candidates = new Set<DataConnection>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private disposed = false;
  private joined = false;
  private sent = 0;
  private pendingSend = 0;
  private received = new WeakMap<DataConnection, number>();
  private offsets = new WeakMap<DataConnection, number>();
  private lastSeen = 0;
  private roomId = '';
  private PeerClass?: typeof Peer;
  private epoch = 0;
  private iceConfig?: RTCConfiguration;
  private iceExpires = 0;
  private tabChannel?: BroadcastChannel;
  private hidden = false;
  private burst = 0;
  private burstAt = 0;
  constructor(private events: Events) {}

  private later(fn: () => void, ms: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.disposed) fn(); }, ms);
    this.timers.add(timer);
    return timer;
  }
  private fail(detail: string) { this.destroy(); this.events.state('error', detail); }
  async start(invite?: { host: string; secret: string }) {
    this.events.state(invite ? 'joining' : 'creating');
    try {
      if (!window.isSecureContext || !crypto.subtle || !window.RTCPeerConnection) {
        this.fail('This browser cannot make a secure connection. Open this link in an up-to-date Safari, Chrome, or Firefox browser.'); return;
      }
      const secret = invite?.secret || encode(crypto.getRandomValues(new Uint8Array(32)));
      this.roomId = invite?.host || 'lb-' + crypto.randomUUID().replace(/-/g, '');
      this.key = await crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
      if (this.disposed) return;
      const { default: Peer } = await import('peerjs');
      if (this.disposed) return;
      this.PeerClass = Peer;
      this.iceConfig = await createIceConfig();
      this.iceExpires = Date.now() + 23 * 3600000;
      if (this.disposed) return;
      // Keep only the reusable capability link, never drawing history. Fragments stay off HTTP requests.
      const url = `${location.origin}${location.pathname}#room=${this.roomId}.${secret}`;
      history.replaceState(null, '', url);
      this.events.invite(url);
      this.claimBrowserTab();
      this.openPeer(false);
    } catch { this.fail('A secure room could not be created. Check your browser and reopen this room link.'); }
  }

  private claimBrowserTab() {
    if (typeof BroadcastChannel === 'undefined') return;
    // Coordinate only live tabs in this browser. No storage, drawing data, or room key.
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

  private stopTransport() {
    // Invalidate callbacks before closing transports; stale attempts must never end a new connection.
    this.epoch++;
    this.joined = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear(); clearInterval(this.heartbeat);
    this.active = undefined;
    for (const c of this.candidates) c.close();
    this.candidates.clear();
    this.peer?.destroy(); this.peer = undefined;
    this.events.clear(); this.events.away(false);
  }

  private retry(detail = 'Reconnecting to this room. Keep this page open.', full = false) {
    if (this.disposed) return;
    this.stopTransport();
    this.events.state(full ? 'full' : 'waiting', detail);
    this.later(() => this.openPeer(false), 2000 + Math.random() * 1500);
  }

  private openPeer(guest: boolean) {
    if (this.disposed || !this.PeerClass) return;
    this.stopTransport();
    const epoch = this.epoch;
    if (Date.now() >= this.iceExpires) {
      void createIceConfig().then(config => {
        if (this.disposed || epoch !== this.epoch) return;
        this.iceConfig = config; this.iceExpires = Date.now() + 23 * 3600000; this.openPeer(guest);
      }).catch(() => { if (!this.disposed && epoch === this.epoch) this.retry(); });
      return;
    }
    const current = () => !this.disposed && epoch === this.epoch;
    const id = guest ? 'lb-' + crypto.randomUUID().replace(/-/g, '') : this.roomId;
    this.identity = id;
    // PeerJS arbitrates one rendezvous owner. Whichever browser arrives first owns it;
    // another browser connects with a random identity. No persistent server room is needed.
    const peer = new this.PeerClass(id, { debug: 0, logFunction: () => undefined, secure: true, config: this.iceConfig });
    this.peer = peer;
    const opening = this.later(() => this.retry('The connection service is unavailable. Retrying this room…'), 20000);
    peer.on('open', () => {
      if (!current()) return;
      clearTimeout(opening); this.timers.delete(opening);
      if (guest) this.attach(peer.connect(this.roomId, { serialization: 'raw', reliable: false }), true);
      else this.events.state('waiting');
    });
    peer.on('connection', c => {
      if (!current() || guest || this.candidates.size >= 4) { c.close(); return; }
      this.attach(c, false);
    });
    peer.on('error', err => {
      if (!current()) return;
      if (err.type === 'unavailable-id' && !guest) this.openPeer(true);
      else this.retry('Connection interrupted. Retrying this room…');
    });
    peer.on('disconnected', () => {
      if (current()) this.retry();
    });
  }

  private attach(c: DataConnection, guest: boolean) {
    this.candidates.add(c);
    const epoch = this.epoch;
    const current = () => !this.disposed && epoch === this.epoch && this.candidates.has(c);
    let queue = Promise.resolve(); let pending = 0;
    const timeout = this.later(() => {
      if (this.joined && this.active === c) return;
      if (guest) this.retry(this.networkHelp());
      else { if (this.active === c) this.active = undefined; c.close(); this.candidates.delete(c); }
    }, 25000);
    c.on('open', () => { if (current() && guest) void this.send(c, { type: 'hello' }); });
    c.on('data', raw => {
      if (!current() || typeof raw !== 'string' || raw.length > 5000 || pending >= 16) return;
      pending++;
      queue = queue.then(async () => {
        try {
          const msg = await this.unpack(c, raw);
          if (!msg || !current()) return;
          if (guest && msg.type === 'full') { this.retry('This room already has two people. Close another tab or leave on another device to make space.', true); return; }
          if (!guest && msg.type === 'hello' && this.active && this.active !== c) {
            await this.send(c, { type: 'full' });
            this.later(() => { this.candidates.delete(c); c.close(); }, 250);
            return;
          }
          if (!this.joined) {
            if (!guest && msg.type === 'hello') {
              if (this.active && this.active !== c) { c.close(); return; }
              this.active = c; this.offsets.set(c, Date.now() - msg.at!);
              await this.send(c, { type: 'welcome' });
            } else if (guest && msg.type === 'welcome') {
              this.active = c; this.offsets.set(c, Date.now() - msg.at!);
              await this.send(c, { type: 'ready' });
              if (current()) this.connected(c);
            } else if (!guest && this.active === c && msg.type === 'ready') this.connected(c);
            if (this.joined) { clearTimeout(timeout); this.timers.delete(timeout); }
            return;
          }
          if (c !== this.active) return;
          this.lastSeen = Date.now();
          if (msg.type === 'stroke') {
            const age = Math.max(0, Date.now() - (msg.at! + (this.offsets.get(c) || 0)));
            if (!Array.isArray(msg.points) || msg.points.length > 120 || !msg.points.every(p => Number.isInteger(p) && p >= 0 && p < 2016) || !Number.isInteger(msg.color) || msg.color! < 0 || msg.color! > 5 || ![1000, 2000, 3000].includes(msg.ttl!)) return;
            if (age >= msg.ttl!) return;
            this.events.stroke({ points: msg.points, color: msg.color!, ttl: msg.ttl! - age });
          } else if (msg.type === 'clear') this.events.clear();
          else if (msg.type === 'presence') this.events.away(!!msg.away);
          else if (msg.type === 'ping') await this.send(c, { type: 'pong', away: this.hidden });
          else if (msg.type === 'pong') this.events.away(!!msg.away);
          else if (msg.type === 'end') this.retry('The other person left. Waiting here for them to return.');
        } catch { /* Invalid ciphertext is discarded without logging or retaining it. */ }
      }).finally(() => { pending--; });
    });
    c.on('close', () => {
      if (!current()) return;
      this.candidates.delete(c);
      if (this.active === c || guest) this.retry('The other person disconnected. Waiting for them to return.');
    });
    c.on('error', () => {
      if (current() && (this.active === c || guest)) this.retry(this.networkHelp());
    });
  }
  private networkHelp() {
    return hasTurnRelay()
      ? 'The network connection failed. Retrying; keep both pages open.'
      : 'These networks could not connect directly. Try both devices on the same Wi-Fi. Cellular fallback needs a relay configured for this site.';
  }
  private connected(c: DataConnection) {
    this.joined = true; this.active = c; this.lastSeen = Date.now();
    this.events.clear(); this.events.state('connected');
    // Keep rendezvous online; authenticated third browsers receive a full-room response.
    // When either participant leaves, the remaining browser can claim the same room again.
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > 16000) { this.retry('The other person went offline. Waiting for them to return.'); return; }
      void this.send(c, { type: 'ping' });
    }, 3000);
  }
  private async send(c: DataConnection, msg: Message) {
    if (this.disposed || !this.key || !this.peer || !c.open || this.pendingSend > 8 || c.dataChannel?.bufferedAmount > 32768) return;
    const created = Date.now();
    const seq = ++this.sent;
    const key = this.key;
    const aad = encoder.encode(`${this.identity}:${c.peer}`);
    this.pendingSend++;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = encoder.encode(JSON.stringify({ ...msg, seq, at: created }));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, bytes);
      bytes.fill(0);
      if (this.disposed || !c.open || (msg.type === 'stroke' && Date.now() - created > 200)) return;
      // Send directly to the data channel: never enqueue a drawing in PeerJS's retry buffer.
      c.dataChannel.send(`${encode(iv)}.${encode(new Uint8Array(encrypted))}`);
    } catch { /* Transient data is dropped rather than saved for replay. */ }
    finally { this.pendingSend--; }
  }
  private async unpack(c: DataConnection, raw: string): Promise<Message | null> {
    if (!this.key || !this.peer) return null;
    const parts = raw.split('.'); if (parts.length !== 2 || parts[0].length !== 16) return null;
    const iv = decode(parts[0]);
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${c.peer}:${this.identity}`) }, this.key, decode(parts[1]));
    const msg: Message = JSON.parse(decoder.decode(bytes));
    new Uint8Array(bytes).fill(0);
    if (!Number.isSafeInteger(msg.seq) || msg.seq! <= (this.received.get(c) || 0) || !Number.isFinite(msg.at)) return null;
    this.received.set(c, msg.seq!); return msg;
  }
  draw(stroke: Stroke) {
    if (!this.joined || !this.active || this.hidden) return;
    const now=performance.now();if(now-this.burstAt>1000){this.burst=0;this.burstAt=now;}if(++this.burst>100)return;
    void this.send(this.active, { type: 'stroke', ...stroke });
  }
  blackout() { this.events.clear(); if (this.joined && this.active) void this.send(this.active, { type: 'clear' }); }
  presence(away: boolean) {
    this.hidden = away;
    if (away) this.blackout();
    if (this.joined && this.active) void this.send(this.active, { type: 'presence', away });
  }
  end(notify = true, detail = 'You left the room. Rejoin here or reopen the same link anytime.') {
    if (this.disposed) return;
    if (notify && this.active) {
      void this.send(this.active, { type: 'end' }).finally(() => this.destroy());
    } else this.destroy();
    this.events.clear(); this.events.state('ended', detail);
  }
  destroy() {
    this.disposed = true;
    this.tabChannel?.close(); this.tabChannel = undefined;
    this.stopTransport();
    this.key = undefined;
  }
}
