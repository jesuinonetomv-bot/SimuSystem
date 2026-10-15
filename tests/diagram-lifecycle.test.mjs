import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { activeDiagramCatalog, diagramDeletionUpdates, diagramRestorationUpdates } from '../src/diagram-lifecycle.js';
import { bundledDiagram, withBundledDiagrams, GERAL_ALUNORTE_ID } from '../src/bundled-diagrams.js';

const metadata={id:'tab',name:'Teste',operatorVisible:true,publishedAt:100};
const draft={name:'Teste',items:{dj:{type:'breaker',state:'open'}},controlRules:[{id:'logic'}]};
const publication={name:'Teste',items:{dj:{type:'breaker',state:'closed'}},publishedAt:100};
const input={id:'tab',metadata,draft,publication,publishedMetadata:metadata,deletedAt:200};

test('deletion archives unsaved draft and published version and removes both active copies together',()=>{
 const plan=diagramDeletionUpdates({...input,defaultId:'tab',nextDefaultId:'other'});
 const archive=plan['engineering/diagramTrash/tab'];
 assert.deepEqual(archive.draft,draft);assert.deepEqual(archive.publication,publication);
 assert.equal(plan['engineering/diagrams/tab/draft'],null);
 assert.equal(plan['published/diagrams/tab'],null);
 assert.equal(plan['published/defaultDiagramId'],'other');
 assert.equal(plan['published/catalog/tab'].deletedAt,200);
 assert.deepEqual(activeDiagramCatalog({tab:plan['engineering/diagramCatalog/tab'],other:{name:'Other'}}),{other:{name:'Other'}});
 archive.draft.items.dj.state='closed';assert.equal(draft.items.dj.state,'open');
 assert.equal(Object.keys(plan).some(path=>path.startsWith('trainingSessions')||path.startsWith('versions')),false);
});
test('restoring returns the original draft, publication and visibility and clears the trash entry',()=>{
 const archive=diagramDeletionUpdates(input)['engineering/diagramTrash/tab'];
 const plan=diagramRestorationUpdates('tab',archive);
 assert.deepEqual(plan['engineering/diagrams/tab/draft'],draft);
 assert.deepEqual(plan['published/diagrams/tab'],publication);
 assert.deepEqual(plan['engineering/diagramCatalog/tab'],metadata);
 assert.deepEqual(plan['published/catalog/tab'],metadata);
 assert.equal(plan['engineering/diagramTrash/tab'],null);
});
test('deleting an unpublished draft never copies its private name or data into the public catalog',()=>{
 const plan=diagramDeletionUpdates({id:'private',metadata:{name:'Confidential',operatorVisible:false},draft,deletedAt:200});
 assert.deepEqual(plan['published/catalog/private'],{id:'private',deletedAt:200,operatorVisible:false});
 const restored=diagramRestorationUpdates('private',plan['engineering/diagramTrash/private']);
 assert.equal(restored['published/catalog/private'],null);assert.equal(restored['published/diagrams/private'],null);
 assert.equal(restored['engineering/diagramCatalog/private'].operatorVisible,false);
});
test('a deleted bundled diagram stays absent after reload and can be restored',()=>{
 const original=withBundledDiagrams()[GERAL_ALUNORTE_ID];
 const plan=diagramDeletionUpdates({id:GERAL_ALUNORTE_ID,metadata:original,draft:bundledDiagram(GERAL_ALUNORTE_ID),publishedMetadata:original,deletedAt:200});
 for(const prefix of ['engineering','published'])
  assert.equal(withBundledDiagrams({[GERAL_ALUNORTE_ID]:plan[prefix+'/diagramCatalog/'+GERAL_ALUNORTE_ID]||plan[prefix+'/catalog/'+GERAL_ALUNORTE_ID]})[GERAL_ALUNORTE_ID],undefined);
 const restored=diagramRestorationUpdates(GERAL_ALUNORTE_ID,plan['engineering/diagramTrash/'+GERAL_ALUNORTE_ID]);
 assert.equal(withBundledDiagrams({[GERAL_ALUNORTE_ID]:restored['published/catalog/'+GERAL_ALUNORTE_ID]})[GERAL_ALUNORTE_ID].name,'GERAL ALUNORTE');
});
test('deleting the final tab leaves tombstones rather than reviving a legacy or built-in tab',()=>{
 const plan=diagramDeletionUpdates({...input,defaultId:'tab'});
 const raw={tab:plan['published/catalog/tab']};
 assert.equal(Object.keys(raw).length,1);
 assert.deepEqual(activeDiagramCatalog(raw),{});assert.equal(plan['published/defaultDiagramId'],null);
 const other=diagramDeletionUpdates({...input,defaultId:'other'});
 assert.equal(Object.hasOwn(other,'published/defaultDiagramId'),false);
});
test('unsafe identifiers and missing archives are rejected before writes can be constructed',()=>{
 for(const id of ['', '../x', 'a/b', '__proto__', 'constructor'])
  assert.throws(()=>diagramDeletionUpdates({...input,id}));
 assert.throws(()=>diagramDeletionUpdates({...input,metadata:{deletedAt:100}}));
 assert.throws(()=>diagramRestorationUpdates('tab',null));
 assert.throws(()=>diagramRestorationUpdates('other',diagramDeletionUpdates(input)['engineering/diagramTrash/tab']));
});
test('delete requires the administrator, a current selection and the dedicated confirmation button',async()=>{
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=index.match(/\$\("#diagramDeleteConfirm"\)\.onclick = async \(\) => \{([\s\S]*?)\n      \};/)[1];
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const handler=new AsyncFunction('eng','diagramLifecycleBusy','pendingDiagramDeletionId','currentDiagramId','diagramCatalog','cleanDiagram',source);
 for(const args of [[false,false,'tab','tab',{tab:metadata}],[true,true,'tab','tab',{tab:metadata}],[true,false,'','tab',{tab:metadata}],[true,false,'tab','other',{tab:metadata}],[true,false,'tab','tab',{}]])
  await handler(...args,()=>{throw new Error('Unexpected mutation');});
 assert.ok(index.includes('id="diagramDeleteBox"'));
 assert.ok(index.includes('diagramRestorationUpdates(id, archive)'));
 assert.ok(index.includes('publishedAvailabilityUnsubscribe = onValue'));
});

function lifecycleHarness({failWrites=false,other=true}={}) {
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const server=new Map([
  ['engineering/diagramCatalog/tab',structuredClone(metadata)],
  ['engineering/diagrams/tab/draft',structuredClone(draft)],
  ['published/catalog/tab',structuredClone(metadata)],
  ['published/diagrams/tab',structuredClone(publication)],
  ['published/defaultDiagramId','tab'],
 ]);
 const controls=new Map(),storage=new Map([['simuDiagramId','tab'],['simuDraft:tab','cached']]);
 const ctx={eng:true,diagramLifecycleBusy:false,pendingDiagramDeletionId:'tab',currentDiagramId:'tab',
  diagram:structuredClone(draft),diagramCatalog:{tab:structuredClone(metadata)},diagramTrash:{},
  operatorDiagramStates:new Map([['tab',structuredClone(draft)]]),writes:[],resets:0,
  db:{},ref:(db,path='')=>path,
  get:async path=>({exists:()=>server.has(path),val:()=>structuredClone(server.get(path)??null)}),
  update:async(ref,plan)=>{
   if(failWrites)throw new Error('PERMISSION_DENIED');
   ctx.writes.push(plan);
   for(const [path,value] of Object.entries(plan))value===null?server.delete(path):server.set(path,structuredClone(value));
  },
  $:id=>{
   if(!controls.has(id))controls.set(id,{disabled:false,open:false,textContent:'',close(){this.open=false;},showModal(){this.open=true;}});
   return controls.get(id);
  },
  cleanDiagram:()=>structuredClone(ctx.diagram),
  diagramMetadata:()=>structuredClone(metadata),
  publishedPath:id=>'published/diagrams/'+id,
  diagramDeletionUpdates,diagramRestorationUpdates,bundledDiagram,withBundledDiagrams,
  renderDiagramCatalog(){},renderDiagramTrash(){},
  localStorage:{removeItem:key=>storage.delete(key)},
  switchDiagram:async id=>{ctx.currentDiagramId=id;ctx.diagram=structuredClone(server.get('engineering/diagrams/'+id+'/draft')||{items:{}});},
  resetDiagramWorkspace:()=>ctx.resets++,
 };
 if(other)ctx.diagramCatalog.other={name:'Other',operatorVisible:true,publishedAt:100};
 const deleteSource=index.match(/\$\("#diagramDeleteConfirm"\)\.onclick = async \(\) => \{([\s\S]*?)\n      \};/)[1];
 const restoreSource=index.match(/async function restoreDiagramFromTrash\(id\) \{([\s\S]*?)\n      \}/)[1];
 return {ctx,server,storage,controls,runDelete:runInNewContext('(async()=>{'+deleteSource+'})',ctx),
  runRestore:runInNewContext('(async(id)=>{'+restoreSource+'})',ctx)};
}
test('the actual confirmation handler archives once, clears stale local state and selects another tab',async()=>{
 const h=lifecycleHarness();
 await Promise.all([h.runDelete(),h.runDelete()]);
 assert.equal(h.ctx.writes.length,1);assert.equal(h.ctx.currentDiagramId,'other');
 assert.equal(h.ctx.diagramCatalog.tab,undefined);assert.equal(h.ctx.operatorDiagramStates.has('tab'),false);
 assert.equal(h.storage.has('simuDraft:tab'),false);
 assert.deepEqual(h.server.get('engineering/diagramTrash/tab').draft,draft);
 assert.equal(h.server.has('published/diagrams/tab'),false);
 assert.match(h.controls.get('#diagramMessage').textContent,/Aba excluída/);
 assert.equal(h.ctx.diagramLifecycleBusy,false);
});
test('a rejected database update leaves the tab, publication and local draft intact',async()=>{
 const h=lifecycleHarness({failWrites:true});await h.runDelete();
 assert.equal(h.ctx.currentDiagramId,'tab');assert.ok(h.ctx.diagramCatalog.tab);
 assert.ok(h.server.has('published/diagrams/tab'));assert.equal(h.storage.get('simuDraft:tab'),'cached');
 assert.equal(h.server.has('engineering/diagramTrash/tab'),false);
 assert.match(h.controls.get('#diagramDeleteMessage').textContent,/PERMISSION_DENIED/);
 assert.equal(h.controls.get('#diagramDeleteConfirm').disabled,false);
});
test('deleting the final active tab clears the workspace and the same tab can be restored',async()=>{
 const h=lifecycleHarness({other:false});await h.runDelete();
 assert.equal(h.ctx.currentDiagramId,'');assert.equal(h.ctx.resets,1);
 assert.equal(Object.keys(h.ctx.diagram.items).length,0);
 await h.runRestore('tab');
 assert.equal(h.ctx.currentDiagramId,'tab');assert.deepEqual(h.ctx.diagram,draft);
 assert.deepEqual(h.server.get('published/diagrams/tab'),publication);
 assert.equal(h.server.has('engineering/diagramTrash/tab'),false);
 assert.match(h.controls.get('#diagramMessage').textContent,/Aba restaurada/);
});
