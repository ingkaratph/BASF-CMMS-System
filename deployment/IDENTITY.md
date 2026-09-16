# บัญชีผู้ใช้และสิทธิ์ใน SQL Server

## โครงสร้างที่ติดตั้ง

ภายในฐานข้อมูลเดิม `BASF_CHEMCAT_CMMS` บน `pd.local`:

- `cmms_auth.Users`: บัญชี, ชื่อแสดง, บทบาท, สถานะ, เวอร์ชันเซสชัน และ salted scrypt hash
- `cmms_auth.IdentityState`: สิทธิ์ที่ปรับแต่งได้และเลข revision สำหรับป้องกันการเขียนทับพร้อมกัน
- `cmms_auth.AuditLog`: ประวัติการเพิ่ม/แก้ไขผู้ใช้และสิทธิ์ ไม่เก็บรหัสผ่านหรือแฮชใน audit
- `cmms_auth.usp_IdentityStorage`: อ่านและบันทึกแบบ parameterized พร้อม transaction

สคริปต์ `sql/001-identity.sql` เพิ่มเฉพาะ schema `cmms_auth` ไม่เปลี่ยนตารางงานซ่อม เครื่องจักร หรืออะไหล่ บัญชีเดิมถูกย้ายโดยรักษารหัสผ่านเดิมไว้ ไม่มีรหัสผ่านแบบ plain text ใน SQL

## เส้นทางล็อกอิน

Browser → `POST /api/login` บน CMMS → private API บน pd.local → SQL

Backend ตรวจ scrypt hash ของบัญชีจาก SQL แล้วสร้างคุกกี้ `HttpOnly`, `SameSite=Strict` อายุ 8 ชั่วโมง เบราว์เซอร์ไม่ได้รับ API key หรือ password hash ทุกคำขอที่มีเซสชันจะตรวจสถานะบัญชี เวอร์ชัน และสิทธิ์กับ SQL อีกครั้ง การปิดบัญชี เปลี่ยนรหัสผ่าน เปลี่ยนบทบาท หรือเปลี่ยนสิทธิ์ของบทบาททำให้เซสชันเดิมใช้ต่อไม่ได้

`.env` ใช้ `CMMS_IDENTITY_STORAGE=database` ไม่มีการย้อนกลับไปใช้บัญชี local เมื่อ SQL/API ใช้งานไม่ได้ ข้อความในเว็บคือ “เชื่อมต่อฐานข้อมูลไม่ได้”

ไฟล์ `server/users.local.json` เดิมเก็บไว้เป็นสำเนาก่อนย้ายเท่านั้น ไม่ใช่แหล่งข้อมูลที่เว็บใช้งานในโหมด database การสำรองข้อมูลปัจจุบันต้องสำรอง SQL ทั้ง schema `cmms_auth`

## API สำหรับเว็บและระบบภายใน

| Endpoint ของเว็บ | การใช้งาน |
|---|---|
| `POST /api/login` | `{username,password}` ล็อกอิน |
| `POST /api/logout` | ออกจากระบบ |
| `GET /api/session` | สถานะเซสชันและสิทธิ์ของผู้ใช้ |
| `GET /api/users` | รายการผู้ใช้ ไม่รวมแฮช เฉพาะ Administrator |
| `POST /api/users` | สร้างบัญชี เฉพาะ Administrator |
| `PUT /api/users/:id` | เปลี่ยนชื่อ บทบาท รหัสผ่าน หรือสถานะ |
| `GET /api/permissions` | ค่าสิทธิ์และ revision เฉพาะ Administrator |
| `PUT /api/permissions/:role` | `{revision,permissions}` บันทึกสิทธิ์ |

Private service endpoint: `POST http://pd.local:1880/cmms/identity/storage`

ต้องใช้ header `x-api-key` ที่ตรงกับ `CMMS_API_KEY_ADMIN` ใน environment ของ API server ใช้จาก backend ที่เชื่อถือได้เท่านั้น เพราะ READ ส่ง credential hashes กลับให้ backend ตรวจล็อกอิน ห้ามเรียกจาก React หรือแจกคีย์ให้ผู้ใช้ปลายทาง

รองรับ body:

```json
{"operation":"READ"}
```

```json
{"operation":"SAVE_USER","revision":4,"actor":"administrator-user-id","user":{"id":"24-character-hex-user-id","username":"technician1","displayName":"ชื่อช่าง","role":"TECHNICIAN","active":true,"version":1,"passwordHash":"salt:scrypt-derived-hash"}}
```

```json
{"operation":"SAVE_PERMISSIONS","revision":2,"actor":"admin","role":"TECHNICIAN","permissions":{"pages":{},"resources":{},"history":{}}}
```

ตัวอย่าง SAVE_PERMISSIONS แสดงโครงสร้างโดยย่อ ต้องส่ง policy ครบตาม `shared/permissions.mjs` ค่า revision เก่าตอบ 409 ห้าม retry การบันทึกโดยเขียนทับอัตโนมัติ ให้โหลดค่าล่าสุดก่อน ทุก mutation ปกติควรใช้ API ของเว็บเพื่อผ่าน validation ของบัญชีและสิทธิ์

## การปรับสิทธิ์

หน้า **ผู้ใช้และสิทธิ์** เลือก Planner, Technician หรือ Production แล้วปรับ ดู/เพิ่ม/แก้ไข/ลบ แยกตามโมดูล รวมถึงรายงาน และการแก้ไขประวัติใบงาน จากนั้นกด **บันทึกสิทธิ์**

Administrator และหน้าจัดการผู้ใช้สงวนไว้ให้ผู้ดูแลระบบเสมอ รายการรับ–เบิกและสอบเทียบไม่เปิดแก้ไข/ลบเพราะ API ธุรกิจเดิมไม่รองรับ เมื่อลดสิทธิ์ดู ระบบปิดสิทธิ์เขียนที่เกี่ยวข้องให้ด้วย สิทธิ์รายงานต้องอ่านข้อมูลต้นทางครบสี่โมดูล

## ติดตั้งซ้ำ / ย้ายเครื่อง

ใช้ `scripts/deploy-identity.mjs` จากโฟลเดอร์โปรเจกต์ โดยกำหนด `CMMS_SQL_PASSWORD`, `CMMS_SQL_HOST` และ `CMMS_SQL_USER` ใน process environment สำหรับติดตั้งเท่านั้น สคริปต์ไม่บันทึกรหัส SQL ลง `.env` หรือ bundle:

```powershell
node scripts/deploy-identity.mjs
```

สคริปต์รักษาบัญชี SQL เดิม ไม่ seed ซ้ำ และไม่เพิ่ม flow ซ้ำเมื่อ endpoint มีอยู่แล้ว การอัปเดต flow ที่ติดตั้งแล้วต้องตรวจและปรับ flow นั้นโดยตรง `deployment/identity-flow.json` เป็นสำเนา flow ที่เพิ่ม ใช้ connection configuration ของฐานข้อมูลเดิม โดยไม่มี SQL credentials อยู่ในไฟล์

Backup flow ก่อนติดตั้งอยู่ใน `artifacts/identity-predeploy-flows.local.json` เป็นไฟล์ภายใน ห้ามเผยแพร่ หากใช้เครื่องใหม่ ต้องตั้ง `.env` ให้ชี้ API และใช้คีย์ฝั่ง backend เดิม จากนั้น `npm run build` และ `npm start`

## การตรวจสอบ

`npm test` ครอบคลุมฐานสิทธิ์เดิม การปรับสิทธิ์ การป้องกัน revision ชนกัน การล็อกอินผ่าน service API การหมดอายุเซสชัน การปิดบัญชี และการปฏิเสธใช้งานเมื่อฐานข้อมูลติดต่อไม่ได้

ตรวจ live แล้ว: ย้ายบัญชีเดิม ล็อกอินผ่าน localhost สร้างบัญชีทดสอบใน SQL เปลี่ยนรหัสผ่าน ปิดบัญชี และตรวจ revoke session; ลบบัญชีทดสอบหลังเสร็จ โดยคง audit ไว้ การทดสอบเปลี่ยน policy ใน SQL ใช้ transaction แล้ว rollback เพื่อไม่เปลี่ยนสิทธิ์ใช้งานจริง
