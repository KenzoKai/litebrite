import type { Peer, DataConnection } from 'peerjs';
import type { Stroke } from './board';

export type RoomState = 'idle' | 'creating' | 'waiting' | 'joining' | 'connected' | 'ended' | 'error';
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
  private guest = false;
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
    this.guest = !!invite;
    this.events.state(invite ? 'joining' : 'creating');
    try {
      if (!window.isSecureContext || !crypto.subtle || !window.RTCPeerConnection) {
        this.fail('This browser cannot make a secure connection. Open this link in an up-to-date Safari, Chrome, or Firefox browser.'); return;
      }
      const secret = invite?.secret || encode(crypto.getRandomValues(new Uint8Array(32)));
      this.key = await crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
      if (this.disposed) return;
      const { default: Peer } = await import('peerjs');
      if (this.disposed) return;
      const id = 'lb-' + crypto.randomUUID().replace(/-/g, '');
      this.identity = id;
      // Bundled PeerJS configuration includes STUN and TURN for cross-network connectivity.
      // No drawing, invitation secret, or encryption key is sent to the signaling service.
      this.peer = new Peer(id, { debug: 0, logFunction: () => undefined, secure: true });
      const opening = this.later(() => this.fail('The connection service is unavailable. Check your connection and try a new invitation.'), 20000);
      this.peer.on('open', () => {
        clearTimeout(opening); this.timers.delete(opening);
        if (this.disposed) return;
        if (invite) {
          this.attach(this.peer!.connect(invite.host, { serialization: 'raw', reliable: false }), true);
        } else {
          this.events.invite(`${location.origin}${location.pathname}#room=${id}.${secret}`);
          this.events.state('waiting');
          this.later(() => { if (!this.joined) this.fail('This invitation expired after 10 minutes. Create a fresh one to connect.'); }, 600000);
        }
      });
      this.peer.on('connection', c => {
        if (this.disposed || this.guest || this.active || this.candidates.size >= 4) { c.close(); return; }
        this.attach(c, false);
      });
      this.peer.on('error', err => {
        if (this.disposed || this.joined) return;
        if (err.type === 'peer-unavailable') this.fail('This invitation is used, expired, or its owner has left. Ask them for a fresh link.');
        else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') this.fail('The connection was interrupted. Check your network, then try a fresh invitation.');
        else if (this.guest) this.fail('These browsers could not connect. Try another network or an up-to-date browser, then use a fresh invitation.');
      });
      this.peer.on('disconnected', () => {
        if (!this.disposed && !this.joined) this.fail('Your invitation went offline. Create a fresh link to try again.');
      });
    } catch { this.fail('A secure room could not be created. Try an up-to-date browser and a fresh invitation.'); }
  }

  private attach(c: DataConnection, guest: boolean) {
    this.candidates.add(c);
    let queue = Promise.resolve(); let pending = 0;
    const timeout = this.later(() => {
      if (this.joined && this.active === c) return;
      if (guest) this.fail('Unable to reach the other person. Keep both pages open, try another network, and request a fresh invitation.');
      else { if (this.active === c) this.active = undefined; c.close(); this.candidates.delete(c); }
    }, 25000);
    c.on('open', () => { if (guest) void this.send(c, { type: 'hello' }); });
    c.on('data', raw => {
      if (this.disposed || typeof raw !== 'string' || raw.length > 5000 || pending >= 16) return;
      pending++;
      queue = queue.then(async () => {
        try {
          const msg = await this.unpack(c, raw);
          if (!msg || this.disposed) return;
          if (!this.joined) {
            if (!guest && msg.type === 'hello') {
              if (this.active && this.active !== c) { c.close(); return; }
              this.active = c; this.offsets.set(c, Date.now() - msg.at!);
              await this.send(c, { type: 'welcome' });
            } else if (guest && msg.type === 'welcome') {
              this.active = c; this.offsets.set(c, Date.now() - msg.at!);
              await this.send(c, { type: 'ready' });
              this.connected(c);
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
          else if (msg.type === 'end') this.end(false, 'The other person ended the connection. The board is cleared.');
        } catch { /* Invalid ciphertext is discarded without logging or retaining it. */ }
      }).finally(() => { pending--; });
    });
    c.on('close', () => {
      this.candidates.delete(c);
      if (this.active === c && !this.disposed) this.end(false, 'The other person disconnected. Create a new invitation to reconnect.');
      else if (guest && !this.disposed) this.fail('This invitation is no longer available. Ask for a fresh link.');
    });
    c.on('error', () => {
      if (this.active === c && !this.disposed) this.end(false, 'The connection was lost. Create a new invitation to reconnect.');
    });
  }
  private connected(c: DataConnection) {
    this.joined = true; this.active = c; this.lastSeen = Date.now();
    for (const other of this.candidates) if (other !== c) other.close();
    this.candidates.clear();
    this.events.invite(''); this.events.clear(); this.events.state('connected');
    // The signaling ID goes offline once paired, so a third browser cannot join.
    this.peer?.disconnect();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > 16000) { this.end(false, 'The other person went offline. Create a new invitation to reconnect.'); return; }
      void this.send(c, { type: 'ping' });
    }, 3000);
    this.later(() => this.end(true, 'The one-hour session has ended. Create a new invitation to keep talking.'), 3600000);
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
  end(notify = true, detail = 'Connection ended. The board is cleared and the invitation is invalid.') {
    if (this.disposed) return;
    if (notify && this.active) {
      void this.send(this.active, { type: 'end' }).finally(() => this.destroy());
    } else this.destroy();
    this.events.clear(); this.events.invite(''); this.events.state('ended', detail);
  }
  destroy() {
    this.disposed = true; this.joined = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear(); clearInterval(this.heartbeat);
    this.active?.close(); this.active = undefined;
    for (const c of this.candidates) c.close(); this.candidates.clear();
    this.peer?.destroy(); this.peer = undefined; this.key = undefined;
    this.events.clear(); this.events.invite('');
  }
}
