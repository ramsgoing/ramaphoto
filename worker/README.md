# Setup Worker (galeri berbayar)

## 1. Service account Google (pengganti API key publik)
1. console.cloud.google.com → project kamu → APIs & Services → Library → aktifkan **Google Drive API**
2. IAM & Admin → Service Accounts → **Create** → beri nama `rams-gallery`
3. Buka service account tsb → tab **Keys** → Add key → **JSON** → file terunduh
4. Dari file JSON catat `client_email` dan `private_key`
5. Di Google Drive: **share setiap folder album ke `client_email` sebagai Viewer**.
   Folder TIDAK perlu lagi "Anyone with the link" — biarkan privat.

## 2. Midtrans
1. Daftar di dashboard.midtrans.com, mulai dari mode **Sandbox**
2. Settings → Access Keys → catat **Server Key** & **Client Key**
3. Settings → Configuration → **Payment Notification URL** = `https://<worker-kamu>/midtrans-webhook`
4. Cek metode bayar yang aktif (QRIS, VA, e-wallet) di Settings → Snap Preferences

## 3. Deploy Worker (gratis, tanpa kartu kredit)
```
npm i -g wrangler
cd worker
wrangler login
wrangler kv namespace create ORDERS        # salin id -> wrangler.toml
# edit wrangler.toml: FIREBASE_PROJECT_ID, ALLOWED_ORIGIN, id KV
wrangler secret put SA_EMAIL                     # client_email
wrangler secret put SA_KEY                       # private_key (seluruh isi, termasuk -----BEGIN...)
wrangler secret put MIDTRANS_SERVER_KEY_SANDBOX  # key Sandbox
wrangler secret put MIDTRANS_CLIENT_KEY_SANDBOX
# nanti, saat akun Midtrans sudah aktif:
wrangler secret put MIDTRANS_SERVER_KEY_PROD
wrangler secret put MIDTRANS_CLIENT_KEY_PROD
wrangler deploy
```
Salin URL hasil deploy (`https://rams-gallery.xxx.workers.dev`).

## 4. Sambungkan ke web
Di `index.html` ganti `GANTI_WORKER_URL` dengan URL Worker. Upload ulang web.

## 5. Go live
Simpan key Production (dua perintah `_PROD` di atas), lalu di **admin → Pembayaran → Mode** pilih *Production*. Tidak perlu deploy ulang.

## Pengaturan dari admin
Harga, jumlah foto gratis, batas IP, nyala/mati pembayaran, mode Sandbox/Production, dan harga khusus/gratis per album
diatur di **admin → Pembayaran** dan **Album → Edit**. Disimpan di Firestore (`settings/payment` dan dokumen album),
dibaca Worker tiap ±30 detik. Nilai di `wrangler.toml` hanya cadangan kalau Firestore tidak terbaca.
Kunci rahasia (Server Key, private key Google) sengaja TIDAK bisa diatur dari admin.

**WAJIB sebelum dipakai:** ketatkan Firestore Rules (bagian "Catatan Keamanan" di `CARA-SETUP.md`):
baca publik, tulis hanya untuk admin yang login. Kalau masih "test mode", siapa pun bisa mengubah harga jadi Rp 0.

## Aturan harga (default, bisa diubah dari admin)
- Per pengunjung per album: "foto gratis per pengunjung" foto pertama gratis, sisanya harga per foto per foto.
- Mau "pilih lebih dari 5 = semua dibayar"? Isi foto gratis = 0 di admin dan sesuaikan teks.
- Gratis dilacak dua lapis: ID browser ("foto gratis per pengunjung") dan alamat IP (batas IP, default 3x lipat).
  Hapus data/incognito di jaringan yang sama tetap kena batas IP. Ganti jaringan (WiFi -> data seluler/VPN) masih bisa dapat jatah baru.
  Jangan set batas IP terlalu kecil: banyak orang di satu WiFi event atau satu operator seluler bisa berbagi IP yang sama.
- Satu-satunya cara tanpa celah: isi "foto gratis" = 0 di admin (semua foto berbayar).
