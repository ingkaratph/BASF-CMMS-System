import sql from 'mssql';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {valueInventory,bangkokMonth} from './inventory-value.mjs';
export function createInventoryValuation({sqlConfig,file='server/inventory-valuations.local.json',readRows,now=()=>new Date()}={}){
 let pending,lastCapture=0,lastResult;
 const getRows=readRows||async function(){const pool=new sql.ConnectionPool(sqlConfig);try{await pool.connect();return (await pool.request().query('SELECT V.PartID,V.PartCode,V.PartName,V.Department,V.Quantity,V.CurrencyCode,P.PriceText FROM inv.vwSparePartListAPI V INNER JOIN inv.Part P ON P.PartID=V.PartID WHERE P.IsActive=1')).recordset}finally{await pool.close()}};
 function readHistory(){if(!existsSync(file))return {version:1,months:{}};const data=JSON.parse(readFileSync(file,'utf8'));if(data.version!==1||!data.months)throw Error('Invalid valuation history');return data}
 async function capture(){if(pending)return pending;pending=(async()=>{
  const rows=await getRows();if(!Array.isArray(rows)||rows.length===0)throw Error('No complete inventory data');
  const current=valueInventory(rows,now().toISOString());const history=readHistory();const month=bangkokMonth(current.asOf);
  history.months[month]=current;mkdirSync(dirname(file),{recursive:true});
  const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(history));renameSync(tmp,file);
  lastCapture=Date.now();lastResult={current,history:Object.entries(history.months).sort(([a],[b])=>a.localeCompare(b)).map(([month,{details,...snapshot}])=>({month,...snapshot}))};return lastResult;
 })();try{return await pending}finally{pending=undefined}}
 return {capture,get:()=>lastResult&&Date.now()-lastCapture<60000?Promise.resolve(lastResult):capture()};
}
