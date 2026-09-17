import {ImageViewer} from './image-viewer';
import {useEffect,useState} from 'react';
import {Upload,Trash2,FileText,ImagePlus} from 'lucide-react';
import {canWrite,type Role,type Resource,type Row,str} from './api';
import './media.css';
interface Media {id:string;url:string;name:string;kind:'image'|'document';size:number;createdAt:string;createdBy:string}
export function MediaGallery({resource,id,role,row}:{resource:Resource;id:string;role:Role|undefined;row:Row}){
 const [items,setItems]=useState<Media[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [viewer,setViewer]=useState<number|null>(null);
 const writable=resource==='stock-transactions'?canWrite(role,'POST',resource):['ADMINISTRATOR','PLANNER'].includes(role||'')&&canWrite(role,'PUT',resource,row);
 const endpoint=`/api/media/${resource}/${id}`;
 async function load(){const r=await fetch(endpoint);const j=await r.json();if(r.status===401)window.dispatchEvent(new Event('cmms-session-expired'));if(!r.ok)throw Error(j.error?.message||'โหลดไฟล์ไม่ได้');setItems(j.data)}
 useEffect(()=>{load().catch(e=>setError(e.message))},[endpoint]);
 async function upload(files:FileList|null){
  if(!files?.length)return;setBusy(true);setError('');setNotice('');let saved=0;
  try{
   const selected=[...files],maxImages=resource==='spare-parts'?1:5;
   if(selected.filter(f=>/\.(jpe?g|png|webp)$/i.test(f.name)).length+items.filter(f=>f.kind==='image').length>maxImages)throw Error(`เก็บรูปได้สูงสุด ${maxImages} ภาพ กรุณาลบภาพเดิมก่อนเพิ่ม`);
   for(const file of selected){
    if(file.size>15*1024*1024)throw Error(`${file.name}: ไฟล์ต้องมีขนาดไม่เกิน 15 MB`);
    const r=await fetch(endpoint+'?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await file.arrayBuffer()});const j=await r.json();
    if(!r.ok)throw Error(j.error?.message||'อัปโหลดไม่สำเร็จ');saved++;
   }
   setNotice(`อัปโหลด ${saved} ไฟล์แล้ว`);
  }catch(e){setError((saved?`บันทึกแล้ว ${saved} ไฟล์ · `:'')+(e as Error).message)}
  finally{await load().catch(e=>setError(e.message));if(saved)window.dispatchEvent(new Event('cmms-media-updated'));setBusy(false)}
 }
 async function remove(item:Media){if(!window.confirm(`ลบไฟล์ ${item.name} หรือไม่?`))return;setBusy(true);setError('');try{const r=await fetch(item.url,{method:'DELETE'});const j=await r.json();if(!r.ok)throw Error(j.error?.message);await load();window.dispatchEvent(new Event('cmms-media-updated'))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const images=items.filter(x=>x.kind==='image'),documents=items.filter(x=>x.kind==='document');
 const ref=str(row,'ImageOrigin')!=='local'?str(row,'ReferenceImageUrl'):'';
 return <section className="media-gallery"><div className="media-heading"><div><h3>รูปภาพ{resource==='assets'?'และเอกสารเครื่องจักร':resource==='stock-transactions'?'และเอกสารแนบ':''}</h3><p>{images.length} / {resource==='spare-parts'?1:5} ภาพ · เก็บไฟล์ในเครื่องเซิร์ฟเวอร์ CMMS</p></div>{writable&&<label className={`button primary upload-button ${busy?'is-busy':''}`}><Upload size={16}/>{busy?'กำลังอัปโหลด…':'อัปโหลดไฟล์'}<input aria-label="อัปโหลดรูปหรือเอกสาร" type="file" disabled={busy} multiple={resource!=='spare-parts'} accept={resource==='assets'?'.jpg,.jpeg,.png,.webp,.pdf,.dwg,.dxf':resource==='stock-transactions'?'.jpg,.jpeg,.png,.webp,.pdf':'.jpg,.jpeg,.png,.webp'} onChange={e=>{upload(e.target.files);e.target.value=''}}/></label>}</div>
 {error&&<p className="error-box" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <div className="media-grid">{images.map((item,index)=><figure key={item.id}><button className="media-photo" aria-label={`ดูภาพที่ ${index+1}`} onClick={()=>setViewer(index)}><img src={item.url} alt={`ภาพที่ ${index+1}`}/></button>{writable&&resource!=='stock-transactions'&&<figcaption><button className="icon-button" disabled={busy} aria-label={`ลบภาพที่ ${index+1}`} onClick={()=>remove(item)}><Trash2 size={15}/></button></figcaption>}</figure>)}
 {!images.length&&ref&&<figure><button className="media-photo" aria-label="ดูภาพอ้างอิง" onClick={()=>setViewer(0)}><img src={ref} alt="ภาพอ้างอิง"/></button><figcaption>ภาพอ้างอิงภายนอก</figcaption></figure>}
 {!images.length&&!ref&&<div className="media-empty"><ImagePlus size={28}/><span>ยังไม่มีรูปภาพ</span></div>}</div>
 {viewer!==null&&<ImageViewer images={images.length?images.map((item,i)=>({url:item.url,alt:`ภาพที่ ${i+1}`})):[{url:ref,alt:"ภาพอ้างอิง"}]} initial={viewer} close={()=>setViewer(null)}/>}
 {documents.length>0&&<ul className="media-documents">{documents.map(item=><li key={item.id}><FileText size={20}/><a href={item.url}>{item.name}<small>{(item.size/1024).toFixed(0)} KB · {item.createdBy}</small></a>{writable&&resource!=='stock-transactions'&&<button className="icon-button" disabled={busy} aria-label={'ลบ '+item.name} onClick={()=>remove(item)}><Trash2 size={16}/></button>}</li>)}</ul>}
 <p className="media-help">{resource==='assets'?'JPG, PNG, WebP · เอกสาร PDF, DWG, DXF':resource==='stock-transactions'?'JPG, PNG, WebP · เอกสาร PDF':'JPG, PNG, WebP'} · สูงสุด 15 MB ต่อไฟล์{writable||resource==='stock-transactions'?'':' · อัปโหลดได้เฉพาะ Planner / Administrator ที่มีสิทธิ์แก้ไขทะเบียน'}</p></section>;
}
