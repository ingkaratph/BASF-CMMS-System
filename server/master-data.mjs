import sql from 'mssql';
import {createHash} from 'node:crypto';
export const vendorFields={VendorCode:50,VendorName:150,ContactName:150,Phone:80,Email:255};
export const vendorVersion=row=>createHash('sha256').update(JSON.stringify([...Object.keys(vendorFields).map(k=>row[k]??null),Boolean(row.IsActive)])).digest('hex');
export function validateVendor(body,editing=false){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!Object.hasOwn(vendorFields,k)&&!['IsActive','Version'].includes(k)))throw Object.assign(Error('รูปแบบข้อมูล Vendor ไม่ถูกต้อง'),{status:400});
 const out={};for(const [key,max]of Object.entries(vendorFields)){const v=body[key];if(v!==null&&v!==undefined&&typeof v!=='string')throw Object.assign(Error('ข้อมูลต้องเป็นข้อความ'),{status:400});const s=v?.trim()||null;if(s&&s.length>max)throw Object.assign(Error(`${key} ยาวเกิน ${max} ตัวอักษร`),{status:400});out[key]=s}
 if(!out.VendorName||typeof body.IsActive!=='boolean')throw Object.assign(Error('กรุณาระบุชื่อ Vendor และสถานะ'),{status:400});
 if(out.Email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.Email))throw Object.assign(Error('อีเมลไม่ถูกต้อง'),{status:400});
 if(editing&&!/^[a-f0-9]{64}$/.test(body.Version||''))throw Object.assign(Error('กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไข'),{status:400});
 return {...out,IsActive:body.IsActive};
}
export function createMasterData(config){
 async function withPool(fn){const pool=new sql.ConnectionPool(config);try{await pool.connect();return await fn(pool)}finally{await pool.close()}}
 return {
 planningDetails:()=>withPool(async pool=>(await pool.request().query('SELECT PartID,StandardCost,CurrencyCode,LeadTimeDays,LeadTimeText FROM inv.Part WHERE IsActive=1')).recordset),
 partDetails:id=>withPool(async pool=>(await pool.request().input('id',sql.BigInt,id).query('SELECT PartID,StandardCost,CurrencyCode,LeadTimeDays,LeadTimeText FROM inv.Part WHERE PartID=@id')).recordset[0]||null),
 partHistory:(id,page)=>withPool(async pool=>{
  const part=(await pool.request().input('id',sql.BigInt,id).query('SELECT PartID,SAPMaterial FROM inv.Part WHERE PartID=@id')).recordset[0];
  if(!part)throw Object.assign(Error('ไม่พบอะไหล่'),{status:404});
  const result=await pool.request().input('id',sql.BigInt,id).input('material',sql.NVarChar(50),part.SAPMaterial?.trim()||null).input('offset',sql.Int,(page-1)*50).query(`
   SELECT COUNT(*) Total FROM inv.StockTransaction T JOIN inv.Part P ON P.PartID=T.PartID WHERE (@material IS NOT NULL AND P.SAPMaterial=@material) OR (@material IS NULL AND P.PartID=@id);
   SELECT T.StockTransactionID,T.TransactionDate,T.Quantity,T.SAPDocumentNo,T.ReferenceNo,T.RequestNumber,T.IssuedTo,T.MachineCodeText,T.Remark,T.IsHistorical,P.PartCode,P.SAPMaterial,TT.TypeCode,TT.QuantitySign
   FROM inv.StockTransaction T JOIN inv.Part P ON P.PartID=T.PartID JOIN ref.InventoryTransactionType TT ON TT.TransactionTypeID=T.TransactionTypeID
   WHERE (@material IS NOT NULL AND P.SAPMaterial=@material) OR (@material IS NULL AND P.PartID=@id)
   ORDER BY T.TransactionDate DESC,T.StockTransactionID DESC OFFSET @offset ROWS FETCH NEXT 50 ROWS ONLY OPTION(RECOMPILE,MAXDOP 1,LOOP JOIN,MAX_GRANT_PERCENT=1);`);
  return {material:part.SAPMaterial,total:result.recordsets[0][0].Total,page,pageSize:50,rows:result.recordsets[1]};
 }),
 vendors:()=>withPool(async p=>(await p.request().query('SELECT VendorID,VendorCode,VendorName,ContactName,Phone,Email,IsActive FROM cmms.Vendor ORDER BY VendorName,VendorID')).recordset.map(r=>({...r,Version:vendorVersion(r)}))),
 saveVendor:(id,body)=>{const data=validateVendor(body,id!==null);return withPool(async pool=>{
  const tx=new sql.Transaction(pool);await tx.begin();try{
   if(id!==null){const old=(await new sql.Request(tx).input('id',sql.Int,id).query('SELECT * FROM cmms.Vendor WITH (UPDLOCK,HOLDLOCK) WHERE VendorID=@id')).recordset[0];if(!old)throw Object.assign(Error('ไม่พบ Vendor'),{status:404});if(vendorVersion(old)!==body.Version)throw Object.assign(Error('มีผู้แก้ไขข้อมูลนี้แล้ว กรุณาโหลดใหม่'),{status:409})}
   const req=new sql.Request(tx);for(const [k,len]of Object.entries(vendorFields))req.input(k,sql.NVarChar(len),data[k]);req.input('IsActive',sql.Bit,data.IsActive);
   const columns=Object.keys(data),query=id===null?`INSERT INTO cmms.Vendor (${columns.join(',')}) OUTPUT INSERTED.* VALUES (${columns.map(k=>'@'+k).join(',')})`:`UPDATE cmms.Vendor SET ${columns.map(k=>k+'=@'+k).join(',')} OUTPUT INSERTED.* WHERE VendorID=@id`;
   if(id!==null)req.input('id',sql.Int,id);const row=(await req.query(query)).recordset[0];await tx.commit();return {...row,Version:vendorVersion(row)};
  }catch(e){await tx.rollback();throw e}
 })},
 calibrationPoints:(eventId=null)=>withPool(async pool=>(await pool.request().input('eventId',sql.BigInt,eventId).query(`SELECT S.CalibrationSpecID,S.AssetID,A.MachineCode,A.TagNo,A.AssetName,S.Description,S.IsActive,P.PointNo,P.SetpointValue FROM cmms.CalibrationSpec S LEFT JOIN cmms.Asset A ON A.AssetID=S.AssetID LEFT JOIN cmms.CalibrationPoint P ON P.CalibrationSpecID=S.CalibrationSpecID WHERE @eventId IS NULL OR EXISTS (SELECT 1 FROM cmms.CalibrationEvent E WHERE E.CalibrationEventID=@eventId AND ((E.CalibrationSpecID IS NOT NULL AND E.CalibrationSpecID=S.CalibrationSpecID) OR (E.CalibrationSpecID IS NULL AND E.AssetID=S.AssetID))) ORDER BY A.TagNo,S.CalibrationSpecID,P.PointNo`)).recordset),
 pmHistory:()=>withPool(async pool=>{
  const r=await pool.request().query(`SELECT W.WorkOrderID,W.WorkOrderNo,W.PlanID,W.AssetID,A.MachineCode,A.TagNo,A.AssetName,W.Title,W.ActualStart,W.ActualFinish,W.ActionTaken,S.StatusCode,T.TypeCode FROM cmms.WorkOrder W LEFT JOIN cmms.Asset A ON A.AssetID=W.AssetID LEFT JOIN ref.WorkOrderStatus S ON S.WorkOrderStatusID=W.WorkOrderStatusID LEFT JOIN ref.MaintenanceType T ON T.MaintenanceTypeID=W.WorkTypeID LEFT JOIN cmms.MaintenancePlan P ON P.PlanID=W.PlanID LEFT JOIN ref.MaintenanceType PT ON PT.MaintenanceTypeID=P.MaintenanceTypeID WHERE (T.TypeCode='PM' OR PT.TypeCode='PM') AND S.StatusCode IN ('COMPLETED','CLOSED') ORDER BY W.ActualFinish DESC,W.WorkOrderID DESC;
 SELECT P.PlanID,P.PlanCode,P.AssetID,A.MachineCode,A.TagNo,A.AssetName,P.TaskDescription,P.LastMaintenanceDate,P.NextDueDate,P.Remark,T.TypeCode,T.TypeName,V.VendorName FROM cmms.MaintenancePlan P LEFT JOIN cmms.Asset A ON A.AssetID=P.AssetID LEFT JOIN ref.MaintenanceType T ON T.MaintenanceTypeID=P.MaintenanceTypeID LEFT JOIN cmms.Vendor V ON V.VendorID=P.VendorID WHERE P.LastMaintenanceDate>'19011231' ORDER BY P.LastMaintenanceDate DESC,P.PlanID DESC`);
  return {completedWorkOrders:r.recordsets[0],lastPlanDates:r.recordsets[1]};
 })
 };
}
export function installMasterDataRoutes(app,service,access,perform){
 app.get('/api/replenishment/details',async(req,res)=>{
  if(!['ADMINISTRATOR','PLANNER'].includes(req.user?.role)||!access(req,'spare-parts'))return res.status(403).json({ok:false,error:{message:'เฉพาะ Planner และ Administrator'}});
  try{if(!service)throw Error();res.json({ok:true,data:await service.planningDetails()})}catch{res.status(503).json({ok:false,error:{message:'โหลดข้อมูลวางแผนไม่ได้ กรุณาลองอีกครั้ง'}})}
 });
 const route=(page,action)=>async(req,res)=>{if(!access(req,page))return res.status(403).json({ok:false,error:{message:'คุณไม่มีสิทธิ์ใช้ฟังก์ชันนี้'}});if(!service)return res.status(503).json({ok:false,error:{message:'เชื่อมต่อฐานข้อมูลไม่ได้'}});try{await action(req,res)}catch(e){const status=[400,404,409].includes(e.status)?e.status:503;res.status(status).json({ok:false,error:{message:status===503?'เชื่อมต่อฐานข้อมูลไม่ได้':e.message}})}};
 app.get('/api/vendors',route('vendors',async(req,res)=>res.json({ok:true,data:await service.vendors()})));
 app.get('/api/parts/:id/details',route('spare-parts',async(req,res)=>{
  if(!/^[1-9]\d{0,17}$/.test(req.params.id))return res.status(400).json({ok:false,error:{message:'รหัสอะไหล่ไม่ถูกต้อง'}});
  const data=await service.partDetails(req.params.id);
  if(!data)return res.status(404).json({ok:false,error:{message:'ไม่พบอะไหล่'}});
  res.json({ok:true,data});
 }));
 app.get('/api/parts/:id/history',route('stock-transactions',async(req,res)=>{
  if(!access(req,'spare-parts'))return res.status(403).json({ok:false,error:{message:'ไม่มีสิทธิ์ดูคลังอะไหล่'}});
  const page=String(req.query.page||'1');
  if(!/^[1-9]\d{0,17}$/.test(req.params.id)||! /^[1-9]\d{0,5}$/.test(page))return res.status(400).json({ok:false,error:{message:'รหัสหรือหน้าที่ระบุไม่ถูกต้อง'}});
  res.json({ok:true,data:await service.partHistory(req.params.id,Number(page))});
 }));
 const save=route('vendors',async(req,res)=>{if(!perform(req,req.method))return res.status(403).json({ok:false,error:{message:'ไม่มีสิทธิ์เพิ่มหรือแก้ไข Vendor'}});let id=null;if(req.method==='PUT'){if(!/^[1-9]\d*$/.test(req.params.id)||Number(req.params.id)>2147483647)return res.status(400).json({ok:false,error:{message:'Vendor ID ไม่ถูกต้อง'}});id=Number(req.params.id)}res.json({ok:true,data:await service.saveVendor(id,req.body)})});
 app.post('/api/vendors',save);app.put('/api/vendors/:id',save);
 app.get('/api/calibration-points',route('calibration-history',async(req,res)=>{const id=req.query.eventId;if(id!==undefined&&(typeof id!=='string'||! /^[1-9]\d{0,17}$/.test(id)))return res.status(400).json({ok:false,error:{message:'Calibration ID ไม่ถูกต้อง'}});res.json({ok:true,data:await service.calibrationPoints(id||null)})}));
 app.get('/api/pm-history',route('pm-history',async(req,res)=>res.json({ok:true,data:await service.pmHistory()})));
}
