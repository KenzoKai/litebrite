"use client";
import { useEffect, useRef, useState } from "react";
export const COLORS = ["#ffc45c", "#ff6f80", "#b79aff", "#72caff", "#86e0af", "#f4eee3"];
export const COLS=56, ROWS=36;
export type Stroke = { points:number[]; color:number; ttl:number };
type Peg = { color:number; born:number; ttl:number };
export default function Board({color,fade,clearVersion,onDraw,subscribe}:{color:number;fade:number;clearVersion:number;onDraw?:(s:Stroke)=>void;subscribe?:(fn:(s:Stroke)=>void)=>()=>void}) {
  const canvas=useRef<HTMLCanvasElement>(null), pegs=useRef(new Map<number,Peg>()), last=useRef<{x:number;y:number}|null>(null);
  const [touched,setTouched]=useState(false);
  const current=useRef({color,fade,onDraw});current.current={color,fade,onDraw};
  useEffect(()=>{pegs.current.clear();},[clearVersion]);
  useEffect(()=>subscribe?.(s=>{if(document.hidden)return;for(const p of s.points)pegs.current.set(p,{color:s.color,born:performance.now(),ttl:s.ttl});setTouched(true);}),[subscribe]);
  useEffect(()=>{
    const el=canvas.current!;const ctx=el.getContext("2d")!;let raf=0;
    const draw=()=>{const w=el.clientWidth,h=el.clientHeight,dpr=Math.min(devicePixelRatio||1,2);if(el.width!==Math.round(w*dpr)||el.height!==Math.round(h*dpr)){el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);const dx=w/COLS,dy=h/ROWS,r=Math.min(dx,dy)*.25,now=performance.now();for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const key=y*COLS+x,peg=pegs.current.get(key);let alpha=0;if(peg){const age=now-peg.born;if(age>=peg.ttl)pegs.current.delete(key);else alpha=Math.pow(1-age/peg.ttl,1.15);}ctx.beginPath();ctx.arc((x+.5)*dx,(y+.5)*dy,r,0,Math.PI*2);ctx.shadowBlur=alpha?14*alpha:0;ctx.shadowColor=peg?COLORS[peg.color]:"transparent";ctx.globalAlpha=alpha||1;ctx.fillStyle=alpha&&peg?COLORS[peg.color]:"#272b2d";ctx.fill();if(alpha&&peg){ctx.shadowBlur=0;ctx.globalAlpha=alpha*.8;ctx.fillStyle="#fff5dc";ctx.beginPath();ctx.arc((x+.5)*dx,(y+.5)*dy,r*.42,0,Math.PI*2);ctx.fill();}}ctx.globalAlpha=1;ctx.shadowBlur=0;raf=requestAnimationFrame(draw);};raf=requestAnimationFrame(draw);return()=>cancelAnimationFrame(raf);
  },[]);
  const light=(cx:number,cy:number)=>{const rect=canvas.current!.getBoundingClientRect();const x=Math.max(0,Math.min(COLS-1,Math.floor((cx-rect.left)/rect.width*COLS))),y=Math.max(0,Math.min(ROWS-1,Math.floor((cy-rect.top)/rect.height*ROWS)));const prev=last.current||{x,y};const steps=Math.max(Math.abs(x-prev.x),Math.abs(y-prev.y),1),points:number[]=[];for(let i=0;i<=steps;i++){const p=Math.round(prev.y+(y-prev.y)*i/steps)*COLS+Math.round(prev.x+(x-prev.x)*i/steps);if(!points.includes(p))points.push(p);}last.current={x,y};const s={points,color:current.current.color,ttl:current.current.fade};for(const p of points)pegs.current.set(p,{color:s.color,born:performance.now(),ttl:s.ttl});current.current.onDraw?.(s);setTouched(true);};
  return <><canvas ref={canvas} aria-label="Touch or drag to draw fading lights" onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);last.current=null;light(e.clientX,e.clientY);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))light(e.clientX,e.clientY);}} onPointerUp={()=>{last.current=null;}} onPointerCancel={()=>{last.current=null;}}/>{!touched&&<div className="board-hint"><span className="hint-spark">✦</span><span>Leave a little light.</span><small>Touch or drag anywhere to begin</small></div>}</>;
}
