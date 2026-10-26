import { publicWish } from './wishApi.js';
// Page-sized queue, bounded dedupe history and a fixed lantern fleet: no 100+ node wall.
export class WishFeed {
  constructor(api,signal){this.api=api;this.signal=signal;this.queue=[];this.cursor=null;this.started=false;this.total=null;this.serial=Promise.resolve();}
  async page(){
    const result=await this.api.list({cursor:this.cursor,limit:40,signal:this.signal});
    this.queue=(result.wishes||[]).map(publicWish).filter(Boolean).slice(0,80);
    this.cursor=result.nextCursor??null;this.started=true;this.total=result.total??null;
  }
  async init(){await this.page();return this.queue.length;}
  take(excluded=new Set()){
    const run=this.serial.then(async()=>{
      // Two page reads maximum per request; a broken cursor cannot loop forever.
      for(let attempts=0;attempts<3;attempts++){
        while(this.queue.length){const w=this.queue.shift();if(!(typeof excluded==='function'?excluded():excluded).has(w.id))return w;}
        if(attempts<2)await this.page();
      }
      return null;
    });this.serial=run.catch(()=>{});return run;
  }
}
