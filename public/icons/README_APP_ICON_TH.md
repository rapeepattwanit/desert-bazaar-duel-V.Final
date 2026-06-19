# วิธีเปลี่ยนรูป Icon สำหรับ Add to Home Screen

ไฟล์หลักที่ iPhone/iPad ใช้คือ:

- `public/icons/app-icon.png`
- `public/icons/apple-touch-icon.png`

ถ้าต้องการใช้รูปของตัวเอง ให้เตรียมรูป PNG แบบสี่เหลี่ยมจัตุรัส แนะนำ 1024x1024 px แล้วแทนที่ไฟล์เหล่านี้ด้วยชื่อเดิม:

1. `app-icon.png` ขนาด 1024x1024 px
2. `apple-touch-icon.png` ขนาด 180x180 px
3. `icon-192.png` ขนาด 192x192 px
4. `icon-512.png` ขนาด 512x512 px

หลังแก้รูปแล้วให้ commit/push ขึ้น GitHub และ deploy ใหม่ จากนั้นลบ icon เก่าบน Home Screen ก่อน แล้วค่อย Add to Home Screen ใหม่ เพราะ Safari/iOS มัก cache icon เดิมไว้
