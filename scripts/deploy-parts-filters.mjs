import 'dotenv/config';
import {setDefaultResultOrder} from 'node:dns';setDefaultResultOrder('ipv4first');
import sql from 'mssql';
import {writeFileSync,existsSync} from 'node:fs';
const pool=await sql.connect({server:process.env.CMMS_SQL_HOST||'mt.local',user:'sa',password:process.env.CMMS_SQL_PASSWORD,database:'BASF_CHEMCAT_CMMS',options:{encrypt:false,trustServerCertificate:true}});
try{
 const defs=(await pool.request().query("SELECT OBJECT_DEFINITION(OBJECT_ID('inv.vwSparePartListAPI')) AS ViewDef,OBJECT_DEFINITION(OBJECT_ID('api.usp_CMMS_Gateway')) AS ProcDef")).recordset[0];
 if(!existsSync('artifacts/parts-predeploy.local.json'))writeFileSync('artifacts/parts-predeploy.local.json',JSON.stringify(defs));
 let view=defs.ViewDef.replace(/CREATE\s+VIEW/i,'ALTER VIEW');
 if(!view.includes('P.Department'))view=view.replace('    P.Brand,','    P.Brand,\n    P.Department,\n    P.PartType,');
 let proc=defs.ProcDef.replace(/CREATE\s+PROCEDURE/i,'ALTER PROCEDURE');
 proc=proc.replace('IF @Limit > 500 SET @Limit=500;','IF @Limit > 2000 SET @Limit=2000;');
 const start=proc.indexOf("        IF @Resource=N'spare-parts'"),end=proc.indexOf("        IF @Resource=N'stock-transactions'",start);
 if(start<0||end<0)throw new Error('Unrecognized procedure structure');
 const branch=`        IF @Resource=N'spare-parts'
        BEGIN
            DECLARE @FilterDepartment nvarchar(100)=NULLIF(LTRIM(RTRIM(JSON_VALUE(@BodyJson,'$.department'))),N''),
                    @FilterPartType nvarchar(100)=NULLIF(LTRIM(RTRIM(JSON_VALUE(@BodyJson,'$.partType'))),N'');
            SELECT * INTO #FilteredParts FROM inv.vwSparePartListAPI
            WHERE (@Id IS NULL OR PartID=@Id)
              AND (@Search IS NULL OR PartCode LIKE N'%'+@Search+N'%' OR SAPMaterial LIKE N'%'+@Search+N'%' OR PartName LIKE N'%'+@Search+N'%' OR Description LIKE N'%'+@Search+N'%' OR Brand LIKE N'%'+@Search+N'%')
              AND (@FilterDepartment IS NULL OR COALESCE(NULLIF(LTRIM(RTRIM(Department)),N''),N'__missing__')=@FilterDepartment)
              AND (@FilterPartType IS NULL OR COALESCE(NULLIF(LTRIM(RTRIM(PartType)),N''),N'__missing__')=@FilterPartType);
            SELECT TOP (@Limit) * FROM #FilteredParts ORDER BY PartCode;
            SELECT DISTINCT COALESCE(NULLIF(LTRIM(RTRIM(Department)),N''),N'__missing__') AS Value FROM inv.Part ORDER BY Value;
            SELECT DISTINCT COALESCE(NULLIF(LTRIM(RTRIM(PartType)),N''),N'__missing__') AS Value FROM inv.Part ORDER BY Value;
            SELECT COUNT(*) AS Total FROM #FilteredParts;
            RETURN;
        END;

`;
 proc=proc.slice(0,start)+branch+proc.slice(end);
 const tx=new sql.Transaction(pool);await tx.begin();try{await new sql.Request(tx).batch(view);await new sql.Request(tx).batch(proc);await tx.commit()}catch(e){await tx.rollback();throw e}
 writeFileSync('deployment/sql/002-parts-filters.sql',view+'\nGO\n'+proc);
 console.log('SQL view and server-side filters updated');
}finally{await pool.close()}
if(process.argv.includes('--sql-only'))process.exit(0);
const base=process.env.CMMS_API_BASE_URL;
const r=await fetch(base+'/flows',{headers:{'Node-RED-API-Version':'v2'}});if(!r.ok)throw new Error('Cannot read flows');
const flow=await r.json();writeFileSync('artifacts/parts-predeploy-flows.local.json',JSON.stringify(flow));
const filter=flow.flows.find(n=>n.type==='function'&&n.name==='2. NODE FILTER');
if(!filter)throw new Error('Gateway filter not found');
if(!filter.func.includes('CMMS_PART_FILTERS'))filter.func=filter.func.replace('msg.bodyJson = JSON.stringify(body || {});',`// CMMS_PART_FILTERS: safe structured parameters for spare-part SELECT.
if(resource==='spare-parts'&&method==='GET'){
 for(const field of ['department','partType']){
  if(query[field]!==undefined&&(typeof query[field]!=='string'||query[field].length>100)){
   msg.statusCode=400;msg.apiError={code:'INVALID_FILTER',message:'Invalid part filter'};return [null,msg];
  }
 }
 msg.bodyJson=JSON.stringify({department:query.department||null,partType:query.partType||null});
}else msg.bodyJson=JSON.stringify(body||{});`);
filter.func=filter.func.replace('Math.min(500,','Math.min(2000,');
const connection=flow.flows.find(n=>n.type==='MSSQL-CN'&&n.database==='BASF_CHEMCAT_CMMS');if(connection)connection.server='mt.local';
const result=await fetch(base+'/flows',{method:'POST',headers:{'Content-Type':'application/json','Node-RED-API-Version':'v2','Node-RED-Deployment-Type':'nodes'},body:JSON.stringify(flow)});
if(!result.ok)throw new Error('Flow update rejected: '+result.status);
console.log('Gateway query filters deployed');
