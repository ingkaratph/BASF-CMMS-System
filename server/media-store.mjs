import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export const mediaResources=['assets','spare-parts','stock-transactions'];
export function canManageMedia(role){return ['ADMINISTRATOR','PLANNER'].includes(role)}
export function createMediaStore(directory){
 const root=resolve(directory);const indexFile=join(root,'index.json');
 const read=()=>existsSync(indexFile)?JSON.parse(readFileSync(indexFile,'utf8')):[];
 const save=items=>{mkdirSync(root,{recursive:true});writeFileSync(indexFile+'.tmp',JSON.stringify(items,null,2));renameSync(indexFile+'.tmp',indexFile)};
 const valid=(resource,id)=>{if(!mediaResources.includes(resource)||!/^\d{1,20}$/.test(String(id)))throw fail('รายการไม่ถูกต้อง')};
 const publicItem=({file,...item})=>({...item,url:`/api/media/${item.resource}/${item.recordId}/files/${item.id}`});
 return {
  list(resource,id){valid(resource,id);return read().filter(x=>x.resource===resource&&x.recordId===String(id)).map(publicItem)},
  find(resource,id,fileId){valid(resource,id);const item=read().find(x=>x.resource===resource&&x.recordId===String(id)&&x.id===fileId);return item?{...item,path:join(root,item.file)}:null},
  async add(resource,id,buffer,name,actor){
   valid(resource,id);
   if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>15*1024*1024)throw fail('ไฟล์ต้องมีขนาดไม่เกิน 15 MB',413);
   name=String(name||'upload').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_').slice(0,180);
   const ext=name.split('.').at(-1).toLowerCase();let data=buffer,kind,mime,storedExt;
   if(['jpg','jpeg','png','webp'].includes(ext)){
    try{const img=sharp(buffer,{limitInputPixels:40000000,animated:false});const meta=await img.metadata();if(!['jpeg','png','webp'].includes(meta.format))throw Error();data=await img.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();}catch{throw fail('ไฟล์รูปภาพไม่ถูกต้อง หรือมีขนาดภาพเกิน 40 ล้านพิกเซล')}
    kind='image';mime='image/webp';storedExt='webp';
   }else if(['assets','stock-transactions'].includes(resource)&&ext==='pdf'&&buffer.subarray(0,5).toString()==='%PDF-'){
    kind='document';mime='application/pdf';storedExt='pdf';
   }else if(resource==='assets'&&ext==='dwg'&&/^AC10\d{2}/.test(buffer.subarray(0,6).toString())){
    kind='document';mime='application/octet-stream';storedExt='dwg';
   }else if(resource==='assets'&&ext==='dxf'&&(/AutoCAD Binary DXF/.test(buffer.subarray(0,30).toString())||/^\s*0\s*\r?\nSECTION\s*\r?\n/i.test(buffer.subarray(0,100).toString()))){
    kind='document';mime='application/octet-stream';storedExt='dxf';
   }else throw fail(resource==='assets'?'รองรับ JPG, PNG, WebP, PDF, DWG และ DXF เท่านั้น':resource==='stock-transactions'?'รองรับ JPG, PNG, WebP และ PDF เท่านั้น':'รองรับ JPG, PNG และ WebP เท่านั้น');
   // No awaits below: quota check and atomic index update cannot interleave.
   const rows=read();const same=rows.filter(x=>x.resource===resource&&x.recordId===String(id));
   if(same.length>=20)throw fail('เก็บไฟล์ได้สูงสุด 20 ไฟล์ต่อรายการ',409);
   if(kind==='image'&&same.filter(x=>x.kind==='image').length>=(resource==='spare-parts'?1:5))throw fail('เก็บรูปได้สูงสุด '+(resource==='spare-parts'?1:5)+' ภาพ',409);
   const item={id:randomUUID(),resource,recordId:String(id),name,kind,mime,size:data.length,createdAt:new Date().toISOString(),createdBy:actor};item.file=item.id+'.'+storedExt;
   mkdirSync(root,{recursive:true});writeFileSync(join(root,item.file),data);
   try{save([...rows,item])}catch(e){unlinkSync(join(root,item.file));throw e}
   return publicItem(item);
  },
  remove(resource,id,fileId){valid(resource,id);const rows=read(),item=rows.find(x=>x.resource===resource&&x.recordId===String(id)&&x.id===fileId);if(!item)throw fail('ไม่พบไฟล์',404);save(rows.filter(x=>x.id!==fileId));if(existsSync(join(root,item.file)))unlinkSync(join(root,item.file));},
  enrich(resource,rows){const files=read();return rows.map(row=>{const id=String(row[resource==='assets'?'AssetID':resource==='stock-transactions'?'StockTransactionID':'PartID']);const image=files.find(x=>x.resource===resource&&x.recordId===id&&x.kind==='image');return image?{...row,ReferenceImageUrl:publicItem(image).url,ReferenceSourceUrl:publicItem(image).url,ReferenceCaption:'ภาพที่อัปโหลด · '+image.name,ImageOrigin:'local'}:row})}
 };
}
