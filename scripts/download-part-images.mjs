import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
const entries=JSON.parse(readFileSync('server/part-images.json','utf8'));
mkdirSync('public/part-images',{recursive:true});
for(const entry of entries){
 const dest='public/part-images/'+entry.file;if(existsSync(dest))continue;
 try{
 const r=await fetch(entry.imageSource,{signal:AbortSignal.timeout(20000)});
 if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))throw new Error('Not an image '+r.status);
 const b=Buffer.from(await r.arrayBuffer());if(b.length<500||b.length>10000000)throw new Error('Unexpected image size');
 writeFileSync(dest,b);console.log('Saved',entry.file,b.length);
 }catch(e){console.log('Skipped',entry.file,e.message)}
}
