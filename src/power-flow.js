import { buildStudyNetwork } from "./study-network.js?v=49";
const EPS=1e-10,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const C=(re=0,im=0)=>({re,im}),add=(a,b)=>C(a.re+b.re,a.im+b.im),sub=(a,b)=>C(a.re-b.re,a.im-b.im),mul=(a,b)=>C(a.re*b.re-a.im*b.im,a.re*b.im+a.im*b.re),conj=a=>C(a.re,-a.im),div=(a,b)=>{const d=b.re*b.re+b.im*b.im||EPS;return C((a.re*b.re+a.im*b.im)/d,(a.im*b.re-a.re*b.im)/d)},abs=a=>Math.hypot(a.re,a.im),polar=(r,a)=>C(r*Math.cos(a),r*Math.sin(a));
const solveLinear=(A,b)=>{const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let k=0;k<n;k++){let p=k;for(let i=k+1;i<n;i++)if(Math.abs(M[i][k])>Math.abs(M[p][k]))p=i;[M[k],M[p]]=[M[p],M[k]];if(Math.abs(M[k][k])<1e-12)throw Error("Matriz singular");for(let i=k+1;i<n;i++){const f=M[i][k]/M[k][k];for(let j=k;j<=n;j++)M[i][j]-=f*M[k][j]}}const x=Array(n);for(let i=n-1;i>=0;i--){let v=M[i][n];for(let j=i+1;j<n;j++)v-=M[i][j]*x[j];x[i]=v/M[i][i]}return x};
function buildCase(diagram,baseMVA=100,options={}) {
  return buildStudyNetwork(diagram,{...options,baseMVA});
}
function yBus(c){const n=c.buses.length,Y=Array.from({length:n},()=>Array.from({length:n},()=>C()));for(const br of c.branches){const y=div(C(1),C(br.r,br.x)),tap=br.tap||1,bsh=C(0,(br.b||0)/2);Y[br.from][br.from]=add(Y[br.from][br.from],div(add(y,bsh),C(tap*tap)));Y[br.to][br.to]=add(Y[br.to][br.to],add(y,bsh));const off=div(y,C(tap));Y[br.from][br.to]=sub(Y[br.from][br.to],off);Y[br.to][br.from]=sub(Y[br.to][br.from],off)}return Y}
const injections=(V,Y)=>V.map((v,i)=>{let I=C();for(let j=0;j<V.length;j++)I=add(I,mul(Y[i][j],V[j]));const S=mul(v,conj(I));return{p:S.re,q:S.im}});
function mismatch(c,V,Y){const calc=injections(V,Y),nonSlack=[],pq=[];c.buses.forEach((b,i)=>{if(b.type!=="Slack")nonSlack.push(i);if(b.type==="PQ")pq.push(i)});return{vec:[...nonSlack.map(i=>c.buses[i].p-calc[i].p),...pq.map(i=>c.buses[i].q-calc[i].q)],nonSlack,pq,calc}}
function newton(c,opt={}){const Y=yBus(c),n=c.buses.length,V=c.buses.map(b=>polar(b.v||1,b.angle||0)),tol=opt.tolerance||1e-7,max=opt.maxIterations||30;let converged=false,iteration=0;for(;iteration<max;iteration++){const m=mismatch(c,V,Y),err=Math.max(0,...m.vec.map(Math.abs));if(err<tol){converged=true;break}const vars=[...m.nonSlack.map(i=>({i,k:"a"})),...m.pq.map(i=>({i,k:"v"}))],h=1e-5,J=Array.from({length:m.vec.length},()=>Array(vars.length));for(let j=0;j<vars.length;j++){const x=vars[j],Vp=V.map(z=>C(z.re,z.im)),mag=abs(Vp[x.i]),ang=Math.atan2(Vp[x.i].im,Vp[x.i].re);Vp[x.i]=x.k==="a"?polar(mag,ang+h):polar(mag+h,ang);const mp=mismatch(c,Vp,Y).vec;for(let i=0;i<m.vec.length;i++)J[i][j]=(mp[i]-m.vec[i])/h}const dx=solveLinear(J,m.vec.map(v=>-v));vars.forEach((x,j)=>{const mag=abs(V[x.i]),ang=Math.atan2(V[x.i].im,V[x.i].re);V[x.i]=x.k==="a"?polar(mag,ang+dx[j]):polar(Math.max(.5,mag+dx[j]),ang)})}return finish(c,V,Y,converged,iteration,"Newton-Raphson")}
function gaussSeidel(c,opt={}){const Y=yBus(c),V=c.buses.map(b=>polar(b.v||1,b.angle||0)),tol=opt.tolerance||1e-7,max=opt.maxIterations||200;let converged=false,iteration=0;for(;iteration<max;iteration++){let err=0;for(let i=0;i<V.length;i++){const b=c.buses[i];if(b.type==="Slack")continue;let sum=C();for(let j=0;j<V.length;j++)if(j!==i)sum=add(sum,mul(Y[i][j],V[j]));let q=b.q;if(b.type==="PV")q=injections(V,Y)[i].q;const next=div(sub(div(C(b.p,-q),conj(V[i])),sum),Y[i][i]);const nv=b.type==="PV"?polar(b.v,Math.atan2(next.im,next.re)):next;err=Math.max(err,abs(sub(nv,V[i])));V[i]=nv}if(err<tol&&Math.max(0,...mismatch(c,V,Y).vec.map(Math.abs))<tol){converged=true;break}}return finish(c,V,Y,converged,iteration,"Gauss-Seidel")}
function decoupled(c,opt={}){const Y=yBus(c),V=c.buses.map(b=>polar(b.v||1,b.angle||0)),tol=opt.tolerance||1e-7,max=opt.maxIterations||80,ns=c.buses.map((b,i)=>b.type!=="Slack"?i:null).filter(i=>i!==null),pq=c.buses.map((b,i)=>b.type==="PQ"?i:null).filter(i=>i!==null),Bp=ns.map(i=>ns.map(j=>-Y[i][j].im)),Bq=pq.map(i=>pq.map(j=>-Y[i][j].im));let converged=false,iteration=0;for(;iteration<max;iteration++){let m=mismatch(c,V,Y),err=Math.max(0,...m.vec.map(Math.abs));if(err<tol){converged=true;break}if(ns.length){const dp=ns.map((i,k)=>m.vec[k]/Math.max(.2,abs(V[i]))),da=solveLinear(Bp,dp);ns.forEach((i,k)=>V[i]=polar(abs(V[i]),Math.atan2(V[i].im,V[i].re)+da[k]))}m=mismatch(c,V,Y);if(pq.length){const dq=pq.map((i,k)=>m.vec[ns.length+k]/Math.max(.2,abs(V[i]))),dv=solveLinear(Bq,dq);pq.forEach((i,k)=>V[i]=polar(Math.max(.5,abs(V[i])+dv[k]),Math.atan2(V[i].im,V[i].re)))}}return finish(c,V,Y,converged,iteration,"Desacoplado rápido")}
function finish(c,V,Y,converged,iterations,method){const inj=injections(V,Y),branches=c.branches.map(br=>{const y=div(C(1),C(br.r,br.x)),Vi=V[br.from],Vj=V[br.to],tap=br.tap||1,Iij=div(mul(sub(div(Vi,C(tap)),Vj),y),C(tap)),Iji=mul(sub(Vj,div(Vi,C(tap))),y),Sij=mul(Vi,conj(Iij)),Sji=mul(Vj,conj(Iji));return{...br,pFromMW:Sij.re*c.baseMVA,qFromMvar:Sij.im*c.baseMVA,pToMW:Sji.re*c.baseMVA,qToMvar:Sji.im*c.baseMVA,lossMW:(Sij.re+Sji.re)*c.baseMVA,lossMvar:(Sij.im+Sji.im)*c.baseMVA,currentA:abs(Iij)*c.baseMVA*1e6/(Math.sqrt(3)*c.buses[br.from].kv*1000),currentToA:abs(Iji)*c.baseMVA*1e6/(Math.sqrt(3)*c.buses[br.to].kv*1000)}});return{method,converged,iterations,ybus:Y,buses:c.buses.map((b,i)=>({...b,voltagePU:abs(V[i]),angleDeg:Math.atan2(V[i].im,V[i].re)*180/Math.PI,pCalculatedMW:inj[i].p*c.baseMVA,qCalculatedMvar:inj[i].q*c.baseMVA})),branches,totalLossMW:branches.reduce((a,b)=>a+b.lossMW,0),totalLossMvar:branches.reduce((a,b)=>a+b.lossMvar,0),caseData:c}}
function splitIslands(c) {
  return c.islands.filter(island=>island.sourceIds.length&&!island.errors.length).map(island=>{
    const map=new Map(island.ids.map((id,i)=>[id,i]));
    return {baseMVA:c.baseMVA,
      buses:island.ids.map(id=>({...c.buses[id],id:map.get(id),originalId:id})),
      branches:c.branches.filter(br=>map.has(br.from)&&map.has(br.to))
        .map(br=>({...br,from:map.get(br.from),to:map.get(br.to)})),
      busOfItem:c.busOfItem};
  });
}
export function solveDiagramPowerFlow(diagram,options={}) {
  const {method="newton",baseMVA=100,tolerance=1e-7,maxIterations}=options;
  if(maxIterations!==undefined&&(!Number.isInteger(maxIterations)||maxIterations<=0)) throw Error("Limite de iterações inválido.");
  if(!["newton","gauss","decoupled"].includes(method)) throw Error("Método de fluxo inválido.");
  if(!Number.isFinite(+tolerance)||+tolerance<=0) throw Error("Tolerância deve ser maior que zero.");
  const complete=buildCase(diagram,baseMVA,options),islands=splitIslands(complete);
  const notCalculated=complete.islands.filter(i=>!i.sourceIds.length||i.errors.length)
    .map(i=>({names:i.ids.filter(id=>complete.buses[id].busIds.length).map(id=>complete.buses[id].name),
      reason:!i.sourceIds.length?"Sem fonte em operação":i.errors.join("; ")}));
  if(!islands.length) throw Error(notCalculated.map(i=>i.reason).join("; ")||"Rede sem fonte ou dados válidos.");
  const reactiveWarnings=[];
  const solved=islands.map(c=>{
    const solve=()=>method==="gauss"?gaussSeidel(c,{tolerance,maxIterations}):
      method==="decoupled"?decoupled(c,{tolerance,maxIterations}):newton(c,{tolerance,maxIterations});
    let r=solve(), totalIterations=r.iterations;
    for(let pass=0;pass<c.buses.length&&r.converged;pass++) {
      const limited=c.buses.filter((b,i)=>b.type==="PV"&&b.qMinPV!=null&&
        (r.buses[i].qCalculatedMvar/c.baseMVA<b.qMinPV-1e-8||r.buses[i].qCalculatedMvar/c.baseMVA>b.qMaxPV+1e-8));
      if(!limited.length) break;
      for(const b of limited) {
        b.q=clamp(r.buses[b.id].qCalculatedMvar/c.baseMVA,b.qMinPV,b.qMaxPV);
        b.type="PQ"; b.qLimited=true;
        reactiveWarnings.push(b.name+": limite de Q atingido; controle PV convertido para PQ no estudo.");
      }
      c.buses.forEach((b,i)=>{if(b.type==="PQ")b.v=r.buses[i].voltagePU;b.angle=r.buses[i].angleDeg*Math.PI/180});
      r=solve(); totalIterations+=r.iterations;
    }
    return {...r,iterations:totalIterations};
  });
  let offset=0;const buses=[],branches=[];
  for(const [i,r] of solved.entries()) {
    buses.push(...r.buses.map((b,j)=>({...b,id:offset+j,island:i+1})));
    branches.push(...r.branches.map(b=>({...b,from:b.from+offset,to:b.to+offset,island:i+1})));
    offset+=r.buses.length;
  }
  const sources=complete.sourceData.flatMap(s=>{
    const b=buses.find(b=>b.originalId===s.bus);
    if(!b) return [];
    const colocated=complete.sourceData.filter(x=>x.bus===s.bus);
    const unknown=colocated.filter(x=>x.type!=="turbogenerator"||b.referenceSourceId===x.id||b.regulatingSourceId===x.id);
    const fixed=colocated.filter(x=>!unknown.includes(x));
    const adjustable=unknown.includes(s), ambiguous=adjustable&&unknown.length>1;
    const pResidual=b.pCalculatedMW+b.loadMW-fixed.reduce((n,x)=>n+x.scheduledMW,0);
    const qResidual=b.qCalculatedMvar+b.loadMvar-b.capacitorMvar-fixed.reduce((n,x)=>n+x.scheduledMvar,0);
    return [{id:s.id,name:s.name,type:s.type,mode:b.referenceSourceId===s.id||s.type!=="turbogenerator"?"Slack":
      b.regulatingSourceId===s.id?(b.qLimited?"PQ (limite Q)":"PV"):"PQ",
      powerMW:ambiguous?null:adjustable?pResidual:s.scheduledMW,
      reactiveMvar:ambiguous?null:adjustable?qResidual:s.scheduledMvar,
      ratedMVA:s.data.generatorRatedMVA,qMinMvar:s.data.studyQMinMvar??null,qMaxMvar:s.data.studyQMaxMvar??null,
      qLimited:!!b.qLimited&&b.regulatingSourceId===s.id}];
  });
  return {method:solved[0].method,converged:solved.every(r=>r.converged),
    iterations:Math.max(...solved.map(r=>r.iterations)),islandCount:solved.length,buses,branches,sources,
    totalLossMW:solved.reduce((a,r)=>a+r.totalLossMW,0),
    totalLossMvar:solved.reduce((a,r)=>a+r.totalLossMvar,0),caseData:complete,notCalculated,
    warnings:[...new Set([...complete.islands.flatMap(i=>i.warnings),...reactiveWarnings])]};
}
export{buildCase,yBus};
