"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, ShieldCheck, Moon, Link2, Copy, Check, Share2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import GameBoard from './games/board';
import { GameSession } from './games/session';
import type { Action, Mode } from './games/engine';
import Board, { COLORS, type Stroke } from './board';
import { LightRoom, parseInvite, type RoomState } from './connection';

export default function Home() {
  const [games] = useState(() => new GameSession());
  const gameView = useSyncExternalStore(games.subscribe, games.getSnapshot);
  const [gamesReady, setGamesReady] = useState(false);
  const gameAction = useCallback((action: Action) => games.action(action), [games]);
  useEffect(() => { games.startTimer(); return () => games.stopTimer(); }, [games]);
  const [ready, setReady] = useState(false);
  const [color, setColor] = useState(0);
  const [fade, setFade] = useState(2000);
  const [clear, setClear] = useState(0);
  const [state, setState] = useState<RoomState>('idle');
  const stateRef = useRef<RoomState>('idle');
  const [detail, setDetail] = useState('');
  const [invite, setInvite] = useState('');
  const [modal, setModal] = useState<'invite' | 'privacy' | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareable, setShareable] = useState(false);
  const [away, setAway] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const room = useRef<LightRoom | null>(null);
  const resumeAfterOffline = useRef(false);
  const listener = useRef<((s: Stroke) => void) | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribe = useCallback((fn: (s: Stroke) => void) => { listener.current = fn; return () => { listener.current = null; }; }, []);
  const onDraw = useCallback((s: Stroke) => room.current?.draw(s), []);
  const blackout = useCallback(() => { setClear(v => v + 1); games.reset(); room.current?.blackout(); }, [games]);
  const begin = useCallback((incoming?: { host: string; secret: string }) => {
    room.current?.destroy();
    setInvite(''); setAway(false); setDetail(''); setCopied(false); setCopyError(false);
    const next = new LightRoom({
      state: (s, message) => {
        if (s !== 'connected') { games.disconnect(); setGamesReady(false); }
        stateRef.current = s; setState(s); setDetail(message || '');
        if (s === 'connected') { setModal(null); setColor(incoming ? 3 : 0); }
        if (s === 'error' || s === 'ended') setModal(null);
      },
      invite: setInvite,
      stroke: s => listener.current?.(s),
      clear: () => setClear(v => v + 1),
      away: setAway,
      game: data => games.receive(data),
      gameReady: leader => { games.connect(leader, data => next.sendGame(data)); setGamesReady(true); },
      gameReset: () => games.reset(),
    });
    room.current = next;
    void next.start(incoming);
    if (!incoming) setModal('invite');
  }, [games]);
  useEffect(() => {
    const hash = location.hash;
    // Keep the room capability in the fragment so refreshes and bookmarks reuse it.
    if (hash) {
      const incoming = parseInvite(hash);
      if (incoming) begin(incoming);
      else { setState('error'); setDetail('That room link is incomplete. Open the full shared link or create a new room.'); }
    }
    setShareable(typeof navigator.share === 'function');
    setReady(true);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') blackout(); };
    const visibility = () => { if (document.hidden) blackout(); room.current?.presence(document.hidden); };
    const hide = () => { blackout(); room.current?.end(true); };
    const reconnect = () => { const incoming = parseInvite(location.hash); if (incoming) begin(incoming); };
    const restore = (e: PageTransitionEvent) => { if (e.persisted) reconnect(); };
    const offline = () => { resumeAfterOffline.current = stateRef.current !== 'ended' && stateRef.current !== 'idle'; room.current?.end(false, 'You are offline. This room will reconnect when your internet returns.'); };
    const online = () => { if (resumeAfterOffline.current) { resumeAfterOffline.current = false; reconnect(); } };
    document.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', restore); window.addEventListener('offline', offline); window.addEventListener('online', online); window.addEventListener('hashchange', reconnect);
    return () => {
      room.current?.destroy();
      document.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', restore); window.removeEventListener('offline', offline); window.removeEventListener('online', online); window.removeEventListener('hashchange', reconnect);
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
    try { await navigator.share({ title: 'Join me on Afterglow', text: 'Our shared light board. Save this private room link to meet here again.', url: invite }); }
    catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setCopyError(true); }
  };
  const busy = state === 'creating' || state === 'joining';
  const connected = state === 'connected';
  const status = connected ? 'CONNECTED · JUST YOU TWO' : state === 'full' ? 'ROOM FULL · TWO PEOPLE CONNECTED' : state === 'waiting' ? 'WAITING FOR YOUR PERSON' : state === 'joining' ? 'MAKING A CONNECTION' : state === 'creating' ? 'CREATING YOUR ROOM' : 'YOUR SIDE IS READY';
  return <main className={`app-shell ${gameView.game.mode !== 'draw' ? 'has-game' : ''}`}>
    <header className="masthead">
      <a className="brand" href="/" aria-label="Afterglow home"><span className="brand-dots"><i/><i/><i/><i/></span>afterglow<span className="brand-period">.</span></a>
      <span className="eyebrow">A PRIVATE LIGHT BOARD</span>
      <button className="quiet privacy-button" onClick={() => setModal('privacy')} aria-label="How it stays private"><ShieldCheck size={18}/><span>Privacy</span></button>
    </header>
    <section className={`session-bar ${connected ? 'connected' : ''}`} aria-label="Connection">
      <div className="session-copy"><h1>{connected ? 'Your shared light board' : 'A little light between us.'}</h1><span className="session-status" role="status"><span className="status-dot"/>{status}</span></div>
      <div className="session-action">{connected ? <><button className="secondary" onClick={() => setModal('invite')} aria-label="Share room link"><Link2 size={17}/><span>Room link</span></button><button className="secondary" onClick={() => room.current?.end()}><X size={17}/><span>Leave room</span></button></> : <button className="primary" disabled={busy || !ready} onClick={() => state === 'ended' || state === 'error' ? begin(parseInvite(location.hash) || undefined) : invite ? setModal('invite') : begin()}>{busy ? 'Connecting…' : state === 'ended' || state === 'error' ? 'Rejoin room' : invite ? 'Share room link' : 'Invite someone'}<ArrowUpRight size={18}/></button>}</div>
    </section>
    <nav className="mode-picker" aria-label="Board mode">{([['draw','Free drawing','✦'],['chess','Chess','♔'],['noughts','Tic-tac-toe','×'],['blocks','Falling lights','▧']] as [Mode,string,string][]).map(([mode,label,icon])=><button key={mode} aria-pressed={gameView.game.mode===mode} disabled={gameView.pending||(connected&&!gamesReady)} onClick={()=>gameAction({type:'mode',mode})}><span aria-hidden="true">{icon}</span>{label}</button>)}<span className="fine">{connected?gamesReady?'Shared play':'Reload both browsers to enable games':'Try a game, or invite someone'}</span></nav>
    <section className={`board-section ${gameView.game.mode !== 'draw' ? 'playing' : ''} ${connected ? 'connected' : ''}`} aria-label="Light board">
      <div className="board-top"><span className="small-label">{gameView.game.mode !== 'draw' ? 'PLAY IN LIGHT' : connected ? away ? 'THEY STEPPED AWAY' : 'DRAW TOGETHER' : 'TRY DRAWING WHILE YOU WAIT'}</span><span className="fine board-message">{gameView.game.mode !== 'draw' ? 'The round lives only in your browsers.' : connected ? away ? 'Their board is cleared. Nothing is replayed.' : 'Your lights fade on both screens.' : 'Invite one person to share this board.'}</span><span className="small-label"><Link2 size={15}/>{connected || state === 'full' ? '2' : '1'} of 2</span></div>
      {gameView.game.mode === 'draw' ? <><Board color={color} fade={fade} clearVersion={clear} subscribe={subscribe} onDraw={onDraw}/>
      <div className="controls"><RadioGroup aria-label="Your light color" value={String(color)} onValueChange={v => setColor(Number(v))} className="palette">{COLORS.map((c, i) => <RadioGroupItem key={c} value={String(i)} aria-label={['Amber','Rose','Violet','Sky','Mint','White'][i]} className={`swatch ${color === i ? 'selected' : ''}`} style={{ '--peg': c } as React.CSSProperties}/>)}<span className="fine color-label">YOUR LIGHT</span></RadioGroup>
        <div className="fade-control"><span className="fine" id="fade-label">Fade after</span><RadioGroup aria-labelledby="fade-label" value={String(fade)} onValueChange={v => { setFade(Number(v)); blackout(); }} className="fade-choices">{[1000,2000,3000].map(ms => <label key={ms} className={`fade-option ${fade === ms ? 'active' : ''}`}><RadioGroupItem value={String(ms)} aria-label={`Fade after ${ms/1000} second${ms === 1000 ? '' : 's'}`}/><span>{ms/1000}s</span></label>)}</RadioGroup></div>
        <button className="blackout" onClick={blackout}><Moon size={16}/> Blackout <kbd>Esc</kbd></button>
      </div>
      </> : <GameBoard view={gameView} act={gameAction} blackout={blackout}/> }
      {detail && <div className="notice-bar" role="status">{detail}</div>}
    </section>
    <footer><span>Two people. Fading lights. No message history.</span><span className="keyboard-tip">Keyboard: arrows + Space to draw · Esc to clear</span></footer>
    <Dialog open={modal === 'invite'} onOpenChange={open => { if (!open) setModal(null); }}><DialogContent className="modal"><DialogTitle>A light on the other side.</DialogTitle><DialogDescription>Share this room link once. Whenever you both open it, you can draw together. Either person can arrive first. Save or bookmark it to come back.</DialogDescription>{invite ? <><label className="sr-only" htmlFor="invite-link">Private room link</label><input id="invite-link" value={invite} readOnly onFocus={e => e.currentTarget.select()} autoComplete="off" spellCheck={false}/><div className="modal-actions"><button className="primary" onClick={copy}>{copied ? 'Copied' : 'Copy room link'}{copied ? <Check size={18}/> : <Copy size={18}/>}</button>{shareable && <button className="secondary share-button" onClick={share}><Share2 size={17}/> Share</button>}</div><span role="status" className="fine">{copyError ? 'Select the link above and copy it manually.' : copied ? 'Room link copied. Keep it between you two.' : 'Reusable link. Two people at a time. No drawing history.'}</span><button className="quiet cancel-invite" onClick={() => { room.current?.end(); setModal(null); }}>Leave room</button><button className="quiet cancel-invite" onClick={() => begin()}>Create a different room</button></> : <p role="status">Creating your room link…</p>}</DialogContent></Dialog>
    <Dialog open={modal === 'privacy'} onOpenChange={open => { if (!open) setModal(null); }}><DialogContent className="modal privacy-modal"><DialogTitle>Here, then gone.</DialogTitle><DialogDescription>Afterglow keeps your drawings in the moment.</DialogDescription><div className="privacy-copy"><p><strong>No message history.</strong> Free-drawing lights live in browser memory for up to three seconds. Game boards stay lit for the round; the current game and chess rule state live only in browser memory and are cleared when you switch games, clear the board, leave, or switch apps. There’s no database, account, analytics, drawing log, local storage, or replay.</p><p><strong>Encrypted between you.</strong> Your room link contains a secret key after the # in the link. It never goes to the website server. The browsers authenticate each other with that key and encrypt every stroke. Every connection goes through our HTTPS relay. There are no direct peer connections, so the other participant does not receive your IP address. The relay forwards encrypted packets and cannot decrypt them with the information it receives.</p><p><strong>Just two people.</strong> Anyone with the full link can enter when a space is available. Only two people can connect at once. Extra browsers and devices count as people; close those pages or leave the room to free a spot. Opening the room in another tab of the same browser moves your connection there. Keep the link private; it stays in your address bar and may be saved in browser history or bookmarks. Create a different room for a new link.</p><p><strong>Fading is not screenshot protection.</strong> A glance may still catch a short word. Screenshots, video, a recipient, or a compromised device can capture visible lights. Use a one-second fade and Blackout for less exposure.</p><p><strong>Network metadata is different.</strong> The server and hosting provider can see your IP address and connection metadata. Afterglow does not record that information, but cannot guarantee that the provider logs nothing. The relay holds only encrypted packets in temporary memory; undelivered packets expire in under a second. Your room key and plaintext drawings are never sent to the relay.</p><p>Switching apps clears both boards and ends the game. Strokes sent while you’re away are discarded. If the connection breaks, the board clears and the browsers try to reconnect using the same link. Leaving stops your connection; the link remains reusable.</p></div></DialogContent></Dialog>
  </main>;
}
