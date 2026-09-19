const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export class GridDynamics{
  constructor(){this.states=new Map()}
  reset(){this.states.clear()}
  step({key,mode="rigid",nominalHz=60,demandMW=0,demandMvar=0,setpointMW=0,ratedMVA=100,maxImportMW=100,maxExportMW=100,maxReactiveMvar=100,minReactiveMvar=-100,inertiaSeconds=6,droopPercent=5,dampingMWPerHz=2,voltageSetpointPU=1,shortCircuitMVA=1000,dtSeconds=1}){
    const f0=Number(nominalHz)||60;
    const pMin=-Math.abs(Number(maxExportMW)||0),pMax=Math.abs(Number(maxImportMW)||0);
    const qMin=Number(minReactiveMvar),qMax=Number(maxReactiveMvar);
    if(mode==="rigid"){
      const p=clamp(demandMW,pMin,pMax),q=clamp(demandMvar,qMin,qMax);
      const qError=q-demandMvar;
      return{frequencyHz:f0,activeMW:p,reactiveMvar:q,voltagePU:clamp((Number(voltageSetpointPU)||1)+qError/Math.max(1,Number(shortCircuitMVA)||1000)*.1,.75,1.25),imbalanceMW:p-demandMW};
    }
    const previous=this.states.get(key)||{frequencyHz:f0};
    const h=Math.max(.1,Number(inertiaSeconds)||6),base=Math.max(1,Number(ratedMVA)||100);
    const droop=Math.max(.1,Number(droopPercent)||5)/100;
    const gain=base/(droop*f0);
    const pCommand=clamp((Number(setpointMW)||0)+(f0-previous.frequencyHz)*gain,pMin,pMax);
    const damping=Math.max(0,Number(dampingMWPerHz)||0);
    const mismatch=pCommand-demandMW-damping*(previous.frequencyHz-f0);
    const dfdt=f0*mismatch/(2*h*base);
    const frequencyHz=clamp(previous.frequencyHz+dfdt*Math.max(.05,Math.min(2,Number(dtSeconds)||1)),45,65);
    const q=clamp(demandMvar,qMin,qMax),qError=q-demandMvar;
    const voltagePU=clamp((Number(voltageSetpointPU)||1)+qError/Math.max(1,Number(shortCircuitMVA)||1000)*.1,.75,1.25);
    this.states.set(key,{frequencyHz});
    return{frequencyHz,activeMW:pCommand,reactiveMvar:q,voltagePU,imbalanceMW:pCommand-demandMW};
  }
}
