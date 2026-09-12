"use client";
import { useEffect, useRef, useState } from 'react';
import { Hand, Pencil, Minus, Plus, Scan } from 'lucide-react';
import { COLS, ROWS, INITIAL_VIEW, constrainView, transform, cellAt, zoomAt, lineCells, type Size } from './board-geometry';
export { COLS, ROWS } from './board-geometry';
export const COLORS = ['#ffc45c', '#ff6f80', '#b79aff', '#72caff', '#86e0af', '#f4eee3'];
export type Stroke = { points: number[]; color: number; ttl: number };
type Peg = { color: number; born: number; ttl: number };
type Point = { x: number; y: number };
export default function Board({ color, fade, clearVersion, onDraw, subscribe }: {
  color: number; fade: number; clearVersion: number;
  onDraw?: (s: Stroke) => void; subscribe?: (fn: (s: Stroke) => void) => () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pegs = useRef(new Map<number, Peg>());
  const last = useRef<Point | null>(null);
  const size = useRef<Size>({ width: 1, height: 1 });
  const view = useRef({ ...INITIAL_VIEW });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef(false);
  const nativeTouch = useRef(false);
  const touchInput = useRef<(event: TouchEvent) => void>(() => undefined);
  const cursor = useRef({ x: 28, y: 18 });
  const focused = useRef(false);
  const invalidate = useRef<() => void>(() => undefined);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(false);
  const [touched, setTouched] = useState(false);
  const current = useRef({ color, fade, onDraw, pan });
  current.current = { color, fade, onDraw, pan };

  function resetGesture() { pointers.current.clear(); last.current = null; gesture.current = false; }
  function refreshView() { view.current = constrainView(view.current, size.current); setZoom(view.current.zoom); invalidate.current(); }
  function fit() { view.current = { ...INITIAL_VIEW }; resetGesture(); setPan(false); refreshView(); }
  function zoomBy(factor: number) { view.current = zoomAt(view.current.zoom * factor, size.current.width / 2, size.current.height / 2, size.current, view.current); last.current = null; refreshView(); }

  useEffect(() => { pegs.current.clear(); last.current = null; invalidate.current(); }, [clearVersion]);
  useEffect(() => subscribe?.(s => {
    if (document.hidden) return;
    for (const p of s.points) pegs.current.set(p, { color: s.color, born: performance.now(), ttl: s.ttl });
    setTouched(true); invalidate.current();
  }), [subscribe]);
  useEffect(() => {
    const el = canvas.current!, ctx = el.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const { width: w, height: h } = size.current;
      // High-density rendering is separate from pointer coordinates; bound raster memory on very large displays.
      const dpr = Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(8_000_000 / (w * h)));
      const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
      if (el.width !== bw || el.height !== bh) { el.width = bw; el.height = bh; }
      ctx.setTransform(bw / w, 0, 0, bh / h, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { scale, left, top } = transform(size.current, view.current);
      ctx.fillStyle = '#101516'; ctx.fillRect(left, top, COLS * scale, ROWS * scale);
      ctx.strokeStyle = '#38413d'; ctx.lineWidth = 1;
      ctx.strokeRect(left + .5, top + .5, COLS * scale - 1, ROWS * scale - 1);
      const now = performance.now(), r = Math.max(1, scale * .22);
      for (const [key, peg] of pegs.current) if (now - peg.born >= peg.ttl) pegs.current.delete(key);
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        const px = left + (x + .5) * scale, py = top + (y + .5) * scale;
        if (px < -r || px > w + r || py < -r || py > h + r) continue;
        const peg = pegs.current.get(y * COLS + x);
        const alpha = peg ? Math.pow(Math.max(0, 1 - (now - peg.born) / peg.ttl), 1.15) : 0;
        ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.fillStyle = '#2b3332';
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        if (peg) {
          ctx.globalAlpha = alpha; ctx.shadowBlur = Math.min(22, scale * 1.2) * alpha;
          ctx.shadowColor = COLORS[peg.color]; ctx.fillStyle = COLORS[peg.color]; ctx.fill();
          ctx.shadowBlur = 0; ctx.fillStyle = '#fff3da'; ctx.globalAlpha = alpha * .85;
          ctx.beginPath(); ctx.arc(px, py, r * .45, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      if (focused.current) {
        ctx.strokeStyle = '#d7c597'; ctx.lineWidth = 1.5;
        ctx.strokeRect(left + cursor.current.x * scale, top + cursor.current.y * scale, scale, scale);
      }
      if (pegs.current.size) raf = requestAnimationFrame(draw);
    };
    invalidate.current = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const resize = () => {
      const rect = el.getBoundingClientRect();
      size.current = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      view.current = constrainView(view.current, size.current);
      last.current = null;
      invalidate.current();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    // One authoritative finger stream: native touch survives loss of pointer capture.
    nativeTouch.current = typeof window.TouchEvent !== 'undefined';
    const handleTouch = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
      if (event.changedTouches) touchInput.current(event);
    };
    const touchEvents = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
    for (const type of touchEvents) el.addEventListener(type, handleTouch, { passive: false });
    // ResizeObserver does not always fire when moving a window between screens of equal CSS size.
    let density = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    const changedDensity = () => { density.removeEventListener('change', changedDensity); density = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); density.addEventListener('change', changedDensity); resize(); };
    density.addEventListener('change', changedDensity);
    window.addEventListener('resize', resize);
    const visibility = () => { if (document.hidden) { pegs.current.clear(); pointers.current.clear(); last.current = null; } invalidate.current(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { for (const type of touchEvents) el.removeEventListener(type, handleTouch); observer.disconnect(); cancelAnimationFrame(raf); invalidate.current = () => undefined; density.removeEventListener('change', changedDensity); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  function put(points: number[]) {
    const stroke = { points, color: current.current.color, ttl: current.current.fade };
    for (const p of points) pegs.current.set(p, { color: stroke.color, born: performance.now(), ttl: stroke.ttl });
    current.current.onDraw?.(stroke); setTouched(true); invalidate.current();
  }
  function light(p: Point) {
    const cell = cellAt(p.x, p.y, size.current, view.current);
    if (!cell) { last.current = null; return; } // Letterbox space never becomes an edge stroke.
    put(lineCells(last.current || cell, cell)); last.current = cell;
  }
  function position(e: { clientX: number; clientY: number }) {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function startPointer(id: number, p: Point) {
    focused.current = false;
    pointers.current.set(id, p); last.current = null;
    gesture.current = pointers.current.size > 1;
    if (!current.current.pan && !gesture.current) light(p);
  }
  function movePointer(id: number, p: Point) {
    const old = pointers.current.get(id); if (!old) return;
    const before = [...pointers.current.values()];
    pointers.current.set(id, p);
    if (pointers.current.size === 2) {
      const after = [...pointers.current.values()];
      const mid = (a: Point[]) => ({ x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 });
      const dist = (a: Point[]) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      const a = mid(before), b = mid(after);
      if (dist(before) > 5) view.current = zoomAt(view.current.zoom * dist(after) / dist(before), a.x, a.y, size.current, view.current);
      const scale = transform(size.current, view.current).scale;
      view.current.x -= (b.x - a.x) / scale; view.current.y -= (b.y - a.y) / scale;
      last.current = null; refreshView(); return;
    }
    if (current.current.pan) {
      const scale = transform(size.current, view.current).scale;
      view.current.x -= (p.x - old.x) / scale; view.current.y -= (p.y - old.y) / scale;
      refreshView();
    } else if (!gesture.current) light(p);
  }
  function release(id: number) {
    pointers.current.delete(id); last.current = null;
    gesture.current = pointers.current.size > 1;
  }
  touchInput.current = event => {
    if (document.hidden) return;
    for (const touch of Array.from(event.changedTouches)) {
      // Safari also emits Touch Events for Pencil input, already handled as a pen.
      if ((touch as Touch & { touchType?: string }).touchType === 'stylus' && window.PointerEvent) continue;
      // Keep touch identifiers separate from mouse/pen pointer identifiers.
      const id = -touch.identifier - 1;
      if (event.type === 'touchstart') startPointer(id, position(touch));
      else if (event.type === 'touchmove') movePointer(id, position(touch));
      else release(id);
    }
  };
  return <>
    <div className="canvas-shell">
      <canvas ref={canvas} tabIndex={0} aria-label="Shared light board. Touch or drag to draw. Use arrow keys to move and Space to light a peg. Pinch with two fingers to zoom."
        className={pan ? 'pan-mode' : ''}
        onContextMenu={e => e.preventDefault()}
        onFocus={() => { focused.current = true; invalidate.current(); }}
        onBlur={() => { focused.current = false; if (![...pointers.current.keys()].some(id => id < 0)) resetGesture(); invalidate.current(); }}
        onPointerDown={e => {
          if (e.button !== 0 || (e.pointerType === 'touch' && nativeTouch.current)) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          startPointer(e.pointerId, position(e));
        }}
        onPointerMove={e => {
          if (e.pointerType === 'touch' && nativeTouch.current) return;
          const samples = e.nativeEvent.getCoalescedEvents?.();
          if (samples?.length) for (const sample of samples) movePointer(e.pointerId, position(sample));
          else movePointer(e.pointerId, position(e));
        }}
        onPointerUp={e => { if (e.pointerType !== 'touch' || !nativeTouch.current) release(e.pointerId); }} onPointerCancel={e => { if (e.pointerType !== 'touch' || !nativeTouch.current) release(e.pointerId); }} onLostPointerCapture={e => { if (e.pointerType !== 'touch' || !nativeTouch.current) release(e.pointerId); }}
        onKeyDown={e => {
          const delta: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
          if (delta[e.key]) { e.preventDefault(); focused.current = true; cursor.current = { x: Math.max(0, Math.min(COLS - 1, cursor.current.x + delta[e.key].x)), y: Math.max(0, Math.min(ROWS - 1, cursor.current.y + delta[e.key].y)) }; if (e.shiftKey) put([cursor.current.y * COLS + cursor.current.x]); else invalidate.current(); }
          else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); put([cursor.current.y * COLS + cursor.current.x]); }
          else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.5); }
          else if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.5); }
          else if (e.key === '0') { e.preventDefault(); fit(); }
        }}
      />
      {!touched && <div className="board-hint"><span className="hint-spark">✦</span><span>Leave a little light.</span><small>Draw with your finger, pen, or mouse.</small></div>}
    </div>
    <div className="view-controls" aria-label="Board view controls">
      <div className="tool-group"><button className={!pan ? 'view-button active' : 'view-button'} aria-pressed={!pan} onClick={() => { setPan(false); resetGesture(); }}><Pencil size={17}/>Draw</button><button className={pan ? 'view-button active' : 'view-button'} aria-pressed={pan} onClick={() => { setPan(true); resetGesture(); }}><Hand size={17}/>Move</button></div>
      <span className="view-help">{pan ? 'Drag to move your view' : 'Pinch to zoom · same board on every screen'}</span>
      <div className="tool-group zoom-tools"><button className="view-button icon-button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => zoomBy(1 / 1.5)}><Minus size={17}/></button><output aria-label="Board zoom">{Math.round(zoom * 100)}%</output><button className="view-button icon-button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => zoomBy(1.5)}><Plus size={17}/></button><button className="view-button" onClick={fit}><Scan size={17}/>Fit</button></div>
    </div>
  </>;
}
