"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Radio, ShieldCheck, Moon, Link2, Copy, Check, Share2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import Board, { COLORS, type Stroke } from './board';
import { LightRoom, parseInvite, type RoomState } from './connection';

export default function Home() {
  const [ready, setReady] = useState(false);
  const [color, setColor] = useState(0);
  const [fade, setFade] = useState(2000);
  const [clear, setClear] = useState(0);
  const [state, setState] = useState<RoomState>('idle');
  const [detail, setDetail] = useState('');
  const [invite, setInvite] = useState('');
  const [modal, setModal] = useState<'invite' | 'privacy' | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareable, setShareable] = useState(false);
  const [away, setAway] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const room = useRef<LightRoom | null>(null);
  const listener = useRef<((s: Stroke) => void) | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribe = useCallback((fn: (s: Stroke) => void) => { listener.current = fn; return () => { listener.current = null; }; }, []);
  const onDraw = useCallback((s: Stroke) => room.current?.draw(s), []);
  const blackout = useCallback(() => { setClear(v => v + 1); room.current?.blackout(); }, []);
  const begin = useCallback((incoming?: { host: string; secret: string }) => {
    room.current?.destroy();
    setAway(false); setDetail(''); setCopied(false); setCopyError(false);
    const next = new LightRoom({
      state: (s, message) => {
        setState(s); setDetail(message || '');
        if (s === 'connected') { setModal(null); setColor(incoming ? 3 : 0); }
        if (s === 'error' || s === 'ended') setModal(null);
      },
      invite: setInvite,
      stroke: s => listener.current?.(s),
      clear: () => setClear(v => v + 1),
      away: setAway,
    });
    room.current = next;
    void next.start(incoming);
    if (!incoming) setModal('invite');
  }, []);
  useEffect(() => {
    const hash = location.hash;
    // The invitation is consumed in-browser and removed from the visible URL/history entry.
    if (hash) history.replaceState(null, '', location.pathname);
    if (hash) {
      const incoming = parseInvite(hash);
      if (incoming) begin(incoming);
      else { setState('error'); setDetail('That invitation is incomplete. Ask the other person to share a fresh link.'); }
    }
    setShareable(typeof navigator.share === 'function');
    setReady(true);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') blackout(); };
    const visibility = () => { if (document.hidden) blackout(); room.current?.presence(document.hidden); };
    const hide = () => { blackout(); room.current?.end(true); };
    const restore = (e: PageTransitionEvent) => { if (e.persisted) { room.current?.destroy(); setState('ended'); setDetail('This page was restored. Create a new invitation to reconnect.'); } };
    const offline = () => room.current?.end(false, 'You are offline. Reconnect to the internet and create a new invitation.');
    document.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', restore); window.addEventListener('offline', offline);
    return () => {
      room.current?.destroy();
      document.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', restore); window.removeEventListener('offline', offline);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [begin, blackout]);
  useEffect(() => {
    // A privacy-safe WebMCP action: no tool can read drawings or invitation secrets.
    type Context = { registerTool: (tool: object, options: { signal: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: 'blackout_board', title: 'Blackout board',
        description: 'Immediately clear the lights on both connected boards.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input: unknown) => {
          if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.');
          blackout(); return { cleared: true };
        },
      }, { signal: controller.signal })).catch(() => undefined);
    } catch { /* Optional browser API; no telemetry. */ }
    return () => controller.abort();
  }, [blackout]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(invite); setCopied(true); setCopyError(false); if(copiedTimer.current)clearTimeout(copiedTimer.current);copiedTimer.current=setTimeout(()=>setCopied(false),3500); }
    catch { setCopyError(true); }
  };
  const share = async () => {
    try { await navigator.share({ title: 'Join me on Afterglow', text: 'A little light between us. Keep this invitation just between us.', url: invite }); }
    catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setCopyError(true); }
  };
  const busy = state === 'creating' || state === 'joining';
  const connected = state === 'connected';
  const status = connected ? 'CONNECTED · JUST YOU TWO' : state === 'waiting' ? 'WAITING FOR YOUR PERSON' : state === 'joining' ? 'MAKING A CONNECTION' : state === 'creating' ? 'CREATING YOUR INVITATION' : 'YOUR SIDE IS READY';
  return <main className="app-shell">
    <header className="masthead"><a className="brand" href="/" aria-label="Afterglow home"><span className="brand-dots"><i/><i/><i/><i/></span>afterglow<span className="brand-period">.</span></a><span className="eyebrow">A PRIVATE LIGHT BOARD</span><button className="quiet" onClick={() => setModal('privacy')}><ShieldCheck size={16}/> How it stays private</button></header>
    <section className="intro"><div><div className="eyebrow chapter">{connected ? '02 / LET THE LIGHT TALK' : '01 / MAKE A CONNECTION'}</div><h1>A little light.<br/><em>Between us.</em></h1><p>Just you, someone else, and a few fleeting lights.</p></div>
      <div className={`invite-panel ${connected ? 'connected' : ''}`}>
        <span className="small-label" role="status"><Radio size={16}/>{status}</span>
        <p>{connected ? <>You’re here.<br/>They’re here.</> : state === 'waiting' ? <>Leave this page open.<br/>They’ll be here soon.</> : state === 'joining' ? <>Finding the light<br/>on the other side.</> : <>Some things are better<br/>said in lights.</>}</p>
        {connected ? <><span className="fine">{away ? 'They stepped away. The board is cleared.' : 'Draw together. Watch it disappear.'}</span><div className="session-actions"><button className="secondary" onClick={() => room.current?.end()}><X size={14}/> End connection</button></div></> : <><button className="primary" disabled={busy || !ready} onClick={() => invite ? setModal('invite') : begin()}>{busy ? 'Connecting…' : invite ? 'Share invitation' : state === 'ended' || state === 'error' ? 'Create a new invitation' : 'Invite someone'}<ArrowUpRight size={19}/></button><span className="fine">{invite ? 'Single-use link · expires in 10 minutes' : 'One link. Two people. No message history.'}</span></>}
      </div>
    </section>
    <section className={`board-section ${connected ? 'connected' : ''}`} aria-label="Light board">
      <div className="board-top"><span className="small-label"><span className="status-dot"/>{connected ? 'SHARED BOARD' : 'YOUR BOARD'}</span><span className="fine">{connected ? away ? 'They’re away · lights won’t be replayed' : 'Everything you draw fades away' : 'Try drawing while you wait'}</span><span className="small-label"><Link2 size={14}/>{connected ? '2' : '1'} OF 2 HERE</span></div>
      <div className="board-frame"><Board color={color} fade={fade} clearVersion={clear} subscribe={subscribe} onDraw={onDraw}/></div>
      <div className="controls"><RadioGroup aria-label="Your light color" value={String(color)} onValueChange={v => setColor(Number(v))} className="palette">{COLORS.map((c, i) => <RadioGroupItem key={c} value={String(i)} aria-label={['Amber','Rose','Violet','Sky','Mint','White'][i]} className={`swatch ${color === i ? 'selected' : ''}`} style={{ '--peg': c } as React.CSSProperties}/>)}<span className="fine color-label">YOUR LIGHT</span></RadioGroup>
        <div className="fade-control"><span className="fine" id="fade-label">Fade after</span><RadioGroup aria-labelledby="fade-label" value={String(fade)} onValueChange={v => { setFade(Number(v)); blackout(); }} className="fade-choices">{[1000,2000,3000].map(ms => <label key={ms} className={`fade-option ${fade === ms ? 'active' : ''}`}><RadioGroupItem value={String(ms)} aria-label={`Fade after ${ms/1000} second${ms === 1000 ? '' : 's'}`}/><span>{ms/1000}s</span></label>)}</RadioGroup></div>
        <button className="blackout" onClick={blackout}><Moon size={16}/> Blackout <kbd>Esc</kbd></button>
      </div>
      {detail && <div className="notice-bar" role="status">{detail}</div>}
    </section>
    <footer><p>Draw with your finger or mouse. Let the light do the talking.</p><span className="fine"><ShieldCheck size={14}/> No history. Just this moment.</span></footer>
    <Dialog open={modal === 'invite'} onOpenChange={open => { if (!open) setModal(null); }}><DialogContent className="modal"><DialogTitle>A light on the other side.</DialogTitle><DialogDescription>Send this private invitation to one person. Keep this page open while they join. Once you connect, the link stops working.</DialogDescription>{invite ? <><label className="sr-only" htmlFor="invite-link">Private invitation link</label><input id="invite-link" value={invite} readOnly onFocus={e => e.currentTarget.select()} autoComplete="off" spellCheck={false}/><div className="modal-actions"><button className="primary" onClick={copy}>{copied ? 'Copied' : 'Copy invitation'}{copied ? <Check size={18}/> : <Copy size={18}/>}</button>{shareable && <button className="secondary share-button" onClick={share}><Share2 size={17}/> Share</button>}</div><span role="status" className="fine">{copyError ? 'Select the link above and copy it manually.' : copied ? 'Invitation copied. Share it only with your person.' : 'Expires in 10 minutes. Only new strokes are shared.'}</span><button className="quiet cancel-invite" onClick={() => { room.current?.end(); setModal(null); }}>Cancel invitation</button></> : <p role="status">Creating a secure invitation…</p>}</DialogContent></Dialog>
    <Dialog open={modal === 'privacy'} onOpenChange={open => { if (!open) setModal(null); }}><DialogContent className="modal privacy-modal"><DialogTitle>Here, then gone.</DialogTitle><DialogDescription>Afterglow keeps your drawings in the moment.</DialogDescription><div className="privacy-copy"><p><strong>No message history.</strong> Lights live in browser memory for up to three seconds. There’s no database, account, analytics, drawing log, local storage, or replay.</p><p><strong>Encrypted between you.</strong> Your invitation contains a secret key after the # in the link. It never goes to the website server. The browsers authenticate each other with that key and encrypt every stroke. A connection service helps them meet; a relay may carry encrypted traffic when needed.</p><p><strong>Just two people.</strong> The first person with the full invitation can join. Share it privately. After pairing, the invitation closes. Either person can end the session; sessions expire after an hour.</p><p><strong>Fading is not screenshot protection.</strong> A glance may still catch a short word. Screenshots, video, a recipient, or a compromised device can capture visible lights. Use a one-second fade and Blackout for less exposure.</p><p><strong>Network metadata is different.</strong> The hosting, signaling, and relay providers may retain IP addresses and connection metadata. Afterglow cannot guarantee that those services log nothing. A direct connection may reveal your IP address to the other person.</p><p>Switching apps clears both boards. Strokes sent while you’re away are discarded. A broken connection ends the room; use a fresh invitation to reconnect.</p></div></DialogContent></Dialog>
  </main>;
}
