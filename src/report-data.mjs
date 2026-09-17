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
export const transactionType=r=>(text(r,'TransactionTypeCode')||text(r,'TransactionType')).toUpperCase();
export function stockSummary(transactions,parts,estimate=false,fallbackCurrency=''){
 const lookup=new Map(parts.map(r=>[text(r,'PartID'),r]));
 const values=[];let excluded=0,undated=0,unknownType=0,inferredCurrency=0,missingCost=0,missingCurrency=0,assumedCurrency=0;
 for(const row of transactions){
  const type=transactionType(row);if(!['RECEIVE','ISSUE','RETURN'].includes(type)){unknownType++;continue}
  const qty=number(row,'Quantity'),part=lookup.get(text(row,'PartID'))||{};
  const recorded=number(row,'UnitCost'),standard=number(part,'StandardCost');
  const estimated=(recorded===null||recorded<0)&&estimate&&standard!==null&&standard>=0;
  const cost=estimated?standard:recorded;
  const ownCurrency=text(row,'CurrencyCode').trim().toUpperCase(),masterCurrency=text(part,'CurrencyCode').trim().toUpperCase(),currency=ownCurrency||masterCurrency||fallbackCurrency;
  if(cost===null||cost<0)missingCost++;
  if(!ownCurrency&&!masterCurrency)missingCurrency++;
  if(qty===null||qty<0||cost===null||cost<0||!currency){excluded++;continue}
  if(!ownCurrency&&masterCurrency)inferredCurrency++;
  if(!ownCurrency&&!masterCurrency&&fallbackCurrency)assumedCurrency++;
  const amount=qty*cost;if(!Number.isFinite(amount)){excluded++;continue}
  const month=validDate(get(row,'TransactionDate'))?text(row,'TransactionDate').slice(0,7):null;
  if(!month)undated++;
  values.push({row,type,currency,amount,estimated,month});
 }
 const currencies=[...new Set(values.map(x=>x.currency))].sort();
 const summaries=currencies.map(currency=>{const entries=values.filter(x=>x.currency===currency),months=[...new Set(transactions.filter(r=>['RECEIVE','ISSUE','RETURN'].includes(transactionType(r))&&validDate(get(r,'TransactionDate'))).map(r=>text(r,'TransactionDate').slice(0,7)))].sort();
  const total=(list,type)=>{const filtered=list.filter(x=>x.type===type);return filtered.length?filtered.reduce((n,x)=>n+x.amount,0):null};
  const totals=list=>{const receive=total(list,'RECEIVE'),issue=total(list,'ISSUE'),returned=total(list,'RETURN');return {receive,issue,returned,net:issue===null&&returned===null?null:(issue||0)-(returned||0)}};
  return {currency,...totals(entries),months:months.map(month=>({month,...totals(entries.filter(x=>x.month===month))})),topParts:group(entries.filter(x=>x.type==='ISSUE'),x=>[text(x.row,'PartCode'),text(x.row,'PartName')].filter(Boolean).join(' · '),x=>x.amount)};
 });
 return {summaries,valued:values.length,estimated:values.filter(x=>x.estimated).length,excluded,undated,unknownType,inferredCurrency,missingCost,missingCurrency,assumedCurrency};
}
export function compliance(rows){const completed=rows.filter(r=>['COMPLETED','CLOSED'].includes(text(r,'StatusCode').toUpperCase()));const eligible=completed.filter(r=>validDate(get(r,'ActualFinish'))&&validDate(get(r,'DueDate')));const onTime=eligible.filter(r=>Date.parse(get(r,'ActualFinish'))<=Date.parse(get(r,'DueDate'))).length;return {eligible:eligible.length,missing:completed.length-eligible.length,onTime,rate:eligible.length?onTime/eligible.length*100:null}}
export function backlogAge(rows,now=new Date()) {const days=r=>validDate(get(r,'RequestedDate'))?Math.floor((now-new Date(get(r,'RequestedDate')))/86400000):null;const bins=['0–7 วัน','8–30 วัน','31–90 วัน','มากกว่า 90 วัน','วันที่ไม่ครบ/อนาคต'];return bins.map(label=>({label,value:rows.filter(r=>!closed(r)).filter(r=>{const n=days(r);return (n===null||n<0?bins[4]:n<=7?bins[0]:n<=30?bins[1]:n<=90?bins[2]:bins[3])===label}).length}))}
export function monthlyCounts(rows,key){return group(rows.filter(r=>validDate(get(r,key))),r=>text(r,key).slice(0,7)).sort((a,b)=>a.label.localeCompare(b.label))}
