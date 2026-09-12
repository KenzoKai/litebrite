import { GameEngine, validState, type Action, type GameState } from './engine';

type Command = { type:'command'; id:number; round:string; revision:number; action:Action };
export type GameView = { game:GameState; shared:boolean; side:number; pending:boolean };
/** One elected browser owns rules and gravity. Commands retry until acknowledged;
 * only the latest state is broadcast, with no server-side game history. */
export class GameSession {
  private engine = new GameEngine();
  private shared = false;
  private leader = true;
  private ack = 0;
  private nextId = 0;
  private queue: Command[] = [];
  private send: (data:unknown)=>void = ()=>{};
  private listeners = new Set<()=>void>();
  private lastTick = 0;
  private timer?: ReturnType<typeof setInterval>;
  private view: GameView = {game:this.engine.snapshot(),shared:false,side:0,pending:false};
  subscribe = (listener:()=>void) => { this.listeners.add(listener);return ()=>{this.listeners.delete(listener);}; };
  getSnapshot = () => this.view;
  private publish(game = this.engine.snapshot()) {
    this.view={game,shared:this.shared,side:this.leader?0:1,pending:this.queue.length>0};
    this.listeners.forEach(fn=>fn());
  }
  startTimer() {
    if(this.timer)return;
    this.timer=setInterval(()=>this.pulse(),150);
  }
  stopTimer() { clearInterval(this.timer);this.timer=undefined; }
  connect(leader:boolean, send:(data:unknown)=>void) {
    this.shared=true;this.leader=leader;this.send=send;this.reset();
  }
  disconnect() { this.shared=false;this.leader=true;this.send=()=>{};this.reset(); }
  reset() { this.engine.start('draw');this.queue=[];this.ack=0;this.nextId=0;this.lastTick=performance.now();this.publish(); }
  private broadcast() {
    if(!this.shared)return;
    if(this.leader)this.send({type:'snapshot',ack:this.ack,state:this.engine.snapshot()});
    else if(this.queue[0])this.send(this.queue[0]);
  }
  pulse() {
    if(typeof document!=='undefined'&&document.hidden)return;
    const b=this.engine.state.blocks;
    const interval=b?Math.max(180,800-Math.floor(b.lines/5)*70):800;
    if(this.leader&&performance.now()-this.lastTick>=interval) {
      this.lastTick=performance.now();
      if(this.engine.tick())this.publish();
    }
    this.broadcast();
  }
  action(action:Action) {
    if(this.shared&&!this.leader) {
      if(this.queue.length>=8)return;
      this.queue.push({type:'command',id:++this.nextId,round:this.view.game.round,revision:this.view.game.revision,action});
      this.publish(this.view.game);
    } else if(this.engine.act(action,0,this.shared)) { if(action.type==='mode')this.lastTick=performance.now();this.publish(); }
    this.broadcast();
  }
  receive(value:unknown) {
    if(!this.shared||!value||typeof value!=='object')return;
    const msg=value as {type?:string;id?:number;round?:string;revision?:number;action?:Action;ack?:number;state?:unknown};
    if(this.leader && msg.type==='command') {
      if(!Number.isSafeInteger(msg.id)||msg.id!<=this.ack||msg.id!==this.ack+1||!msg.action||typeof msg.action!=='object')return;
      this.ack=msg.id;
      if((msg.round===this.engine.state.round || (msg.action.type==='mode'&&this.engine.state.mode==='draw')) && (msg.action.type==='mode'||msg.action.type==='block'||msg.revision===this.engine.state.revision)) {
        if(this.engine.act(msg.action,1,true)) {if(msg.action.type==='mode')this.lastTick=performance.now();this.publish();}
      }
      this.broadcast();
    } else if(!this.leader && msg.type==='snapshot' && validState(msg.state) && Number.isSafeInteger(msg.ack) && msg.ack!>=0 && msg.ack!<=this.nextId) {
      if(msg.state.round===this.view.game.round&&msg.state.revision<this.view.game.revision)return;
      const changed=msg.state.round!==this.view.game.round||msg.state.revision!==this.view.game.revision;
      const before=this.queue.length;
      this.queue=this.queue.filter(command=>command.id>msg.ack!);
      if(changed||before!==this.queue.length)this.publish(msg.state);
      if(this.queue.length)this.broadcast();
    }
  }
}
