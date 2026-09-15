# เปิด CMMS ที่ http://pd.local (พอร์ต 80)

## สถานะที่ตรวจพบ

- PC ที่พัฒนา: PE_BCTL / 192.168.0.111
- pd.local: 192.168.0.103 มี IIS 10 ตอบพอร์ต 80 อยู่แล้ว
- บน PC ที่พัฒนา พอร์ต 80 ใช้โดย Windows HTTP.sys และบริการ AVEVA/อื่น ๆ

จึงใช้ IIS บน pd.local เป็นทางเข้าพอร์ต 80 และให้ส่งต่อไปยัง Node.js พอร์ต 3000 บนเครื่อง pd.local เดียวกัน ผู้ใช้เปิด `http://pd.local` โดยไม่ต้องใส่พอร์ต

## การติดตั้งบนเครื่อง pd.local

1. ย้ายโปรเจกต์ CMMS และไฟล์ตั้งค่า `.env` ไปไว้ในโฟลเดอร์แอปบน pd.local ซึ่งต้องอยู่นอก web root ของ IIS
2. ติดตั้ง Node.js และ dependencies แล้ว build โปรเจกต์
3. ตั้ง `HOST=127.0.0.1`, `PORT=3000` และ `CMMS_APP_PASSWORD` ใน `.env` พร้อม API Key ฝั่งเซิร์ฟเวอร์เดิม
4. เริ่ม CMMS และตั้งให้รันต่อเนื่องหลัง restart เครื่อง
5. ตรวจว่าติดตั้ง IIS URL Rewrite และ Application Request Routing (ARR) แล้ว
6. เปิด proxy และ `preserveHostHeader` ใน ARR ระดับเซิร์ฟเวอร์ เพื่อให้ Host และ Origin ตรงกันที่ `pd.local`
7. สร้าง IIS site สำหรับ CMMS โดยใช้เฉพาะโฟลเดอร์ `deployment/iis` นี้เป็น physical path และ binding `http / port 80 / host name pd.local` ต้องตรวจ binding เดิมก่อนเพื่อไม่ทับเว็บไซต์อื่น
8. ทดสอบหน้าแรก, login, อ่าน API, cookie และ logout ผ่าน `http://pd.local` และทดสอบจากอุปกรณ์อื่นใน LAN

`web.config` ที่เตรียมไว้ยังไม่ถูกนำไปใช้บน pd.local และจะใช้ได้หลังติดตั้ง CMMS บนเครื่องนั้นแล้วเท่านั้น ไม่ได้เปลี่ยน DNS หรือหยุดบริการเดิม

หากเลือกให้ Node.js รันบน PC 192.168.0.111 ต่อ ต้องเปลี่ยนปลายทาง proxy เป็น PC นั้น เปิด listener เฉพาะ LAN ตั้งรหัสผ่าน และจำกัด firewall ให้ IIS ของ pd.local เข้าถึงได้ วิธีนี้มีเงื่อนไขว่า PC ต้องเปิดอยู่ตลอด
