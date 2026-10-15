import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bundledDiagram, withBundledDiagrams, restoreUnknownElectricalFields, GERAL_ALUNORTE_ID} from '../src/bundled-diagrams.js';
import {createSwitchingStudy} from '../src/switching-analysis.js';
import {renderTechnicalSymbol} from '../src/technical-symbols.js';

test('Geral Alunorte is a native diagram available in the catalog without a DB copy',()=>{
 const entry=withBundledDiagrams({existing:{name:'Existing'}});
 assert.equal(entry[GERAL_ALUNORTE_ID].name,'GERAL ALUNORTE');assert.equal(entry[GERAL_ALUNORTE_ID].operatorVisible,true);
 assert.equal(entry.existing.name,'Existing');assert.equal(bundledDiagram('existing'),null);
 const d=bundledDiagram(GERAL_ALUNORTE_ID);assert.equal(d.name,'GERAL ALUNORTE');
 const values=Object.values(d.items);assert.equal(values.filter(o=>['breaker','disconnector'].includes(o.type)).length,45);
 assert.equal(values.filter(o=>o.type==='transformer').length,12);
 assert.deepEqual(createSwitchingStudy(d).network().issues,[]);
});
test('saved catalog visibility and modified diagrams override the bundled baseline',()=>{
 const local={name:'Revisado',operatorVisible:false,publishedAt:123};
 assert.deepEqual(withBundledDiagrams({[GERAL_ALUNORTE_ID]:local})[GERAL_ALUNORTE_ID],local);
 const a=bundledDiagram(GERAL_ALUNORTE_ID);a.items['ga-dj-12'].state='closed';
 assert.equal(bundledDiagram(GERAL_ALUNORTE_ID).items['ga-dj-12'].state,'open');
});
function visibilityHarness(id, initial) {
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=index.match(/\$\("#diagramVisibilitySave"\)\.onclick = async \(\) => \{([\s\S]*?)\n      \};/)[1];
 const controls={'#currentDiagramOperatorVisible':{checked:false},'#diagramMessage':{textContent:''}};
 const catalog={[id]:{...initial}},writes=new Map();
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const handler=new AsyncFunction('diagramMetadata','currentDiagramId','diagram','$','ref','set','db','diagramCatalog','renderDiagramCatalog','bundledDiagram','eng','diagramLifecycleBusy',source);
 return {catalog,writes,controls,async apply(visible){
  controls['#currentDiagramOperatorVisible'].checked=visible;
  await handler((key,data,extra)=>({...catalog[key],...extra}),id,{items:{}},key=>controls[key],(db,path)=>path,async(path,value)=>writes.set(path,{...value}),{},catalog,()=>{},bundledDiagram,true,false);
 }};
}
test('the visibility control hides and restores the bundled tab without publishing its draft',async()=>{
 const h=visibilityHarness(GERAL_ALUNORTE_ID,{name:'GERAL ALUNORTE',operatorVisible:true});
 await h.apply(false);
 const path='published/catalog/'+GERAL_ALUNORTE_ID;
 assert.equal(h.writes.get(path)?.operatorVisible,false);
 const operatorCatalog=withBundledDiagrams({[GERAL_ALUNORTE_ID]:h.writes.get(path)});
 assert.equal(operatorCatalog[GERAL_ALUNORTE_ID].operatorVisible,false);
 assert.equal(operatorCatalog['se-56a-01-abb'].operatorVisible,true);
 assert.equal(h.catalog[GERAL_ALUNORTE_ID].operatorVisible,false);
 assert.deepEqual([...h.writes.keys()].sort(),['engineering/diagramCatalog/'+GERAL_ALUNORTE_ID,path].sort());
 await h.apply(true);
 assert.equal(h.writes.get(path).operatorVisible,true);
});
test('the visibility control keeps an unpublished custom diagram out of the public catalog',async()=>{
 const h=visibilityHarness('private-draft',{name:'Projeto em elaboração',operatorVisible:true});
 await h.apply(false);
 assert.deepEqual([...h.writes.keys()],['engineering/diagramCatalog/private-draft']);
 const published=visibilityHarness('existing',{name:'Publicado',publishedAt:123});
 await published.apply(false);
 assert.equal(published.writes.get('published/catalog/existing').operatorVisible,false);
});
test('unknown data survive RTDB null omission without resetting engineer-entered values',()=>{
 const d=bundledDiagram(GERAL_ALUNORTE_ID);const o=d.items['ga-tf-a'];
 delete o.electrical.ratedMVA;delete o.electrical.impedancePercent;o.electrical.secondaryKV=13.8;
 const restored=restoreUnknownElectricalFields(d);
 assert.equal(restored.items['ga-tf-a'].electrical.ratedMVA,null);
 assert.equal(restored.items['ga-tf-a'].electrical.impedancePercent,null);
 assert.equal(restored.items['ga-tf-a'].electrical.secondaryKV,13.8);
 assert.deepEqual(restoreUnknownElectricalFields({items:{}}),{items:{}});
});
test('unknown-data metadata only restores declared baseline electrical fields',()=>{
 const d=bundledDiagram(GERAL_ALUNORTE_ID);
 d.reconstruction.unsetElectricalFields['ga-tf-a'].push('__proto__','madeUp','protectionCurve');
 d.items.other={electrical:{}};d.reconstruction.unsetElectricalFields.other=['ratedMVA'];
 restoreUnknownElectricalFields(d);
 assert.equal(Object.hasOwn(d.items['ga-tf-a'].electrical,'__proto__'),false);
 assert.equal(Object.hasOwn(d.items['ga-tf-a'].electrical,'madeUp'),false);
 assert.deepEqual(d.items.other.electrical,{});
});
test('HMI contacts use existing technical terminals and default contacts retain their style',()=>{
 const E=(tag,attrs={},value='')=>({tag,attrs,value,children:[],append(...nodes){this.children.push(...nodes);}});
 const g=E('g');renderTechnicalSymbol(g,{type:'disconnector',x:20,y:40,scale:.8,state:'closed',symbolStyle:'hmi'},E);
 const rect=g.children[0].children.find(x=>x.attrs.class?.includes('hmi-switch'));
 assert.equal(rect.attrs.width,45);
 const normal=E('g');renderTechnicalSymbol(normal,{type:'disconnector',x:20,y:40,state:'closed'},E);
 assert.equal(normal.children[0].children.some(x=>x.attrs.class?.includes('hmi-switch')),false);
});
test('application resolves the baseline in both viewing and engineering and caches it offline',()=>{
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.ok(index.includes('withBundledDiagrams(catalogSnapshot.val() || {})'));
 assert.ok(index.includes('else diagram = bundledDiagram(id) ||'));
 assert.ok(index.includes('else diagram = bundledDiagram(currentDiagramId) ||'));
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.ok(sw.includes('./src/bundled-diagrams.js?v=49.5.2'));
 assert.ok(sw.includes('simusystem-v49.5.2'));
});
