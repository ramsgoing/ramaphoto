# 🔧 Cara Setup Firebase — Ramdhani Photo

## Langkah 1: Buat Project Firebase
1. Buka https://console.firebase.google.com
2. Klik "Add project" → beri nama (misal: `ramdhani-photo`)
3. Disable Google Analytics (opsional) → Create project

---

## Langkah 2: Setup Cloudinary (untuk upload thumbnail - GRATIS)
1. Daftar di https://cloudinary.com (gratis, tanpa kartu kredit)
2. Setelah login, catat **Cloud Name** kamu di dashboard
3. Di Cloudinary → Settings → **Upload** → scroll ke **Upload presets**
4. Klik **Add upload preset**:
   - Preset name: `rams_gallery`
   - Signing Mode: **Unsigned**
   - Klik Save
5. Buka `admin/index.html`, cari baris:
   ```
   const CLOUDINARY_CLOUD_NAME = 'GANTI_CLOUD_NAME';
   ```
   Ganti `GANTI_CLOUD_NAME` dengan Cloud Name kamu.

---

## Langkah 3: Aktifkan Layanan Firebase

### A. Firestore Database
1. Sidebar → Build → **Firestore Database**
2. Klik "Create database" → pilih **"Start in test mode"** → pilih region → Done

### B. Firebase Storage
1. Sidebar → Build → **Storage**
2. Klik "Get started" → **"Start in test mode"** → Done

### C. Authentication (untuk login admin)
1. Sidebar → Build → **Authentication**
2. Klik "Get started"
3. Tab "Sign-in method" → aktifkan **Email/Password**
4. Tab "Users" → klik "Add user" → masukkan email & password admin kamu

---

## Langkah 3: Ambil Firebase Config
1. Project Overview → klik ikon `</>` (Web app)
2. Daftarkan app (nama bebas)
3. Copy bagian `firebaseConfig` yang muncul

---

## Langkah 4: Paste Config ke Kedua File HTML
Buka `index.html` DAN `admin.html`, cari bagian ini (ada di kedua file):

```js
const firebaseConfig = {
  apiKey: "GANTI_API_KEY",
  authDomain: "GANTI_PROJECT_ID.firebaseapp.com",
  ...
};
```

Ganti dengan config Firebase kamu. **Config-nya sama persis** untuk kedua file.

---

## Langkah 5: Upload & Selesai!
- Upload folder ini ke Netlify, Vercel, atau hosting manapun
- Buka `admin.html` → login pakai email & password yang kamu buat di Authentication
- Buka `index.html` → album yang kamu tambah dari admin langsung muncul realtime ✅

---

## Catatan Keamanan
Setelah semuanya jalan, ganti **Firestore Rules** di Firebase Console:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Public bisa baca albums & settings
    match /albums/{doc} { allow read: if true; allow write: if request.auth != null; }
    match /settings/{doc} { allow read: if true; allow write: if request.auth != null; }
  }
}
```

Dan **Storage Rules**:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```
