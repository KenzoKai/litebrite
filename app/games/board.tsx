import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ChevronsDown, RotateCw, Pause, Play, RotateCcw, Moon } from 'lucide-react';
import { chessPosition, ghostY, legalTargets, shapeCells, type Action, type GameState, type Blocks } from './engine';
import type { GameView } from './session';

const names: Record<string,string>={p:'pawn',r:'rook',n:'knight',b:'bishop',q:'queen',k:'king'};
const glyphs: Record<string,string[]>={
 p:['0000000','0011100','0011100','0001000','0011100','0111110','1111111'],
 r:['1010101','1111111','0111110','0011100','0011100','0111110','1111111'],
 n:['0001100','0111110','1110110','1100110','0001110','0011110','1111111'],
 b:['0001000','0011100','0110110','0111100','0011100','0111110','1111111'],
 q:['1001001','1101011','0111110','0011100','0011100','0111110','1111111'],
 k:['0001000','0011100','0001000','0111110','0011100','0111110','1111111'],
 x:['1000001','0100010','0010100','0001000','0010100','0100010','1000001'],
 o:['0011100','0100010','1000001','1000001','1000001','0100010','0011100'],
};
function PegIcon({type}:{type:string}) {
  return <svg className="peg-icon" viewBox="0 0 9 9" aria-hidden="true">{glyphs[type].flatMap((row,y)=>[...row].map((v,x)=>v==='1'?<circle key={`${x}-${y}`} cx={x+1.5} cy={y+1.5} r=".38" fill="currentColor"/>:null))}</svg>;
}
function ChessBoard({game,side,shared,pending,act}:{game:GameState;side:number;shared:boolean;pending:boolean;act:(a:Action)=>void}) {
  const [selected,setSelected]=useState('');
  const [promotion,setPromotion]=useState('');
  const chess=useMemo(()=>chessPosition(game.fen!),[game.fen]);
  const targets=useMemo(()=>selected?legalTargets(game.fen!,selected):[],[game.fen,selected]);
  const myTurn=!shared||side===game.turn;
  const over=chess.isGameOver()||!!game.result?.startsWith('Draw');
  const squares=chess.board().flat();
  const files=side===1&&shared?'hgfedcba':'abcdefgh';
  const ranks=side===1&&shared?'12345678':'87654321';
  const choose=(square:string)=>{
    if(!myTurn||pending||over)return;
    if(selected && targets.includes(square as typeof targets[number])) {
      const piece=chess.get(selected as Parameters<typeof chess.get>[0]);
      if(piece?.type==='p'&&/[18]$/.test(square)){setPromotion(square);return;}
      act({type:'chess',from:selected,to:square});setSelected('');
    }else { const piece=squares.find(p=>p?.square===square);setSelected(piece&&piece.color===chess.turn()?square:''); }
  };
  return <>
    <div className="game-instructions">{shared?`You are ${side===0?'Amber / White':'Sky / Black'}. `:'Practice: play both sides. '}{over?'Start a new round to play again.':'Tap a piece, then a glowing destination.'}</div>
    {promotion&&<div className="promotion" role="group" aria-label="Choose promotion"><span>Promote pawn to</span>{['q','r','b','n'].map(p=><button className="secondary" key={p} onClick={()=>{act({type:'chess',from:selected,to:promotion,promotion:p});setPromotion('');setSelected('');}}>{names[p]}</button>)}</div>}
    <div className="chess-grid" role="group" aria-label="Chess board">
      {[...ranks].flatMap((rank,y)=>[...files].map((file,x)=>{
        const square=file+rank,piece=squares.find(p=>p?.square===square);
        const target=targets.includes(square as typeof targets[number]);
        return <button key={square} data-square={square} className={`chess-cell ${(x+y)%2?'dark':'light'} ${selected===square?'chosen':''} ${target?'legal':''} ${piece?.color==='b'?'sky':'amber'}`} aria-label={`${square}${piece?` ${piece.color==='w'?'White':'Black'} ${names[piece.type]}`:' empty'}${target?' legal move':''}`} aria-pressed={selected===square} onClick={()=>choose(square)} disabled={!myTurn||pending||over}>
          {piece&&<PegIcon type={piece.type}/>}{!piece&&target&&<span className="move-dot"/>}<small>{square}</small>
        </button>;
      }))}
    </div>
    <div className="piece-key" aria-label="Chess piece key">{['k','q','r','b','n','p'].map(p=><span key={p}><PegIcon type={p}/>{names[p]}</span>)}</div>
  </>;
}
function BlocksBoard({b,act}:{b:Blocks;act:(a:Action)=>void}) {
  const send=(move:Extract<Action,{type:'block'}>['move'])=>act({type:'block',move,piece:b.piece});
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(e.target instanceof HTMLElement && (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || (e.key===' ' && e.target.closest('button,a'))))return;
      const move:Record<string,Extract<Action,{type:'block'}>['move']>={ArrowLeft:'left',ArrowRight:'right',ArrowDown:'down',ArrowUp:'rotate',' ':'drop',p:'pause',P:'pause'};
      if(move[e.key]){e.preventDefault();act({type:'block',move:move[e.key],piece:b.piece});}
    };
    window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);
  },[act,b.piece]);
  const active=shapeCells(b.shape,b.rotation),ghost=ghostY(b);
  const colors=['#2b3332','#72caff','#ffc45c','#b79aff','#86e0af','#ff6f80','#7794ff','#ffaa6c'];
  return <>
    <p className="game-instructions">Work together on one stack. Fill a row to clear it. Either person can move, rotate, or drop.</p>
    <div className="blocks-layout">
      <svg className="blocks-grid" viewBox="0 0 100 200" role="img" aria-label={`Falling blocks board, ${b.lines} lines cleared, score ${b.score}`}>
        {b.cells.map((v,i)=>{const x=i%10,y=Math.floor(i/10);const live=!b.over&&active.some(([dx,dy])=>x===b.x+dx&&y===b.y+dy);const preview=!b.over&&active.some(([dx,dy])=>x===b.x+dx&&y===ghost+dy);return <g key={i}><rect x={x*10+.7} y={y*10+.7} width="8.6" height="8.6" rx="1" fill={colors[live?b.shape+1:v]} opacity={live||v?1:preview?.35:.25}/>{(v||live)?<circle cx={x*10+5} cy={y*10+5} r="2.5" fill="#fff8db" opacity=".55"/>:preview?<rect x={x*10+1} y={y*10+1} width="8" height="8" rx="1" fill="none" stroke={colors[b.shape+1]} strokeWidth=".7"/>:null}</g>;})}
        {(b.paused||b.over)&&<><rect y="79" width="100" height="42" fill="#0b1211" opacity=".94"/><text x="50" y="104" textAnchor="middle" fontSize="9" fill="#f3d8a6">{b.over?'STACK COMPLETE':'PAUSED'}</text></>}
      </svg>
      <div className="blocks-sidebar"><span className="small-label">SCORE</span><strong>{b.score}</strong><span className="small-label">LINES</span><strong>{b.lines}</strong><span className="small-label">NEXT</span><svg viewBox="0 0 40 40" aria-label="Next piece" role="img">{shapeCells(b.next).map(([x,y])=><rect key={`${x}-${y}`} x={x*10+1} y={y*10+1} width="8" height="8" rx="2" fill={colors[b.next+1]}/>)}</svg><button className="secondary" onClick={()=>send('pause')} disabled={b.over} aria-label={b.paused?'Resume blocks':'Pause blocks'}>{b.paused?<Play size={18}/>:<Pause size={18}/>}<span>{b.paused?'Resume':'Pause'}</span></button></div>
    </div>
    <div className="block-controls" role="group" aria-label="Falling block controls">{(['left','rotate','right','down','drop'] as const).map(move=>{
      const Icon={left:ArrowLeft,right:ArrowRight,rotate:RotateCw,down:ArrowDown,drop:ChevronsDown}[move];
      return <button key={move} className="secondary" disabled={b.paused||b.over} onClick={()=>send(move)} aria-label={`${move[0].toUpperCase()+move.slice(1)} block`}><Icon size={22}/><span>{move==='drop'?'Drop':move==='rotate'?'Rotate':move==='down'?'Down':move==='left'?'Left':'Right'}</span></button>;
    })}</div><p className="game-instructions keyboard-game">Keyboard: ← → move · ↑ rotate · ↓ lower · Space drop · P pause</p>
  </>;
}
export default function GameBoard({view,act,blackout}:{view:GameView;act:(a:Action)=>void;blackout:()=>void}) {
  const {game,shared,side,pending}=view;
  const title={draw:'Free drawing',chess:'Chess',noughts:'Tic-tac-toe',blocks:'Falling lights'}[game.mode];
  const turn=game.mode==='chess'?`${game.turn===0?'Amber / White':'Sky / Black'} to move`:`${game.turn===0?'Amber / X':'Sky / O'} to play`;
  const status=game.mode==='blocks'?game.blocks!.over?'Game over — start a new stack.':game.blocks!.paused?'Paused':'One board. One shared score.':game.result||turn;
  return <div className={`game-shell game-${game.mode}`}>
    <div className="game-heading"><div><h2>{title}</h2><p role="status" className="game-status">{status}{pending?' · Sending…':''}</p></div><button className="secondary" disabled={pending} onClick={()=>act({type:'mode',mode:game.mode})}><RotateCcw size={16}/>New round</button></div>
    {game.mode==='chess'&&<ChessBoard key={game.round+game.revision} game={game} side={side} shared={shared} pending={pending} act={act}/>}
    {game.mode==='noughts'&&<><p className="game-instructions">{shared?`You are ${side===0?'Amber / X':'Sky / O'}.`:'Practice: take turns on this screen.'} Get three lights in a row.</p><div className="noughts-grid" role="group" aria-label="Tic-tac-toe board">{game.marks!.map((mark,i)=><button key={i} className={mark===1?'sky':'amber'} aria-label={`Cell ${i+1}${mark===-1?' empty':mark===0?' X':' O'}`} disabled={mark!==-1||!!game.result||pending||(shared&&side!==game.turn)} onClick={()=>act({type:'mark',cell:i})}>{mark!==-1&&<PegIcon type={mark===0?'x':'o'}/>}</button>)}</div></>}
    {game.mode==='blocks'&&<BlocksBoard b={game.blocks!} act={act}/>}
    <div className="game-footer"><span>Game lights stay on during the round. Nothing is saved.</span><button className="blackout" onClick={blackout}><Moon size={16}/>Clear game</button></div>
  </div>;
}
