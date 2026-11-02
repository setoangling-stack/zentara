# Zentara - Semesta Belajar 3D 🚀

Platform Game Edukasi Multiplayer 3D dan Panel Manajemen Guru berbasis Node.js mandiri (`node:sqlite` + `ws`).

---

## 📁 Struktur Berkas Proyek

```text
├── public/
│   ├── index.html              # Antarmuka game 3D Three.js & registrasi guru
│   ├── admin.html              # Dashboard panel admin Zentara
│   ├── manifest.webmanifest    # Konfigurasi PWA Zentara
│   ├── icon-*.png              # Ikon aplikasi PWA
│   └── js/                     # Modul pendukung frontend
├── server.js                   # Backend mandiri (REST API, WebSocket, SQLite)
├── test_game.js                # Suite pengujian integrasi otomatis
├── vercel.json                 # Konfigurasi deployment frontend di Vercel
├── package.json                # Dependensi proyek (ws)
└── .gitignore                  # Berkas yang dikecualikan dari Git
```

---

## ⚡ Cara Menjalankan Secara Lokal

1. **Pasang Dependensi**:
   ```bash
   npm install
   ```

2. **Jalankan Server**:
   ```bash
   npm start
   ```
   Aplikasi akan berjalan di:
   - **Game**: `http://localhost:3000`
   - **Panel Admin**: `http://localhost:3000/admin.html`

3. **Jalankan Pengujian Otomatis**:
   ```bash
   npm test
   ```

---

## 🌐 Catatan Deployment (Vercel vs Full-Stack Server)

Game **Zentara** menggunakan:
1. **Multiplayer 3D Real-Time via WebSocket (`ws://` / `wss://`)**.
2. **Database SQLite Persisten (`node:sqlite`)**.

> ⚠️ **Catatan Penting Vercel**:
> Vercel adalah platform *Serverless* (stateless). Serverless function di Vercel **tidak mendukung koneksi WebSocket persisten** dan sistem berkasnya bersifat *read-only/ephemeral* (database SQLite akan terhapus saat instance berhenti).

### Opsi Deployment yang Tersedia:

### Opsi A: Full-Stack Langsung di Render.com / Railway (Sangat Disarankan 🌟)
Platform ini mendukung Node.js jangka panjang (long-running process), WebSocket aktif, dan penyimpanan disk:
1. Hubungkan repository GitHub ini ke **Render.com** (pilih *New Web Service*).
2. Environment: `Node`.
3. Build Command: `npm install`.
4. Start Command: `npm start`.
5. Semua fitur Game 3D, WebSocket Multiplayer, dan Panel Admin langsung aktif 100% tanpa konfigurasi tambahan!

### Opsi B: Frontend di Vercel + Backend di Render/Railway/VPS
1. Deploy repository ini ke **Vercel** (Vercel akan otomatis menyajikan folder `public` sesuai `vercel.json`).
2. Deploy backend `server.js` ke Render/VPS.
3. Sambungkan game ke server realtime melalui query parameter:
   `https://domain-vercel-anda.vercel.app/?rt=wss://backend-anda.com/ws`

---

## 🔐 Kredensial Default Panel Admin

- **URL**: `/admin.html`
- **Username**: `admin`
- **Password Default**: `admin123`
*(Sangat disarankan untuk mengubah kata sandi setelah login pertama kali di menu Setelan).*
