import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createMediaStore,canManageMedia} from '../server/media-store.mjs';
import {addPartReference} from '../server/part-images.mjs';

test('local uploads validate content, enforce image quotas atomically and survive reopening',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cmms-media-'));
 const image=await sharp({create:{width:20,height:20,channels:3,background:'#004a96'}}).png().toBuffer();
 try{
  const store=createMediaStore(root);
  const results=await Promise.allSettled(Array.from({length:6},()=>store.add('assets','123',image,'image.png','planner')));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,5);
  assert.equal(results.filter(x=>x.status==='rejected')[0].reason.status,409);
  const reopened=createMediaStore(root);assert.equal(reopened.list('assets','123').length,5);
  assert.ok(!JSON.stringify(reopened.list('assets','123')).includes(root));
  const pdf=await store.add('assets','123',Buffer.from('%PDF-1.4\n%%EOF'),'manual.pdf','admin');assert.equal(pdf.kind,'document');
  await assert.rejects(store.add('assets','123',Buffer.from('<script>alert(1)</script>'),'bad.jpg','admin'));
  await assert.rejects(store.add('assets','123',Buffer.from('<html></html>'),'bad.pdf','admin'));
  await assert.rejects(store.add('spare-parts','123',Buffer.from('%PDF-1.4'),'manual.pdf','admin'));
  const part=await store.add('spare-parts','123',image,'../../part.png','planner');assert.ok(!part.name.includes('/'));
  await assert.rejects(store.add('spare-parts','123',image,'duplicate.png','planner'),e=>e.status===409);
  assert.equal(store.enrich('spare-parts',[{PartID:'123'}])[0].ImageOrigin,'local');
  store.remove('spare-parts','123',part.id);assert.equal(store.list('spare-parts','123').length,0);
  assert.equal(store.find('assets','999',pdf.id),null);
  assert.equal(canManageMedia('ADMINISTRATOR'),true);assert.equal(canManageMedia('PLANNER'),true);assert.equal(canManageMedia('TECHNICIAN'),false);assert.equal(canManageMedia('PRODUCTION'),false);
 }finally{for(const name of readdirSync(root))unlinkSync(join(root,name));rmdirSync(root)}
});
test('reference images only attach to confirmed matching model and part ID',()=>{
 assert.ok(addPartReference({PartID:'4',Description:'6ES7 331-7KF02-0AB0'}).ReferenceImageUrl);
 assert.equal(addPartReference({PartID:'4',Description:'different model'}).ReferenceImageUrl,undefined);
 assert.equal(addPartReference({PartID:'999',Description:'6ES7 331-7KF02-0AB0'}).ReferenceImageUrl,undefined);
});
