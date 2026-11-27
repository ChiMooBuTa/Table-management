// ชั้นเก็บข้อมูล: Firebase Realtime Database หรือโหมดทดลอง (localStorage)
// ทุกการเขียนใช้รูปแบบ { "guests/<id>/checked": true } เพื่อไม่ให้หลายเครื่องเขียนทับกัน
import { firebaseConfig, EVENT_ID, FIREBASE_VERSION } from '../config.js';

export const isLocal = !firebaseConfig;

function localStore() {
  const KEY = 'wedding-checkin:' + EVENT_ID;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let data = read(), listener = () => {};
  const emit = () => listener(structuredClone(data));
  return {
    async init({ onAuth, onData, onStatus }) {
      listener = onData;
      addEventListener('storage', e => { if (e.key === KEY) { data = read(); emit(); } });
      onStatus('local'); onAuth({ role: 'admin', email: '' }); emit();
    },
    async update(patch) {
      data = read();
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.split('/'), last = parts.pop();
        let node = data;
        for (const p of parts) node = node[p] ??= {};
        if (value === null) delete node[last]; else node[last] = structuredClone(value);
      }
      try { localStorage.setItem(KEY, JSON.stringify(data)); }
      catch { throw new Error('บันทึกในเบราว์เซอร์ไม่สำเร็จ (พื้นที่เต็มหรือถูกปิดกั้น)'); }
      finally { emit(); }
    },
    async claimGift(id, time) {
      data = read();
      const guest = data.guests?.[id];
      if (!guest || guest.giftAt) { emit(); throw new Error(guest ? 'permission: already claimed' : 'ไม่พบแขก'); }
      await this.update({ [`guests/${id}/giftAt`]: time });
    },
    async login() {}, async logout() {}
  };
}

function firebaseStore() {
  let auth, db, A, D;
  return {
    async init({ onAuth, onData, onStatus, onError }) {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
      const [App, Auth, Db] = await Promise.all(['app', 'auth', 'database'].map(n => import(`${base}firebase-${n}.js`)));
      A = Auth; D = Db;
      const app = App.initializeApp(firebaseConfig);
      auth = A.getAuth(app); db = D.getDatabase(app);
      let stops = [], session = 0;
      D.onValue(D.ref(db, '.info/connected'), s => onStatus(s.val() ? 'online' : 'offline'));
      A.onAuthStateChanged(auth, user => {
        const mine = ++session;
        stops.forEach(f => f()); stops = [];
        onData({});
        if (!user) return onAuth(null);
        stops.push(D.onValue(D.ref(db, `roles/${user.uid}`), snap => {
          if (mine !== session) return;
          const role = snap.val();
          stops.splice(1).forEach(f => f());
          onAuth({ role, email: user.email, uid: user.uid });
          if (!role) return;
          stops.push(D.onValue(D.ref(db, `events/${EVENT_ID}`), s => onData(s.val() || {}), onError));
        }, onError));
      });
    },
    update(patch) { return D.update(D.ref(db, `events/${EVENT_ID}`), patch); },
    // Rules ของฐานข้อมูลจะปฏิเสธถ้าแขกคนนี้มีเวลารับของอยู่แล้ว
    claimGift(id, time) { return this.update({ [`guests/${id}/giftAt`]: time }); },
    login(email, password) { return A.signInWithEmailAndPassword(auth, email, password); },
    logout() { return A.signOut(auth); }
  };
}

export const store = isLocal ? localStore() : firebaseStore();
