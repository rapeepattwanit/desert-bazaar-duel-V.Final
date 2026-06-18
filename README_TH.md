# Desert Bazaar Duel v5.0.0

เว็บบอร์ดเกมค้าขายออนไลน์ 2 คนสำหรับเล่นผ่านมือถือ, iPad, laptop และ desktop โดยใช้ธีมตลาดทะเลทรายและ assets ของโปรเจกต์เอง

## โครงสร้างไฟล์ล่าสุด

```txt
server.js                 # WebSocket server + game logic
package.json              # scripts/dependencies/version
package-lock.json         # lock dependency สำหรับ npm ci
render.yaml               # ตัวอย่าง config สำหรับ Render
public/
  index.html              # หน้าเว็บหลัก
  app.js                  # frontend/game UI/audio/client websocket
  style.css               # responsive UI
  assets/
    cards/                # ภาพการ์ด webp/png
    audio/
      casino-jazz-1.mp3   # เพลงพื้นหลัง
      effects/            # เสียง effect
        notification-chime.mp3
        pick-card.mp3
        sell-money.mp3
        camel.mp3
        trade.mp3
        winner.mp3
test/game-logic.test.js   # unit test logic สำคัญ
```

`server.js` serve static เฉพาะไฟล์ใน `public/` เพื่อไม่ expose ไฟล์ server/config โดยไม่จำเป็น

## วิธีรัน Local

```bash
npm install
npm start
```

เปิดเว็บที่:

```txt
http://localhost:3000
```

ทดสอบ logic:

```bash
npm test
```

## Deploy บน Render

แนะนำค่า:

```txt
Build Command: npm ci --no-audit --no-fund
Start Command: npm start
Environment: NODE_VERSION = 22.x
```

ถ้าไม่ใช้ `package-lock.json` ให้ใช้ `npm install --no-audit --no-fund` แทน แต่เวอร์ชันนี้มี `package-lock.json` ที่สร้างจาก registry ปกติแล้ว

## ระบบเสียง

เสียงทั้งหมดอยู่ใน `public/assets/audio/`

Effect ที่โค้ดเรียกจริง:

```txt
คลิก/เลือกการ์ด   -> effects/pick-card.mp3
หยิบสินค้า 1 ใบ  -> effects/pick-card.mp3
เก็บอูฐ           -> effects/camel.mp3
แลกเปลี่ยน        -> effects/trade.mp3
ขายสินค้า         -> effects/sell-money.mp3
แจ้งเตือน         -> effects/notification-chime.mp3
ชนะรอบ/ชนะเกม     -> effects/winner.mp3
```

ข้อสำคัญ: ชื่อไฟล์เป็นตัวพิมพ์เล็กทั้งหมด `.mp3` เพื่อให้ทำงานถูกต้องบน Linux/Render

## ระบบคะแนน

- ขายสินค้าแล้วได้คะแนนจาก token สินค้า visible ตามกองสินค้า
- เพชร ทอง เงิน เป็น premium goods ต้องขายอย่างน้อย 2 ใบ
- ขาย 3 ใบ ได้ bonus token จากกองขาย 3 ใบ 1 เหรียญ
- ขาย 4 ใบ ได้ bonus token จากกองขาย 4 ใบ 1 เหรียญ
- ขาย 5 ใบขึ้นไป ได้ bonus token จากกองขาย 5+ ใบ 1 เหรียญ
- คะแนน bonus token จะถูกซ่อนระหว่างเล่น และเปิดเผยเฉพาะ popup จบรอบ
- ผู้เล่นที่มีอูฐมากกว่าตอนจบรอบได้โบนัสอูฐ +5

## Tie-breaker จบรอบ

1. คะแนนรวมมากกว่า ชนะ
2. ถ้าคะแนนรวมเท่ากัน ดูจำนวน bonus token
3. ถ้ายังเท่ากัน ดูจำนวน goods token
4. ถ้ายังเท่ากัน ถือว่าเสมอ ไม่มีใครได้ตราชัย

## สิ่งที่เพิ่มใน v5.0.0

- แก้เสียง effect ให้ path ตรงไฟล์จริงและเป็น lowercase ทั้งหมด
- เพิ่มเสียงคลิก/เลือกการ์ด
- ปรับ setting เสียงให้จำค่าใน localStorage
- เพลงพื้นหลังเล่นเฉพาะหลังเข้าห้องเกม
- ปรับ modal setting ให้เล็กลงและ scroll ได้บนมือถือ/iPad
- แก้ trade ให้ validate ก่อน mutate state แบบ atomic
- sanitize ชื่อผู้เล่นและ escape log/name เพื่อลด XSS
- ปรับ reconnect ให้ slot ไม่ค้างง่ายเมื่อผู้เล่นหลุด
- แก้ tie-breaker ไม่ให้ P1 ได้เปรียบอัตโนมัติ
- เพิ่ม popup จบรอบและจบเกมพร้อมรายละเอียดคะแนนแบบซ่อน/ขยายได้
- ซ่อนคะแนน bonus token ระหว่างเล่น
- ทำ bonus token เป็นกองจริงของแต่ละรอบ
- ปรับ UX ตลาด: แตะเพื่อเลือกก่อน ไม่หยิบทันที
- เพิ่ม disabled state / hint สำหรับ action ที่ยังใช้ไม่ได้
- เพิ่ม validateGameState และ unit tests
- ย้าย static files ไป `public/`
- เพิ่ม WebP card assets เพื่อโหลดเร็วขึ้น
