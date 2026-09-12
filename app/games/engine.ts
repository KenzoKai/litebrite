import { Chess, type Square } from 'chess.js';

export type Mode = 'draw' | 'chess' | 'noughts' | 'blocks';
export type Action = { type: 'mode'; mode: Mode } | { type: 'chess'; from: string; to: string; promotion?: string } | { type: 'mark'; cell: number } | { type: 'block'; move: 'left' | 'right' | 'rotate' | 'down' | 'drop' | 'pause'; piece: number };
export type Blocks = { cells: number[]; shape: number; next: number; rotation: number; x: number; y: number; score: number; lines: number; piece: number; paused: boolean; over: boolean };
export type GameState = { mode: Mode; round: string; revision: number; fen?: string; turn?: number; result?: string; marks?: number[]; blocks?: Blocks };
const shapes = [
  [[0,1],[1,1],[2,1],[3,1]], [[1,0],[2,0],[1,1],[2,1]], [[1,0],[0,1],[1,1],[2,1]],
  [[1,0],[2,0],[0,1],[1,1]], [[0,0],[1,0],[1,1],[2,1]], [[0,0],[0,1],[1,1],[2,1]], [[2,0],[0,1],[1,1],[2,1]],
];
export function shapeCells(shape: number, rotation = 0): number[][] {
  let cells = shapes[shape].map(p => [...p]);
  if (shape === 1) return cells;
  const edge = shape === 0 ? 3 : 2;
  for (let i = 0; i < rotation; i++) cells = cells.map(([x,y]) => [edge-y,x]);
  return cells;
}
export function fits(b: Blocks, x = b.x, y = b.y, rotation = b.rotation) {
  return shapeCells(b.shape, rotation).every(([dx,dy]) => x+dx >= 0 && x+dx < 10 && y+dy >= 0 && y+dy < 20 && !b.cells[(y+dy)*10+x+dx]);
}
export function ghostY(b: Blocks) { let y=b.y; while (fits(b,b.x,y+1)) y++; return y; }
export class GameEngine {
  state: GameState = { mode:'draw',round:crypto.randomUUID(),revision:0 };
  private chess?: Chess;
  private bag: number[] = [];
  private nextShape() {
    if (!this.bag.length) {
      this.bag=[0,1,2,3,4,5,6];
      for(let i=6;i>0;i--) { const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1); [this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]]; }
    }
    return this.bag.pop()!;
  }
  start(mode: Mode) {
    this.chess=undefined; this.bag=[];
    this.state={mode,round:crypto.randomUUID(),revision:0};
    if(mode==='chess') { this.chess=new Chess(); this.chessState(); }
    if(mode==='noughts') Object.assign(this.state,{marks:Array(9).fill(-1),turn:0,result:''});
    if(mode==='blocks') this.state.blocks={cells:Array(200).fill(0),shape:this.nextShape(),next:this.nextShape(),rotation:0,x:3,y:0,score:0,lines:0,piece:0,paused:false,over:false};
  }
  private chessState() {
    const c=this.chess!;
    this.state.fen=c.fen(); this.state.turn=c.turn()==='w'?0:1;
    this.state.result=c.isCheckmate()?`${c.turn()==='w'?'Sky / Black':'Amber / White'} wins by checkmate.`:c.isStalemate()?'Draw by stalemate.':c.isThreefoldRepetition()?'Draw by repetition.':c.isInsufficientMaterial()?'Draw: insufficient material.':c.isDraw()?'Draw by the fifty-move rule.':c.isCheck()?'Check.':'';
  }
  act(action: Action, side: number, shared: boolean): boolean {
    if(action.type==='mode') {
      if(!['draw','chess','noughts','blocks'].includes(action.mode))return false;
      this.start(action.mode);return true;
    }
    if(this.state.mode==='chess' && action.type==='chess' && this.chess && !this.chess.isGameOver()) {
      if(shared && side!==this.state.turn)return false;
      if(!/^[a-h][1-8]$/.test(action.from)||!/^[a-h][1-8]$/.test(action.to)||!['q','r','b','n'].includes(action.promotion||'q'))return false;
      try { this.chess.move({from:action.from,to:action.to,promotion:action.promotion||'q'}); } catch { return false; }
      this.chessState();this.state.revision++;return true;
    }
    if(this.state.mode==='noughts' && action.type==='mark' && !this.state.result) {
      const {marks,turn}=this.state;
      if(!Number.isInteger(action.cell)||action.cell<0||action.cell>8||marks![action.cell]!==-1||(shared&&side!==turn))return false;
      marks![action.cell]=turn!;
      const win=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]].some(line=>line.every(i=>marks![i]===turn));
      this.state.result=win?`${turn===0?'Amber / X':'Sky / O'} wins.`:marks!.every(v=>v!==-1)?'A draw. Try another round.':'';
      this.state.turn=1-turn!;this.state.revision++;return true;
    }
    const b=this.state.blocks;
    if(this.state.mode==='blocks'&&action.type==='block'&&b&&!b.over&&action.piece===b.piece) {
      if(action.move==='pause')b.paused=!b.paused;
      else if(b.paused)return false;
      else if(action.move==='left'||action.move==='right') { const x=b.x+(action.move==='left'?-1:1);if(!fits(b,x))return false;b.x=x; }
      else if(action.move==='rotate') { const r=(b.rotation+1)%4;const kick=[0,-1,1,-2,2].find(dx=>fits(b,b.x+dx,b.y,r));if(kick===undefined)return false;b.x+=kick;b.rotation=r; }
      else if(action.move==='down') { if(fits(b,b.x,b.y+1)){b.y++;b.score++;}else this.lock(); }
      else if(action.move==='drop') { const y=ghostY(b);b.score+=(y-b.y)*2;b.y=y;this.lock(); }
      else return false;
      this.state.revision++;return true;
    }
    return false;
  }
  private lock() {
    const b=this.state.blocks!;
    for(const [dx,dy] of shapeCells(b.shape,b.rotation))b.cells[(b.y+dy)*10+b.x+dx]=b.shape+1;
    const rows=Array.from({length:20},(_,i)=>b.cells.slice(i*10,i*10+10)).filter(row=>row.some(v=>!v));
    const count=20-rows.length;b.lines+=count;b.score+=[0,100,300,500,800][count];
    b.cells=[...Array(count*10).fill(0),...rows.flat()];
    b.shape=b.next;b.next=this.nextShape();b.rotation=0;b.x=3;b.y=0;b.piece++;
    b.over=!fits(b);
  }
  tick() {
    const b=this.state.blocks;
    if(this.state.mode!=='blocks'||!b||b.over||b.paused)return false;
    if(fits(b,b.x,b.y+1))b.y++;else this.lock();
    this.state.revision++;return true;
  }
  snapshot(): GameState { return structuredClone(this.state); }
}
export function chessPosition(fen: string) { return new Chess(fen); }
export function legalTargets(fen: string, from: string) { return new Chess(fen).moves({square:from as Square,verbose:true}).map(m=>m.to); }
export function validState(value: unknown): value is GameState {
  if(!value||typeof value!=='object')return false;
  const s=value as GameState;
  if(!['draw','chess','noughts','blocks'].includes(s.mode)||typeof s.round!=='string'||s.round.length>40||!Number.isSafeInteger(s.revision)||s.revision<0)return false;
  if(s.mode==='chess') { try { if(typeof s.fen!=='string'||s.fen.length>150||typeof s.result!=='string'||s.result.length>100||![0,1].includes(s.turn!))return false;new Chess(s.fen); }catch{return false;} }
  if(s.mode==='noughts'&&(!Array.isArray(s.marks)||s.marks.length!==9||!s.marks.every(v=>[-1,0,1].includes(v))||![0,1].includes(s.turn!)||typeof s.result!=='string'||s.result.length>100))return false;
  if(s.mode==='blocks') {
    const b=s.blocks;if(!b||!Array.isArray(b.cells)||b.cells.length!==200||!b.cells.every(v=>Number.isInteger(v)&&v>=0&&v<=7))return false;
    if(![b.shape,b.next,b.rotation,b.x,b.y,b.score,b.lines,b.piece].every(Number.isSafeInteger)||b.shape<0||b.shape>6||b.next<0||b.next>6||b.rotation<0||b.rotation>3||b.x< -3||b.x>9||b.y<0||b.y>19||b.score<0||b.lines<0||b.piece<0||typeof b.paused!=='boolean'||typeof b.over!=='boolean')return false;
  }
  return true;
}
