export function installPasswordRoute(app,{read,authenticate,saveUser,revoke}){
 const attempts=new Map();
 app.post('/api/account/password',async(req,res)=>{
  const b=req.body,u=req.user;
  if(!b||Object.keys(b).some(k=>!['currentPassword','newPassword'].includes(k))||typeof b.currentPassword!=='string'||b.currentPassword.length>128||typeof b.newPassword!=='string'||b.newPassword.length<6||b.newPassword.length>128)return res.status(400).json({ok:false,error:{message:'รหัสผ่านใหม่ต้องมี 6–128 ตัวอักษร'}});
  const prior=attempts.get(u.id);if(prior?.count>=5&&prior.until>Date.now())return res.status(429).json({ok:false,error:{message:'รหัสผ่านเดิมผิดหลายครั้ง กรุณาลองใหม่ใน 15 นาที'}});
  try{const state=await read();const valid=await authenticate(state,u.username,b.currentPassword);if(!valid||valid.id!==u.id){attempts.set(u.id,{count:prior?.until>Date.now()?prior.count+1:1,until:Date.now()+15*60000});return res.status(400).json({ok:false,error:{message:'รหัสผ่านปัจจุบันไม่ถูกต้อง'}})}await saveUser(u.id,{password:b.newPassword},u.id);attempts.delete(u.id);revoke(u.id);res.clearCookie('cmms_session',{path:'/'});return res.json({ok:true})}catch(e){return res.status(e.status||400).json({ok:false,error:{message:e.message}})}
 });
}
