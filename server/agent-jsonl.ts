import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

/** LF framing deliberately preserves Unicode U+2028/U+2029 inside JSON strings. */
export class JsonLines {
  private buffer='';
  private decoder=new StringDecoder('utf8');
  constructor(private receive:(message:any)=>void,private maxBytes=8*1024*1024){}
  push(bytes:Buffer){
    this.buffer+=this.decoder.write(bytes);
    if(Buffer.byteLength(this.buffer)>this.maxBytes)throw new Error('Agent protocol frame exceeded its limit.');
    let newline:number;
    while((newline=this.buffer.indexOf('\n'))>=0){
      const line=this.buffer.slice(0,newline).replace(/\r$/,'');this.buffer=this.buffer.slice(newline+1);
      if(line.trim())this.receive(JSON.parse(line));
    }
  }
}
export class AgentProcess {
  readonly child:ChildProcessWithoutNullStreams;
  private sequence=0;
  private pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  onMessage:(message:any)=>void=()=>{};
  onExit:(error:Error)=>void=()=>{};
  private closed=false;
  private terminalError?:Error;
  private closing?:Promise<void>;
  constructor(command:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,framed=true){
    this.child=spawn(command,args,{cwd,env,stdio:'pipe',shell:false,detached:process.platform!=='win32'});
    const decoder=new JsonLines(message=>{
      const key=String(message.id), request=this.pending.get(key);
      if(request&&('result' in message||'error' in message||message.type==='response')){
        clearTimeout(request.timer);this.pending.delete(key);
        if(message.error||message.success===false)request.reject(new Error('Agent protocol request failed.'));
        else request.resolve(message.result??message.data??{});
      }else this.onMessage(message);
    });
    if(framed)this.child.stdout.on('data',chunk=>{try{decoder.push(chunk);}catch(error){this.fail(error instanceof Error?error:new Error('Invalid protocol data.'));void this.close();}});
    // Drain diagnostics to prevent a blocked subprocess; never persist raw stderr/credentials.
    this.child.stderr.on('data',()=>{});
    this.child.stdin.on('error',error=>this.fail(error));
    this.child.on('error',error=>this.fail(error));
    this.child.on('exit',()=>this.fail(new Error('Agent process exited.')));
  }
  private fail(error:Error){this.terminalError=error;for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error);}this.pending.clear();this.onExit(error);}
  write(message:unknown){if(this.closed||this.terminalError||!this.child.stdin.writable)throw new Error('Agent process is closed.');this.child.stdin.write(JSON.stringify(message)+'\n');}
  request(method:string,params:unknown={},pi=false,timeoutMs=120000):Promise<any>{
    const id=String(++this.sequence);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Agent request timed out.'));},timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.write(pi?{id,type:method,...params as object}:{id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  reply(id:string|number,result:unknown){this.write({id,result});}
  close():Promise<void>{
    return this.closing??=this.terminate();
  }
  private async terminate(){
    this.closed=true;
    this.child.stdin.end();
    if(!this.child.pid||this.child.exitCode!==null||this.child.signalCode!==null)return;
    const kill=(signal:NodeJS.Signals)=>{try{if(process.platform!=='win32'&&this.child.pid)process.kill(-this.child.pid,signal);else this.child.kill(signal);}catch{}};
    let done!:()=>void;
    const exited=new Promise<void>(resolve=>{done=resolve;this.child.once('exit',resolve);});
    kill('SIGTERM');
    const timer=setTimeout(()=>{kill('SIGKILL');done();},2000);
    await exited;clearTimeout(timer);this.child.removeListener('exit',done);
  }
}
