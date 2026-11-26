// ===== ตั้งค่าระบบ =====
// 1) ยังไม่ใส่ค่า (null) = "โหมดทดลอง" เก็บข้อมูลในเครื่องนี้เท่านั้น
// 2) ใช้จริง: แทน null ด้วย firebaseConfig จาก Firebase Console (ดู README.md)
export const firebaseConfig = {
  apiKey: "AIzaSyD4dfF-XTZtwruv4iMXmPoDNn70qlCJimU",
  authDomain: "weddingtable-f7af4.firebaseapp.com",
  databaseURL: "https://weddingtable-f7af4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "weddingtable-f7af4",
  storageBucket: "weddingtable-f7af4.firebasestorage.app",
  messagingSenderId: "867430349381",
  appId: "1:867430349381:web:e0d3fd17a135b01926012c",
  measurementId: "G-SNMDJ2Y92L"
};
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
*/

export const EVENT_ID = "wedding";        // รหัสงาน (a-z 0-9 - _)
export const EVENT_NAME = "งานแต่งงาน";    // ชื่อที่แสดงบนหัวเว็บ
export const FIREBASE_VERSION = "12.0.0"; // เวอร์ชัน Firebase SDK ที่โหลดจาก gstatic
