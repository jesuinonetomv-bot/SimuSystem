import test from 'node:test';
import assert from 'node:assert/strict';
import {bundledDiagram,withBundledDiagrams,restoreUnknownElectricalFields} from '../src/bundled-diagrams.js';
import {SE56A01_ID} from '../src/se56a-01-diagram.js';
import {createSwitchingStudy} from '../src/switching-analysis.js';
import {buildStudyNetwork} from '../src/study-network.js';
import {calculateThreePhaseFault} from '../src/electrical-studies.js';
import {referenceReadouts,transformerNameplate,electricalFieldValue} from '../src/reference-diagrams.js';

test('the photographed screen has 45 contacts, 13 transformers and explicit native connections',()=>{
 const d=bundledDiagram(SE56A01_ID),values=Object.values(d.items);
 assert.equal(d.name,'SE-56A-01');assert.equal(values.filter(o=>o.type==='breaker').length,33);
 assert.equal(values.filter(o=>o.type==='disconnector').length,12);
 assert.equal(values.filter(o=>o.type==='transformer').length,13);
 for(const o of values.filter(o=>/^(CSA?-|89AL)/.test(o.name)))assert.equal(o.type,'disconnector',o.name);
 for(const o of values)for(const k of ['x','y','x1','x2','y1','y2'])if(k in o)assert.ok(Number.isFinite(o[k]));
 const network=createSwitchingStudy(d).network();assert.deepEqual(network.issues,[]);
 assert.equal(network.sources.length,2);
});
test('the main transformers retain both nameplate ratings and use 70 MVA for the initial scenario',()=>{
 const d=bundledDiagram(SE56A01_ID);
 for(const suffix of ['a','b','c','d']){
  const o=d.items['abb-tf-'+suffix],e=o.electrical;
  assert.deepEqual(e.ratedMVARange,[50,70]);assert.equal(e.ratedMVA,70);
  assert.equal(e.primaryKV,230);assert.equal(e.secondaryKV,13.8);
  assert.match(transformerNameplate(o),/^50\/70 MVA/);
 }
});
test('all nine downstream loads are 2 MVA at PF .93 on 4.16 kV, without exceeding the 2 MVA transformer',()=>{
 const d=bundledDiagram(SE56A01_ID);let count=0;
 for(const [id,o]of Object.entries(d.items).filter(([id])=>id.startsWith('abb-dist-tf-'))){
  count++;const e=o.electrical,load=d.items['abb-load-dist-'+id.slice(-2)],l=load.electrical;
  assert.equal(e.primaryKV,13.8);assert.equal(e.secondaryKV,4.16);assert.equal(e.ratedMVA,2);
  assert.equal(l.nominalKV,4.16);assert.equal(l.powerFactor,.93);assert.equal(l.activePowerMW,1.86);
  const q=l.activePowerMW*Math.tan(Math.acos(l.powerFactor));
  assert.ok(Math.abs(Math.hypot(l.activePowerMW,q)-2)<1e-12);
  assert.ok(Math.abs(2*1000/(Math.sqrt(3)*l.nominalKV)-277.5722448027047)<.001);
 }
 assert.equal(count,9);
});
test('the four boilers are 60 MW resistive loads and only the reserve starts inactive',()=>{
 const d=bundledDiagram(SE56A01_ID),boilers=Object.values(d.items).filter(o=>o.reconstruction?.equipmentKind==='electricBoiler');
 assert.equal(boilers.length,4);assert.equal(boilers.filter(o=>o.state==='active').length,3);
 for(const b of boilers){assert.equal(b.electrical.activePowerMW,60);assert.equal(b.electrical.powerFactor,1);assert.equal(b.electrical.loadNature,'resistive');}
 const active=Object.values(d.items).filter(o=>o.type==='load'&&o.state==='active');
 assert.ok(Math.abs(active.reduce((sum,o)=>sum+o.electrical.activePowerMW,0)-196.74)<1e-9);
 assert.equal(d.items['abb-load-r'].state,'inactive');
});
test('opening a primary loses its boiler and the drawn transfer paths can restore it',()=>{
 const d=bundledDiagram(SE56A01_ID),s=createSwitchingStudy(d);
 const normal=s.energizedItems();
 assert.ok(normal.has('abb-load-a'));assert.ok(normal.has('abb-load-d'));assert.ok(normal.has('abb-load-e'));
 assert.equal(normal.has('abb-load-r'),false);
 for(const id of Object.keys(d.items).filter(id=>id.startsWith('abb-load-dist-')))assert.ok(normal.has(id));
 assert.equal(s.energizedItems({'abb-dj-tf-d':'open'}).has('abb-load-a'),false);
 assert.equal(s.energizedItems({'abb-dj-tf-d':'open','abb-dj-12':'closed','abb-dj-16':'closed'}).has('abb-load-a'),true);
 assert.equal(s.energizedItems({'abb-dj-coupler-1':'open'}).has('abb-load-dist-07'),false);
});
test('missing impedances and protection settings remain unknown and do not produce fault currents',()=>{
 const d=bundledDiagram(SE56A01_ID),n=buildStudyNetwork(d),errors=n.islands.flatMap(i=>i.errors);
 assert.ok(errors.length>=13);assert.ok(errors.every(e=>e.includes('impedância')));
 for(const o of Object.values(d.items).filter(o=>o.type==='transformer'))assert.equal(o.electrical.impedancePercent,null);
 for(const o of Object.values(d.items).filter(o=>o.type==='breaker'))assert.equal(o.electrical.protectionCurve,'none');
 const fault=calculateThreePhaseFault(d);assert.ok(fault.results.length>0);
 assert.equal(fault.results.some(r=>r.currentKA!==null),false);
});
test('source readings use model data and become undefined when the ideal sources are paralleled',()=>{
 const d=bundledDiagram(SE56A01_ID),s=createSwitchingStudy(d);
 const values=new Map([['abb-source-lt-ii',{energized:true,activeMW:196.74,reactiveMvar:6.616,voltageKV:230,frequencyHz:60,powerFactor:.999}],['abb-source-lt-i',{energized:true,activeMW:0,reactiveMvar:0,voltageKV:230,frequencyHz:60,powerFactor:1}]]);
 const single=referenceReadouts(d,values,s.network());
 assert.equal(single.get('abb-meter-ii-value-0'),'196,74 MW');
 assert.equal(single.get('abb-meter-i-value-0'),'0,00 MW');
 assert.equal(single.get('abb-meter-i-value-3'),'—');
 assert.match(single.get('abb-meter-ii-value-2'),/ A$/);
 const shared=referenceReadouts(d,values,s.network({'abb-dj-52al':'closed'}));
 assert.equal(shared.get('abb-meter-ii-value-0'),'Indef.');assert.equal(shared.get('abb-meter-i-value-2'),'Indef.');
 assert.equal(shared.get('abb-meter-ii-value-1'),'230,00 kV');
});
test('the new bundled tab supports hidden/deleted catalog overrides and independent editable copies',()=>{
 const remote={name:'Oculta',operatorVisible:false};
 assert.equal(withBundledDiagrams({[SE56A01_ID]:remote})[SE56A01_ID].operatorVisible,false);
 assert.equal(withBundledDiagrams({[SE56A01_ID]:{deletedAt:123,operatorVisible:false}})[SE56A01_ID],undefined);
 const a=bundledDiagram(SE56A01_ID);a.items['abb-tf-a'].electrical.ratedMVA=50;
 assert.equal(bundledDiagram(SE56A01_ID).items['abb-tf-a'].electrical.ratedMVA,70);
 delete a.items['abb-tf-a'].electrical.impedancePercent;
 restoreUnknownElectricalFields(a);assert.equal(a.items['abb-tf-a'].electrical.impedancePercent,null);
 assert.equal(a.items['abb-tf-a'].electrical.ratedMVA,50);
});
test('blank electrical inputs remain unknown while an explicit zero retains its physical meaning',()=>{
 assert.equal(electricalFieldValue({tagName:'INPUT',value:''}),null);
 assert.equal(electricalFieldValue({tagName:'INPUT',value:'0'}),0);
 assert.equal(electricalFieldValue({tagName:'INPUT',value:'4.16'}),4.16);
 assert.equal(electricalFieldValue({tagName:'SELECT',value:'resistive'}),'resistive');
 assert.equal(transformerNameplate({electrical:{ratedMVA:null}}),'Potência nominal pendente');
});
