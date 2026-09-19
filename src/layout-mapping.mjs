// Only explicit CAD tags and exact Area/Location aliases are used. No fuzzy-name links.
export const layoutTags = {
 'coater-0':['X-105'], 'predryer-0':['X-115'], 'coater-1':['X-104'],
 'predryer-1':['X-114'], 'shear-133':['X-133'], 'shear-134':['X-134'],
 'calciner-2':['X-123'], 'coater-101':['X-101'], 'calciner-121':['X-121'],
 'rhk':['X-120'], 'dust-collector':['F-102'],
 'slurry-l1-0':['R-111'], 'slurry-l1-1':['R-112'], 'slurry-l1-2':['R-113'],
 'slurry-l1-3':['R-114'], 'slurry-l1-4':['R-115'],
 'slurry-l2-0':['R-101'], 'slurry-l2-1':['R-102'], 'slurry-l2-2':['R-103'],
};
export const layoutAreas = {
 warehouse:['WARE HOUSE','WAREHOUSE'], slurry:['SLURRY','SLURRY BUILDING'],
 'cng-shelter':['CNG'], 'guard':['GUARD HOUSE'],
 'water-plant':['WASTE WATER TREATMENT','WASTE WATER TREATMENT PLANT','DM WATER'],
};
const field=(row,key)=>row?.[Object.keys(row||{}).find(k=>k.toLowerCase()===key.toLowerCase())];
const norm=v=>String(v??'').normalize('NFKC').trim().toUpperCase().replace(/[–—]/g,'-').replace(/\s+/g,' ');
const tag=v=>norm(v).replace(/\s*-\s*/g,'-');
const id=row=>norm(field(row,'AssetID'));
const codes=row=>['MachineCode','TagNo'].map(k=>tag(field(row,k))).filter(Boolean);
const areas=row=>['AreaCode','AreaName','Area','LocationCode','LocationName','Location'].map(k=>norm(field(row,k))).filter(Boolean);
const closed=row=>['COMPLETED','CLOSED','CANCELLED'].includes(norm(field(row,'StatusCode')));
const urgent=row=>['CRITICAL','URGENT','VERY_HIGH'].includes(norm(field(row,'PriorityCode')));
export function mapLayout(items,assets,workOrders){
 const assetRows=assets||[],jobs=workOrders||[],usedAssets=new Set(),usedJobs=new Set();
 const entries=items.map(item=>{
  const isArea=item.category==='buildings';
  const aliases=(isArea?layoutAreas[item.id]:layoutTags[item.id])||[];
  const matches=assetRows.filter(row=>(isArea?areas(row):codes(row)).some(v=>aliases.includes(v)));
  const ambiguous=!isArea&&matches.length>1;
  const matched=ambiguous?[]:matches;
  let related=[];
  if(isArea){related=jobs.filter(row=>areas(row).some(v=>aliases.includes(v))||matched.some(a=>id(a)&&id(a)===id(row)));}
  else if(matched.length===1){
   const a=matched[0];
   related=jobs.filter(row=>id(row)?Boolean(id(a)&&id(row)===id(a)):codes(row).some(v=>codes(a).includes(v)));
  }
  matched.forEach(a=>usedAssets.add(a));related.forEach(j=>usedJobs.add(j));
  const active=related.filter(j=>!closed(j));
  const state=ambiguous?'ambiguous':!matched.length&&!related.length?'unmapped':workOrders===undefined?'unknown':active.some(urgent)?'urgent':active.length?'open':'matched';
  return {id:item.id,kind:isArea?'area':'asset',assets:matched,workOrders:related,activeCount:workOrders===undefined?null:active.length,state,aliases};
 });
 return {entries,matchedObjects:entries.filter(e=>e.assets.length||e.workOrders.length).length,unmappedAssets:assetRows.filter(a=>!usedAssets.has(a)),unmappedWorkOrders:jobs.filter(j=>!usedJobs.has(j))};
}
