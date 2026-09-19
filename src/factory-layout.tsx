import React,{useEffect,useMemo,useRef,useState} from 'react';
import {str,type Row,type Resource} from './api';
import {mapLayout,type LayoutItem,type LayoutEntry} from './layout-mapping.mjs';
import './factory-layout.css';

type Viewer={select:(id:string)=>void;setOptions:(o:Options)=>void;setStatuses:(entries:LayoutEntry[])=>void;view:(mode:string)=>void;whole:()=>void;focus:(id:string)=>void;dispose:()=>void};
type Options={buildingNames:boolean;machineNames:boolean;roofs:boolean;upper:boolean};
type Model={items:LayoutItem[];origin:number[]};
export function FactoryLayout({assets,workOrders,loading,onDetail}:{assets?:Row[];workOrders?:Row[];loading:boolean;onDetail:(resource:Resource,row:Row)=>void}){
 const host=useRef<HTMLDivElement>(null),viewer=useRef<Viewer|null>(null);
 const [model,setModel]=useState<Model>(),[error,setError]=useState(''),[ready,setReady]=useState(false),[selected,setSelected]=useState('production');
 const [options,setOptions]=useState<Options>({buildingNames:true,machineNames:true,roofs:false,upper:false});
 useEffect(()=>{let cancelled=false;let instance:Viewer|undefined;const abort=new AbortController();
  async function load(){try{const response=await fetch('/factory-layout/site-model.json',{signal:abort.signal});if(!response.ok)throw Error('โหลดโมเดลไม่สำเร็จ');const data:Model=await response.json();const url=new URL('/factory-layout/cmms-viewer.mjs',window.location.origin).href;const module=await import(/* @vite-ignore */ url);if(cancelled||!host.current)return;instance=module.mountLayout(host.current,data,setSelected);viewer.current=instance!;setModel(data);setReady(true);}catch(e){if(!cancelled)setError(e instanceof Error?e.message:'เปิดโมเดลไม่ได้');}}
  load();return()=>{cancelled=true;abort.abort();instance?.dispose();viewer.current=null;};
 },[]);
 const mapping=useMemo(()=>mapLayout(model?.items||[],assets,workOrders),[model,assets,workOrders]);
 const item=model?.items.find(i=>i.id===selected),entry=mapping.entries.find(e=>e.id===selected);
 useEffect(()=>{viewer.current?.setOptions(options);},[options,ready]);
 useEffect(()=>{viewer.current?.setStatuses(mapping.entries);},[mapping,ready]);
 useEffect(()=>{viewer.current?.select(selected);},[selected,ready]);
 const states:Record<string,string>={unmapped:'ยังไม่พบข้อมูลที่ตรงกัน',ambiguous:'รหัสตรงหลายเครื่อง — ยังไม่จับคู่',unknown:'จับคู่แล้ว · ยังไม่มีข้อมูลใบงาน',matched:'ไม่พบงานเปิดในข้อมูลที่โหลด',open:'มีงานซ่อมเปิดอยู่',urgent:'มีงานเร่งด่วนเปิดอยู่'};
 return <section className="panel factory-panel" aria-label="3D Layout โรงงาน">
  <div className="panel-heading"><div><h2>3D Layout โรงงาน</h2><p>คลิกอาคารหรือเครื่องจักรเพื่อดูทะเบียนและใบงานที่เชื่อมได้</p></div><span className="count">{mapping.matchedObjects} / {model?.items.length??'—'} จับคู่ได้</span></div>
  <div className="factory-controls">
   <button type="button" disabled={!ready} onClick={()=>viewer.current?.view('iso')}>มุมมอง 3D</button><button type="button" disabled={!ready} onClick={()=>viewer.current?.view('top')}>ด้านบน</button><button type="button" disabled={!ready} onClick={()=>viewer.current?.whole()}>ดูทั้งพื้นที่</button>
   {([['buildingNames','ชื่ออาคาร'],['machineNames','ชื่อเครื่องจักร'],['roofs','หลังคา / ผนัง'],['upper','ชั้นบน Slurry']] as [keyof Options,string][]).map(([key,label])=><label key={key}><input type="checkbox" checked={options[key]} onChange={e=>setOptions(o=>({...o,[key]:e.target.checked}))}/>{label}</label>)}
  </div>
  <div className="factory-workspace"><div className="factory-canvas" ref={host}>{!ready&&<div className="factory-loading" role={error?'alert':'status'}>{error?`เปิด 3D ไม่ได้: ${error}`:'กำลังโหลดโมเดล 3D…'}</div>}</div>
   <div className="factory-details">
    <label>อาคาร / เครื่องจักร<select aria-label="เลือกชิ้นงาน 3D" value={selected} onChange={e=>setSelected(e.target.value)}>{model?.items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    <h3>{item?.name||'เลือกชิ้นงาน'}</h3><button type="button" disabled={!ready} onClick={()=>viewer.current?.focus(selected)}>ซูมชิ้นที่เลือก</button>
    <p className="factory-estimate">รูปทรงและความสูงเป็นโมเดลประมาณ · ยังไม่ใช่แบบก่อสร้าง</p>
    <p role="status">{loading?'กำลังโหลดข้อมูล CMMS…':entry?states[entry.state]:''}</p>
    {entry?.kind==='area'&&<p>ระดับ Area: จับคู่จากชื่อพื้นที่ตรงกัน ไม่ได้ยืนยันตำแหน่งเครื่องรายตัว</p>}
    {!loading&&assets===undefined&&<p>ทะเบียนเครื่องไม่พร้อมหรือไม่มีสิทธิ์ดู จึงยังไม่แมพเครื่อง</p>}
    {!loading&&workOrders===undefined&&<p>ใบงานไม่พร้อมหรือไม่มีสิทธิ์ดู จึงยังไม่สรุปสถานะงาน</p>}
    {!!entry?.aliases.length&&<p className="factory-estimate">เทียบ {entry.kind==='area'?'Area / Location':'Machine code / Tag no.'}: {entry.aliases.join(', ')}</p>}
    <h4>ทะเบียนเครื่องที่เชื่อม ({entry?.assets.length||0})</h4>
    {entry?.assets.map((row,i)=><button type="button" className="factory-record" key={str(row,'AssetID')||i} onClick={()=>onDetail('assets',row)}><strong>{str(row,'MachineCode')||str(row,'TagNo')}</strong><span>{str(row,'AssetName')}</span></button>)}
    <h4>ใบงานที่เชื่อม ({entry?.workOrders.length||0})</h4>
    {entry?.workOrders.map((row,i)=><button type="button" className="factory-record" key={str(row,'WorkOrderID')||i} onClick={()=>onDetail('work-orders',row)}><strong>{str(row,'WorkOrderNo')} · {str(row,'StatusCode')||'ไม่ระบุสถานะ'}</strong><span>{str(row,'Title')}</span></button>)}
   </div>
  </div>
  <div className="factory-legend"><span>● สีแดง: งานเร่งด่วน</span><span>● สีเหลือง: งานเปิด</span><span>● สีเขียว: ไม่พบงานเปิดในชุดที่โหลด</span><span>ไม่มีจุด: ยังไม่แมพ</span></div>
  <p className="factory-note">ใช้เฉพาะข้อมูลที่หน้าภาพรวมโหลดได้ตามสิทธิ์ สูงสุด 5,000 รายการต่อหมวด (แหล่งข้อมูลอาจส่งมาน้อยกว่า) · ยังไม่เชื่อม: เครื่อง {assets===undefined?'—':mapping.unmappedAssets.length} / ใบงาน {workOrders===undefined?'—':mapping.unmappedWorkOrders.length} · รายการที่รหัสซ้ำหรือไม่ตรงจะไม่เดาจับคู่</p>
 </section>;
}
