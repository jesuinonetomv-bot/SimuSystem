export const PROFILE_PRESETS={
  constant:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  industrial:[.72,.68,.65,.64,.66,.74,.86,.94,.98,1,1.02,1.03,1.02,1,.99,1.01,1.06,1.12,1.08,1,.93,.86,.8,.76],
  commercial:[.35,.32,.3,.3,.32,.4,.58,.75,.88,.98,1.05,1.08,1.06,1.08,1.12,1.16,1.2,1.22,1.12,.95,.75,.58,.46,.39],
  residential:[.5,.44,.4,.38,.37,.4,.52,.66,.58,.5,.46,.44,.45,.47,.5,.58,.76,1.02,1.2,1.16,.98,.8,.66,.56],
  peak:[.55,.5,.47,.45,.46,.52,.64,.78,.88,.94,.98,1,1,.98,.96,1,1.08,1.18,1.25,1.18,1.02,.86,.72,.62],
  solar:[0,0,0,0,0,0,.05,.2,.45,.7,.9,1,1,.94,.78,.55,.3,.1,0,0,0,0,0,0]
};
export const profileLabel=name=>({constant:"Constante",industrial:"Industrial",commercial:"Comercial",residential:"Residencial",peak:"Ponta",solar:"Solar"})[name]||name;
function interpolate(values,minute){
  const h=((minute/60)%24+24)%24,i=Math.floor(h),f=h-i;
  return values[i]*(1-f)+values[(i+1)%24]*f;
}
export class TimeSeriesEngine{
  constructor({onTick}={}){
    this.mode="steady";
    this.running=false;
    this.minute=0;
    this.minutesPerSecond=15;
    this.onTick=onTick||(()=>{});
    this.timer=null;
  }
  setMode(mode){
    this.mode=mode==="time"?"time":"steady";
    if(this.mode==="steady")this.pause();
    this.emit();
  }
  setSpeed(value){this.minutesPerSecond=Math.max(1,Math.min(1440,Number(value)||15));this.emit()}
  setMinute(value){this.minute=((Number(value)||0)%1440+1440)%1440;this.emit()}
  play(){
    if(this.mode!=="time")this.mode="time";
    if(this.running)return;
    this.running=true;
    this.timer=setInterval(()=>{this.minute=(this.minute+this.minutesPerSecond)%1440;this.emit(true)},1000);
    this.emit();
  }
  pause(){this.running=false;if(this.timer){clearInterval(this.timer);this.timer=null}this.emit()}
  toggle(){this.running?this.pause():this.play()}
  reset(){this.pause();this.minute=0;this.emit()}
  factor(profile,amplitude=100){
    if(this.mode!=="time")return 1;
    const base=interpolate(PROFILE_PRESETS[profile]||PROFILE_PRESETS.constant,this.minute);
    const a=Math.max(0,Math.min(200,Number(amplitude)||100))/100;
    return Math.max(0,1+(base-1)*a);
  }
  apply(diagram){
    for(const o of Object.values(diagram?.items||{})){
      if(!["load","turbogenerator","capacitor"].includes(o.type)){delete o.runtimeScale;continue}
      const e=o.electrical||{};
      o.runtimeScale=this.factor(e.timeProfile||"constant",e.profileAmplitude??100);
    }
  }
  snapshot(){
    const h=Math.floor(this.minute/60),m=Math.floor(this.minute%60);
    return{mode:this.mode,running:this.running,minute:this.minute,time:String(h).padStart(2,"0")+":"+String(m).padStart(2,"0"),speed:this.minutesPerSecond};
  }
  emit(advanced=false){this.onTick(this.snapshot(),advanced)}
}
