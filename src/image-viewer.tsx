import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X,ChevronLeft,ChevronRight} from 'lucide-react';
import './media.css';
export function ImageViewer({images,initial,close}:{images:{url:string;alt:string}[];initial:number;close:()=>void}){
 const [index,setIndex]=useState(initial);
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement;
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';ref.current?.focus();
  const key=(e:KeyboardEvent)=>{
   if(!['Escape','ArrowLeft','ArrowRight','Tab'].includes(e.key))return;
   e.preventDefault();e.stopImmediatePropagation();
   if(e.key==='Escape')close();
   if(e.key==='ArrowLeft')setIndex(i=>(i+images.length-1)%images.length);
   if(e.key==='ArrowRight')setIndex(i=>(i+1)%images.length);
   if(e.key==='Tab'){
    const buttons=Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button')||[]);
    const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(current+(e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();
   }
  };
  document.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('keydown',key,true);document.body.style.overflow=overflow;previous?.focus()};
 },[]);
 return createPortal(<div className="image-viewer" role="dialog" aria-modal="true" aria-label="Gallery รูปภาพ" tabIndex={-1} ref={ref}>
  <header><span>{index+1} / {images.length}</span><button aria-label="ปิด Gallery" onClick={close}><X/></button></header>
  <div className="image-viewer-stage">{images.length>1&&<button aria-label="ภาพก่อนหน้า" onClick={()=>setIndex((index+images.length-1)%images.length)}><ChevronLeft/></button>}<img src={images[index].url} alt={images[index].alt}/>{images.length>1&&<button aria-label="ภาพถัดไป" onClick={()=>setIndex((index+1)%images.length)}><ChevronRight/></button>}</div>
  {images.length>1&&<nav aria-label="เลือกรูปภาพ">{images.map((img,i)=><button key={img.url} aria-label={`ภาพที่ ${i+1}`} aria-pressed={index===i} onClick={()=>setIndex(i)}><img src={img.url} alt=""/></button>)}</nav>}
 </div>,document.body);
}
