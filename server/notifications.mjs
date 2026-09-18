import sql from 'mssql';

const audienceSql = `(
 (@role IN ('ADMINISTRATOR','PLANNER') AND a.Entity='StockTransaction')
 OR (@role='TECHNICIAN' AND (
   (a.Entity='WorkOrder' AND a.Action='CREATE')
   OR (a.Entity='PartLoan' AND a.Action='UPDATE' AND EXISTS(
     SELECT 1 FROM inv.PartLoan l WHERE l.LoanID=a.RecordID AND l.UserId=@user AND l.Status='RETURNED'
   ))
 ))
)`;

export function installNotifications(app,config,access){
 async function run(fn){const p=new sql.ConnectionPool(config);try{await p.connect();return await fn(p)}finally{await p.close()}}
 const allowed=req=>['ADMINISTRATOR','PLANNER','TECHNICIAN'].includes(req.user.role);
 const route=(admin,fn)=>async(req,res)=>{
  if(admin?req.user.role!=='ADMINISTRATOR':!allowed(req))return res.status(403).json({ok:false,error:{message:'ไม่มีสิทธิ์ดูการแจ้งเตือน'}});
  try{res.json({ok:true,data:await run(p=>fn(p,req))})}catch(e){console.error('Notification error',e);res.status(503).json({ok:false,error:{message:'เชื่อมต่อฐานข้อมูลไม่ได้'}})}
 };
 const scoped=(request,user)=>request.input('user',sql.VarChar(24),user.id).input('role',sql.VarChar(24),user.role);

 app.use('/api',(req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)){const actor=req.user?.username||'unknown',path=req.path,method=req.method;res.on('finish',()=>{run(async p=>{await p.request().input('actor',sql.NVarChar(100),actor).input('path',sql.NVarChar(300),path.slice(0,300)).input('method',sql.VarChar(10),method).input('status',sql.Int,res.statusCode).query('INSERT cmms.SystemActivity(Actor,Path,Method,StatusCode) VALUES(@actor,@path,@method,@status)');if(res.statusCode<400&&path.startsWith('/media/spare-parts/'))await p.request().input('summary',sql.NVarChar(1000),actor+' · '+method+' · '+path).query("INSERT cmms.InventoryActivity(Entity,Action,Summary) VALUES('PartMedia','UPDATE',@summary)")}).catch(()=>console.error('Activity logger write failed'))})}next()});

 app.get('/api/notifications',route(false,async(p,r)=>{
  const j=await scoped(p.request(),r.user).query(`
   SELECT COUNT(*) Unread FROM cmms.InventoryActivity a
   WHERE ${audienceSql} AND NOT EXISTS(SELECT 1 FROM cmms.NotificationRead n WHERE n.UserId=@user AND n.ActivityID=a.ActivityID);
   SELECT TOP(200) a.*,CASE WHEN n.ActivityID IS NULL THEN 0 ELSE 1 END IsRead
   FROM cmms.InventoryActivity a LEFT JOIN cmms.NotificationRead n ON n.ActivityID=a.ActivityID AND n.UserId=@user
   WHERE ${audienceSql}
   ORDER BY CASE WHEN n.ActivityID IS NULL THEN 0 ELSE 1 END,a.ActivityID DESC;
   SELECT p.PartID,p.PartCode,p.PartName FROM inv.NewPartWatch w JOIN inv.Part p ON p.PartID=w.PartID
   WHERE @role IN ('ADMINISTRATOR','PLANNER') AND NULLIF(LTRIM(RTRIM(p.SAPMaterial)),'') IS NULL ORDER BY w.CreatedAt DESC;`);
  return {audience:r.user.role,unread:j.recordsets[0][0].Unread,activities:j.recordsets[1],missing:j.recordsets[2]};
 }));

 app.post('/api/notifications/:id/read',route(false,async(p,r)=>{
  if(!/^\d+$/.test(r.params.id))throw Error('invalid notification');
  await scoped(p.request(),r.user).input('id',sql.BigInt,r.params.id).query(`SET XACT_ABORT ON; BEGIN TRAN;
   IF EXISTS(SELECT 1 FROM cmms.InventoryActivity a WHERE a.ActivityID=@id AND ${audienceSql})
   AND NOT EXISTS(SELECT 1 FROM cmms.NotificationRead WITH(UPDLOCK,HOLDLOCK) WHERE UserId=@user AND ActivityID=@id)
   INSERT cmms.NotificationRead(UserId,ActivityID) VALUES(@user,@id); COMMIT;`);
  return {read:true};
 }));

 app.post('/api/notifications/read-all',route(false,async(p,r)=>{
  const result=await scoped(p.request(),r.user).query(`SET XACT_ABORT ON; BEGIN TRAN;
   INSERT cmms.NotificationRead(UserId,ActivityID)
   SELECT @user,a.ActivityID FROM cmms.InventoryActivity a WHERE ${audienceSql}
   AND NOT EXISTS(SELECT 1 FROM cmms.NotificationRead n WITH(UPDLOCK,HOLDLOCK) WHERE n.UserId=@user AND n.ActivityID=a.ActivityID);
   DECLARE @count int=@@ROWCOUNT; COMMIT; SELECT @count MarkedRead;`);
  return {read:true,markedRead:result.recordset[0].MarkedRead};
 }));

 app.get('/api/datalogger',route(true,async(p,r)=>{const page=Math.max(1,Math.min(100000,parseInt(String(r.query.page))||1));const j=await p.request().input('offset',sql.Int,(page-1)*100).query("SELECT COUNT(*) Total FROM (SELECT ActivityID FROM cmms.InventoryActivity UNION ALL SELECT LogID FROM cmms.SystemActivity) x; SELECT * FROM (SELECT CONCAT('inventory-',ActivityID) ActivityID,OccurredAt,Entity,Action,Summary FROM cmms.InventoryActivity UNION ALL SELECT CONCAT('system-',LogID),OccurredAt,N'System',Method,CONCAT(Actor,' · ',Path,' · HTTP ',StatusCode) FROM cmms.SystemActivity) x ORDER BY OccurredAt DESC,ActivityID DESC OFFSET @offset ROWS FETCH NEXT 100 ROWS ONLY");return {total:j.recordsets[0][0].Total,rows:j.recordsets[1],page}}));
}
