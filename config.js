// ===== ตั้งค่าระบบ =====
// 1) ยังไม่ใส่ค่า (null) = "โหมดทดลอง" เก็บข้อมูลในเครื่องนี้เท่านั้น
// 2) ใช้จริง: แทน null ด้วย firebaseConfig จาก Firebase Console (ดู README.md)
export const firebaseConfig = null;
/* ตัวอย่าง
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "your-project",
  appId: "1:000000000000:web:xxxxxxxx"
};
*/

export const EVENT_ID = "wedding";        // รหัสงาน (a-z 0-9 - _)
export const EVENT_NAME = "งานแต่งงาน";    // ชื่อที่แสดงบนหัวเว็บ
export const FIREBASE_VERSION = "12.0.0"; // เวอร์ชัน Firebase SDK ที่โหลดจาก gstatic
