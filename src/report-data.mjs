export const get=(row,key)=>row[Object.keys(row).find(k=>k.toLowerCase()===key.toLowerCase())]??null;
export const text=(row,key)=>String(get(row,key)??'');
export function number(row,key){const v=get(row,key);return v===null||String(v).trim()===''||!Number.isFinite(Number(v))?null:Number(v)}
export const validDate=v=>Boolean(v)&&Number.isFinite(Date.parse(String(v)))&&new Date(v).getFullYear()>1901;
export const closed=r=>['COMPLETED','CLOSED','CANCELLED'].includes(text(r,'StatusCode').toUpperCase());
export const active=r=>!['false','0'].includes(text(r,'IsActive').toLowerCase());
export const late=(r,key)=>validDate(get(r,key))&&new Date(get(r,key)).getTime()<new Date(new Date().toDateString()).getTime();
export function group(rows,label,amount=()=>1){const map=new Map();for(const row of rows){const key=label(row)||'ไม่ระบุ';map.set(key,(map.get(key)||0)+amount(row))}return [...map].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value)}
export function maintenanceSummary(work,assets){
 const jobs=work.filter(r=>text(r,'StatusCode').toUpperCase()!=='CANCELLED');
 const measured=jobs.filter(r=>number(r,'DowntimeMinutes')!==null&&number(r,'DowntimeMinutes')>=0);
 const lookup=new Map(assets.map(r=>[text(r,'AssetID'),r]));
 const identity=r=>text(r,'AssetID')||text(r,'MachineCode')||'unknown';
 const machines=group(measured.filter(r=>number(r,'DowntimeMinutes')>0),identity,r=>number(r,'DowntimeMinutes')/60).map(item=>{const asset=lookup.get(item.label)||jobs.find(r=>identity(r)===item.label)||{};return {...item,label:[text(asset,'MachineCode')||text(asset,'TagNo'),text(asset,'AssetName')].filter(Boolean).join(' · ')||'ไม่ระบุเครื่องจักร'}});
 const dated=measured.filter(r=>validDate(get(r,'ActualStart'))||validDate(get(r,'RequestedDate')));
 const month=r=>String(validDate(get(r,'ActualStart'))?get(r,'ActualStart'):get(r,'RequestedDate')).slice(0,7);
 const monthly=group(dated,month,r=>number(r,'DowntimeMinutes')/60).sort((a,b)=>a.label.localeCompare(b.label));
 const trend=[];
 if(monthly.length){const last=monthly.at(-1).label;const end=new Date(last+'-01T00:00:00Z');for(let i=11;i>=0;i--){const d=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-i,1));const label=d.toISOString().slice(0,7);trend.push({label,value:monthly.find(x=>x.label===label)?.value||0})}}
 const durations=jobs.filter(r=>['COMPLETED','CLOSED'].includes(text(r,'StatusCode').toUpperCase())&&validDate(get(r,'ActualStart'))&&validDate(get(r,'ActualFinish'))).map(r=>(Date.parse(get(r,'ActualFinish'))-Date.parse(get(r,'ActualStart')))/3600000).filter(n=>n>=0);
 return {jobs,measured:measured.length,missing:jobs.length-measured.length,totalHours:measured.reduce((n,r)=>n+number(r,'DowntimeMinutes')/60,0),machines,trend,undated:measured.length-dated.length,meanRepairHours:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,durationCount:durations.length};
}
