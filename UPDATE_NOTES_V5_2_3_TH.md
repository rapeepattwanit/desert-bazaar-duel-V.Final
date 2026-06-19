# Desert Bazaar Duel v5.2.3 — Home Screen / Mobile Audio / Lobby Cleanup

แพตช์นี้แก้เฉพาะส่วนหน้าเว็บและเสียงบนมือถือ ไม่แตะ logic เกมหลัก, ระบบห้อง, scoring, reconnect หรือ WebSocket

## สิ่งที่เพิ่ม/แก้

1. รองรับ Add to Home Screen บน iPhone/iPad/มือถือ
   - เพิ่ม `public/manifest.webmanifest`
   - เพิ่ม meta/link สำหรับ PWA และ Apple Home Screen ใน `public/index.html`
   - เพิ่มชุด icon เริ่มต้นใน `public/icons/`
   - เพิ่มคู่มือเปลี่ยน icon ที่ `public/icons/README_APP_ICON_TH.md`

2. ปรับเสียงเพลงพื้นหลังบนมือถือ/iPad
   - เพลงเล่นเฉพาะตอนอยู่หน้าเกมจริง
   - เพลงหยุดเมื่อเกมจบ
   - เพลงหยุดเมื่อออกไปแท็บอื่น/แอปอื่น หรือหน้าเว็บถูกซ่อน
   - เมื่อกลับมาแท็บเกม และเกมยังไม่จบ เพลงจะเริ่มต่อได้ตาม setting และข้อจำกัด autoplay ของมือถือ

3. หน้า Home
   - ลบ tag ใต้คำโปรยออก: `สร้างห้อง`, `ส่งลิงก์`, `เล่นสด`, `มีคู่มือ`

## วิธีเปลี่ยน icon

แทนที่ไฟล์ใน `public/icons/` ด้วยรูปที่ต้องการ โดยใช้ชื่อไฟล์เดิม แล้วอัปขึ้น GitHub/deploy ใหม่

ไฟล์หลักสำหรับ iPhone/iPad คือ:

- `public/icons/app-icon.png`
- `public/icons/apple-touch-icon.png`
