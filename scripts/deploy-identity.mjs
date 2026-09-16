// Run from the project root. SQL credentials are supplied through environment only.
import 'dotenv/config';
import sql from 'mssql';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {defaultPermissions,roles,permissionResources,permissionPages,permissionMethods,immutableResources} from '../shared/permissions.mjs';
import {validateRolePermissions} from '../server/permissions-store.mjs';

const base=(process.env.CMMS_API_BASE_URL||'http://pd.local:1880').replace(/\/$/,'');
if(!process.env.CMMS_SQL_PASSWORD)throw new Error('CMMS_SQL_PASSWORD is required for deployment only');
const pool=await sql.connect({server:process.env.CMMS_SQL_HOST||'pd.local',port:1433,user:process.env.CMMS_SQL_USER||'sa',password:process.env.CMMS_SQL_PASSWORD,database:'BASF_CHEMCAT_CMMS',options:{encrypt:false,trustServerCertificate:true},connectionTimeout:15000});
try {
  const script=readFileSync('deployment/sql/001-identity.sql','utf8');
  for(const batch of script.split(/^GO\s*$/mi))if(batch.trim())await pool.request().batch(batch);
  const seeded=(await pool.request().query('SELECT COUNT(*) AS N FROM cmms_auth.IdentityState')).recordset[0].N;
  if(!seeded){
    const users=JSON.parse(readFileSync('server/users.local.json','utf8'));
    if(!users.some(u=>u.active&&u.role==='ADMINISTRATOR'))throw new Error('An active administrator is required');
    const policies=existsSync('server/permissions.local.json')?JSON.parse(readFileSync('server/permissions.local.json','utf8')):{revision:0,roleVersions:Object.fromEntries(roles.map(r=>[r,1])),roles:defaultPermissions(),changes:[]};
    for(const role of roles)validateRolePermissions(policies.roles[role]);
    await pool.request().input('users',sql.NVarChar(sql.MAX),JSON.stringify(users)).input('policies',sql.NVarChar(sql.MAX),JSON.stringify(policies)).query(`
      SET XACT_ABORT ON; BEGIN TRAN;
      IF NOT EXISTS(SELECT 1 FROM cmms_auth.IdentityState WITH(UPDLOCK,HOLDLOCK) WHERE Id=1)
      BEGIN
        IF EXISTS(SELECT 1 FROM cmms_auth.Users) THROW 51000,'Existing users require manual migration review',1;
        INSERT cmms_auth.Users(UserId,Username,DisplayName,RoleCode,IsActive,Version,PasswordHash)
        SELECT id,username,displayName,role,active,version,passwordHash FROM OPENJSON(@users) WITH(id varchar(24),username varchar(50),displayName nvarchar(100),role varchar(30),active bit,version int,passwordHash varchar(200));
        INSERT cmms_auth.IdentityState(Id,UsersRevision,PermissionsJson) VALUES(1,0,@policies);
        INSERT cmms_auth.AuditLog(Actor,Operation,Target) VALUES('deployment','MIGRATE','Local account storage');
      END;
      COMMIT;`);
    console.log('Migrated existing accounts:',users.length);
  }else console.log('Existing SQL accounts preserved');
  const counts=await pool.request().query('SELECT COUNT(*) AS UserCount FROM cmms_auth.Users');
  console.log('SQL storage ready; users:',counts.recordset[0].UserCount);
}finally{await pool.close()}

const existing=await fetch(base+'/flows',{headers:{'Node-RED-API-Version':'v2'},signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw new Error('Cannot inspect API configuration');return r.json()});
writeFileSync('artifacts/identity-predeploy-flows.local.json',JSON.stringify(existing));
if(existing.flows.some(n=>n.type==='http in'&&n.url==='/cmms/identity/storage')){
  console.log('Identity API already exists; no flow changes applied');process.exit(0);
}
const connection=existing.flows.find(n=>n.type==='MSSQL-CN'&&n.database==='BASF_CHEMCAT_CMMS');
if(!connection)throw new Error('Existing CMMS SQL connection not found');
const id=()=>randomBytes(8).toString('hex');
const [input,gate,database,response,output,catcher]=Array.from({length:6},id);
const gateCode=`
const supplied=msg.req.headers['x-api-key'];
const key=env.get('CMMS_API_KEY_ADMIN');
let difference=typeof supplied==='string'&&typeof key==='string'?(supplied.length^key.length):1;
if(typeof supplied==='string'&&typeof key==='string')for(let i=0;i<Math.max(supplied.length,key.length);i++)difference|=(supplied.charCodeAt(i)||0)^(key.charCodeAt(i)||0);
if(!key||difference){msg.statusCode=401;msg.apiError='Unauthorized';return [null,msg];}
const body=msg.payload;
if(!body||!['READ','SAVE_USER','SAVE_PERMISSIONS'].includes(body.operation)){msg.statusCode=400;msg.apiError='Invalid operation';return [null,msg];}
${'const permissionResources='+JSON.stringify(permissionResources)+';const permissionPages='+JSON.stringify(permissionPages)+';const permissionMethods='+JSON.stringify(permissionMethods)+';const immutableResources='+JSON.stringify(immutableResources)+';'}
${validateRolePermissions.toString()}
try {if(body.operation==='SAVE_PERMISSIONS')validateRolePermissions(body.permissions);}catch(e){msg.statusCode=400;msg.apiError=e.message;return [null,msg];}
msg.operation=body.operation;msg.bodyJson=JSON.stringify(body);
if(msg.bodyJson.length>65536){msg.statusCode=413;msg.apiError='Payload too large';return [null,msg];}
delete msg.req.headers['x-api-key'];
return [msg,null];`;
const respondCode=`
msg.headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
if(msg.error||msg.apiError){
 const conflict=/revision conflict|version conflict/i.test(msg.error?.message||'');
 msg.statusCode=msg.statusCode>=400?msg.statusCode:conflict?409:503;
 msg.payload={ok:false,error:{message:msg.apiError||(conflict?'Revision conflict':'เชื่อมต่อฐานข้อมูลไม่ได้')}};
}else{try{
 const row=msg.payload?.recordset?.[0]||msg.payload?.[0];
 const data=JSON.parse(row.Json);msg.statusCode=200;msg.payload={ok:true,data};
}catch{msg.statusCode=503;msg.payload={ok:false,error:{message:'เชื่อมต่อฐานข้อมูลไม่ได้'}}}}
delete msg.bodyJson;return msg;`;
const param=(name,type,value)=>({name,type,value,valueType:'msg',output:false,options:{nullable:false}});
const nodes=[
 {id:input,type:'http in',url:'/cmms/identity/storage',method:'post',name:'CMMS identity service',x:170,y:120,wires:[[gate]]},
 {id:gate,type:'function',name:'Service authorization and validation',func:gateCode,outputs:2,libs:[],x:440,y:120,wires:[[database],[response]]},
 {id:database,type:'MSSQL',mssqlCN:connection.id,name:'Identity stored procedure',outField:'payload',returnType:'1',throwErrors:'1',query:'cmms_auth.usp_IdentityStorage',modeOptType:'execute',queryOptType:'editor',paramsOptType:'editor',parseMustache:false,params:[param('Operation','VarChar(30)','operation'),param('BodyJson','NVarChar(MAX)','bodyJson')],x:740,y:120,wires:[[response]]},
 {id:response,type:'function',name:'Private identity response',func:respondCode,outputs:1,libs:[],x:990,y:120,wires:[[output]]},
 {id:output,type:'http response',name:'Service response',statusCode:'',headers:{},x:1230,y:120,wires:[]},
 {id:catcher,type:'catch',name:'Identity errors',scope:[database,gate],uncaught:false,x:730,y:220,wires:[[response]]}
];
const flow={label:'CMMS Identity API',info:'Private backend service, ADMIN API key required. Do not call from browser. Credential hashes remain server-side.',nodes,configs:[]};
writeFileSync('deployment/identity-flow.json',JSON.stringify(flow,null,2));
const r=await fetch(base+'/flow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(flow),signal:AbortSignal.timeout(20000)});
if(!r.ok)throw new Error('Identity flow deployment failed: '+r.status);
console.log('Identity API deployed:',await r.text());
