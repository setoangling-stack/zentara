// server.js - Backend Zentara & Admin Panel
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.sqlite');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- DATABASE SETUP ---
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS akses_gmail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE COLLATE NOCASE,
    nama TEXT DEFAULT '',
    status TEXT DEFAULT 'aktif',
    sampai INTEGER DEFAULT 0,
    maks_kelas INTEGER DEFAULT 10,
    catatan TEXT DEFAULT '',
    no_pesanan TEXT DEFAULT '',
    pemberi TEXT DEFAULT '',
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS guru (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE COLLATE NOCASE,
    sandi_hash TEXT,
    nama TEXT,
    wa TEXT DEFAULT '',
    sekolah TEXT DEFAULT '',
    status TEXT DEFAULT 'menunggu',
    sampai INTEGER DEFAULT 0,
    tenggang_sampai INTEGER DEFAULT 0,
    maks_kelas INTEGER DEFAULT 10,
    no_pesanan TEXT DEFAULT '',
    pemberi TEXT DEFAULT '',
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sesi (
    token TEXT PRIMARY KEY,
    guru_id INTEGER,
    dev TEXT DEFAULT '',
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS kelas (
    kode TEXT PRIMARY KEY,
    guru_id INTEGER,
    nama TEXT,
    guru_nama TEXT,
    pin TEXT DEFAULT '',
    paket TEXT,
    paket_kode TEXT DEFAULT '',
    terkunci INTEGER DEFAULT 0,
    diubah INTEGER,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS murid (
    token TEXT PRIMARY KEY,
    kelas_kode TEXT,
    nama TEXT,
    absen TEXT DEFAULT '',
    blokir INTEGER DEFAULT 0,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS riwayat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_kode TEXT,
    murid_token TEXT,
    data TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS paket (
    kode TEXT PRIMARY KEY,
    guru_id INTEGER,
    judul TEXT,
    paket TEXT,
    publik INTEGER DEFAULT 0,
    jenjang TEXT DEFAULT '',
    mapel TEXT DEFAULT '',
    diubah INTEGER,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS soal_draft (
    guru_id INTEGER PRIMARY KEY,
    paket TEXT,
    pk TEXT DEFAULT '',
    diubah INTEGER
  );

  CREATE TABLE IF NOT EXISTS tantangan (
    id TEXT PRIMARY KEY,
    kelas_kode TEXT,
    guru_id INTEGER,
    data TEXT,
    status TEXT DEFAULT 'draft',
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS pendamping (
    kode TEXT PRIMARY KEY,
    kelas_kode TEXT,
    guru_id INTEGER,
    nama TEXT,
    token TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS setelan (
    k TEXT PRIMARY KEY,
    v TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    sandi_hash TEXT
  );
`);

// Pastikan kolom migrasi no_pesanan dan pemberi ada
try { db.exec("ALTER TABLE akses_gmail ADD COLUMN no_pesanan TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE akses_gmail ADD COLUMN pemberi TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE guru ADD COLUMN no_pesanan TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE guru ADD COLUMN pemberi TEXT DEFAULT ''"); } catch {}

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + '_zv_secret').digest('hex');
}

const hasAdmin = db.prepare('SELECT id FROM admin_user WHERE username = ?').get('admin');
if (!hasAdmin) {
  db.prepare('INSERT INTO admin_user (username, sandi_hash) VALUES (?, ?)').run('admin', hashPassword('admin123'));
}

const getSetting = (k, def = '') => {
  const row = db.prepare('SELECT v FROM setelan WHERE k = ?').get(k);
  return row ? row.v : def;
};
const setSetting = (k, v) => {
  db.prepare('INSERT INTO setelan (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));
};

if (!getSetting('wa')) setSetting('wa', '6287810215522');
if (!getSetting('app_title')) setSetting('app_title', 'Zentara - Semesta Belajar 3D');

function genCode(len = 6) {
  let res = '';
  for (let i = 0; i < len; i++) res += Math.floor(Math.random() * 10);
  return res;
}
function genToken(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}
function parseJSON(str, def = null) {
  try { return JSON.parse(str); } catch { return def; }
}

function toStr(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function getGuruByLic(lic) {
  if (!lic) return null;
  const token = typeof lic === 'string' ? lic : (lic.sess || lic.token || lic.kode || '');
  if (!token) return null;
  const s = db.prepare('SELECT guru_id FROM sesi WHERE token = ?').get(token);
  if (s) return db.prepare('SELECT * FROM guru WHERE id = ?').get(s.guru_id);
  return db.prepare('SELECT * FROM guru WHERE email = ? COLLATE NOCASE').get(token);
}

function formatGuruResponse(guru) {
  if (!guru) return null;

  // 1. Sinkronisasi dengan akses_gmail jika ada perubahan oleh admin
  const akses = db.prepare('SELECT * FROM akses_gmail WHERE email = ? COLLATE NOCASE').get(guru.email);
  if (akses) {
    const needSync = guru.status !== akses.status ||
      guru.sampai !== akses.sampai ||
      guru.maks_kelas !== akses.maks_kelas ||
      (akses.no_pesanan && guru.no_pesanan !== akses.no_pesanan) ||
      (akses.pemberi && guru.pemberi !== akses.pemberi);

    if (needSync) {
      db.prepare(`
        UPDATE guru 
        SET status = ?, sampai = ?, maks_kelas = ?,
            no_pesanan = CASE WHEN ? != '' THEN ? ELSE no_pesanan END,
            pemberi = CASE WHEN ? != '' THEN ? ELSE pemberi END
        WHERE id = ?
      `).run(
        akses.status,
        akses.sampai,
        akses.maks_kelas,
        akses.no_pesanan || '',
        akses.no_pesanan || '',
        akses.pemberi || '',
        akses.pemberi || '',
        guru.id
      );
      guru = db.prepare('SELECT * FROM guru WHERE id = ?').get(guru.id);
    }
  }

  // 2. Kalkulasi status dinamis langganan
  let effectiveStatus = guru.status;
  const now = Date.now();
  if (guru.status !== 'blokir' && guru.status !== 'menunggu') {
    if (guru.sampai === 0 || guru.status === 'seumur') {
      effectiveStatus = 'seumur';
    } else if (guru.sampai > 0) {
      const tenggang = guru.tenggang_sampai || (guru.sampai + 7 * 24 * 3600 * 1000);
      if (now > tenggang) {
        effectiveStatus = 'habis';
      } else if (now > guru.sampai) {
        effectiveStatus = 'tenggang';
      } else if (guru.sampai - now <= 7 * 24 * 3600 * 1000) {
        effectiveStatus = 'segera';
      } else {
        effectiveStatus = 'aktif';
      }
    }
  }

  const kRow = db.prepare('SELECT count(*) as c FROM kelas WHERE guru_id = ?').get(guru.id);
  const sRow = db.prepare('SELECT count(*) as c FROM sesi WHERE guru_id = ?').get(guru.id);

  return {
    id: guru.id,
    nama: guru.nama || '',
    email: guru.email || '',
    wa: guru.wa || '',
    sekolah: guru.sekolah || '',
    no_pesanan: guru.no_pesanan || '',
    pemberi: guru.pemberi || '',
    status: effectiveStatus,
    sampai: Number(guru.sampai) || 0,
    tenggang_sampai: Number(guru.tenggang_sampai) || (guru.sampai > 0 ? guru.sampai + 7 * 24 * 3600 * 1000 : 0),
    kelas: kRow ? kRow.c : 0,
    maks_kelas: Number(guru.maks_kelas) || 10,
    perangkat: sRow ? Math.max(1, sRow.c) : 1,
    maks_perangkat: 5
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  const readBody = (cb) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 50 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      cb(data);
    });
  };

  const json = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const err = (msg, code = 400, extra = {}) => {
    json({ error: msg, ...extra }, code);
  };

  // --- API ROUTES ---
  if (pathname.startsWith('/api/')) {
    const route = pathname.slice(4);

    if (route === '/setelan' && req.method === 'GET') {
      return json({
        wa: getSetting('wa', '6287810215522'),
        beli: getSetting('beli', 'https://wa.me/6287810215522?text=' + encodeURIComponent('Halo admin Zentara, saya ingin berlangganan Mode Guru.')),
        app_title: getSetting('app_title', 'Zentara')
      });
    }

    if (route === '/akun/masuk' && req.method === 'POST') {
      return readBody(body => {
        const email = (body.email || '').trim().toLowerCase();
        const pwd = body.sandi || '';
        if (!email || !pwd) return err('Isi email dan kata sandi.');

        let g = db.prepare('SELECT * FROM guru WHERE email = ? COLLATE NOCASE').get(email);
        if (!g) return err('Email atau kata sandi salah.', 401);

        if (g.sandi_hash !== hashPassword(pwd)) {
          return err('Email atau kata sandi salah.', 401);
        }

        const token = genToken();
        db.prepare('INSERT INTO sesi (token, guru_id, dev, created_at) VALUES (?, ?, ?, ?)').run(token, g.id, body.dev || '', Date.now());

        return json({
          sess: token,
          guru: formatGuruResponse(g)
        });
      });
    }

    if (route === '/akun/daftar' && req.method === 'POST') {
      return readBody(body => {
        const email = (body.email || (body.cred && body.cred.email) || '').trim().toLowerCase();
        const pwd = body.sandi || ('pwd_' + genToken(6));
        const nama = (body.nama || (body.cred && body.cred.name) || email.split('@')[0]).trim();
        const wa = (body.wa || '').trim();
        const sekolah = (body.sekolah || '').trim();
        const buktiInput = (body.no_pesanan || body.bukti || '').trim();

        if (!email) return err('Email harus diisi.');

        let g = db.prepare('SELECT * FROM guru WHERE email = ? COLLATE NOCASE').get(email);
        if (g) return err('Email ini sudah terdaftar. Silakan login.');

        // Cari di akses_gmail: coba berdasarkan email DULU, atau berdasarkan nomor pesanan / bukti
        let akses = db.prepare('SELECT * FROM akses_gmail WHERE email = ? COLLATE NOCASE').get(email);
        if (!akses && buktiInput) {
          akses = db.prepare(`
            SELECT * FROM akses_gmail 
            WHERE (no_pesanan != '' AND no_pesanan = ? COLLATE NOCASE)
               OR (email != '' AND email = ? COLLATE NOCASE)
               OR (catatan != '' AND catatan = ? COLLATE NOCASE)
          `).get(buktiInput, buktiInput, buktiInput);

          // Jika cocok via nomor pesanan/bukti, perbarui email & nama di akses_gmail
          if (akses) {
            try {
              db.prepare("UPDATE akses_gmail SET email = ?, nama = CASE WHEN nama = '' THEN ? ELSE nama END WHERE id = ?")
                .run(email, nama, akses.id);
            } catch (e) {
              // Jika email bentrok di akses_gmail, hapus record lama dan re-link
              db.prepare('DELETE FROM akses_gmail WHERE email = ? COLLATE NOCASE AND id != ?').run(email, akses.id);
              db.prepare("UPDATE akses_gmail SET email = ?, nama = CASE WHEN nama = '' THEN ? ELSE nama END WHERE id = ?")
                .run(email, nama, akses.id);
            }
          }
        }

        let status = 'menunggu';
        let sampai = 0;
        let maks_kelas = 10;
        let no_pesanan = buktiInput;
        let pemberi = 'Admin Zentara';

        if (akses) {
          status = akses.status || 'aktif';
          sampai = akses.sampai || 0;
          maks_kelas = akses.maks_kelas || 10;
          no_pesanan = akses.no_pesanan || buktiInput;
          pemberi = akses.pemberi || 'Admin Zentara';
        } else {
          // Buat entri di akses_gmail agar admin langsung memantau bukti / no pesanan di dashboard
          try {
            db.prepare(`
              INSERT INTO akses_gmail (email, nama, status, sampai, maks_kelas, catatan, no_pesanan, pemberi, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(email) DO UPDATE SET
                no_pesanan = CASE WHEN excluded.no_pesanan != '' THEN excluded.no_pesanan ELSE akses_gmail.no_pesanan END
            `).run(email, nama, status, sampai, maks_kelas, 'Pendaftaran mandiri: ' + buktiInput, no_pesanan, pemberi, Date.now());
          } catch {}
        }

        const resDb = db.prepare(`
          INSERT INTO guru (email, sandi_hash, nama, wa, sekolah, status, sampai, tenggang_sampai, maks_kelas, no_pesanan, pemberi, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(email, hashPassword(pwd), nama, wa, sekolah, status, sampai, 0, maks_kelas, no_pesanan, pemberi, Date.now());

        const guruId = Number(resDb.lastInsertRowid);
        g = db.prepare('SELECT * FROM guru WHERE id = ?').get(guruId);

        const token = genToken();
        db.prepare('INSERT INTO sesi (token, guru_id, dev, created_at) VALUES (?, ?, ?, ?)').run(token, guruId, body.dev || '', Date.now());

        return json({
          sess: token,
          guru: formatGuruResponse(g)
        });
      });
    }

    if (route === '/akun/google' && req.method === 'POST') {
      return readBody(body => {
        let email = '';
        let name = '';
        if (typeof body.cred === 'string' && body.cred.includes('.')) {
          try {
            const payload = JSON.parse(Buffer.from(body.cred.split('.')[1], 'base64').toString());
            email = (payload.email || '').toLowerCase();
            name = payload.name || '';
          } catch {}
        } else if (body.cred && typeof body.cred === 'object') {
          email = (body.cred.email || '').toLowerCase();
          name = body.cred.name || '';
        }

        if (!email) return err('Kredensial Google tidak valid.');

        let g = db.prepare('SELECT * FROM guru WHERE email = ? COLLATE NOCASE').get(email);
        if (!g) {
          const akses = db.prepare('SELECT * FROM akses_gmail WHERE email = ? COLLATE NOCASE').get(email);
          if (akses) {
            const resDb = db.prepare(`
              INSERT INTO guru (email, sandi_hash, nama, wa, sekolah, status, sampai, tenggang_sampai, maks_kelas, no_pesanan, pemberi, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(email, hashPassword('google_' + genToken(8)), name || akses.nama || email.split('@')[0], '', '', akses.status, akses.sampai, 0, akses.maks_kelas, akses.no_pesanan || '', akses.pemberi || '', Date.now());
            g = db.prepare('SELECT * FROM guru WHERE id = ?').get(Number(resDb.lastInsertRowid));
          } else {
            return json({ perlu: true, email: email, nama: name });
          }
        }

        const token = genToken();
        db.prepare('INSERT INTO sesi (token, guru_id, dev, created_at) VALUES (?, ?, ?, ?)').run(token, g.id, body.dev || '', Date.now());

        return json({
          sess: token,
          guru: formatGuruResponse(g)
        });
      });
    }

    if (route === '/akun/saya' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Sesi berakhir atau tidak valid.', 401);

        const guruData = formatGuruResponse(g);

        return json({
          guru: guruData,
          bayar: [],
          setelan: {
            wa: getSetting('wa', '6287810215522'),
            beli: getSetting('beli', 'https://wa.me/6287810215522?text=' + encodeURIComponent('Halo admin Zentara, saya ingin berlangganan Mode Guru.')),
            harga: 'Rp49.000 / tahun',
            info: 'Akses penuh seluruh fitur Mode Guru, pembuatan soal tanpa batas, dan kelas live multiplayer.'
          }
        });
      });
    }

    if (route === '/akun/keluar' && req.method === 'POST') {
      return readBody(body => {
        if (body.lic && body.lic.sess) {
          db.prepare('DELETE FROM sesi WHERE token = ?').run(body.lic.sess);
        }
        return json({ ok: true });
      });
    }

    if (route === '/akun/ubah' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        db.prepare('UPDATE guru SET nama = ?, wa = ?, sekolah = ? WHERE id = ?')
          .run(body.nama || g.nama, body.wa || g.wa, body.sekolah || g.sekolah, g.id);
        const updated = db.prepare('SELECT * FROM guru WHERE id = ?').get(g.id);
        return json({ ok: true, guru: formatGuruResponse(updated) });
      });
    }

    if (route === '/akun/sandi' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        const sandiLama = body.lama || body.sandi_lama || '';
        const sandiBaru = body.baru || body.sandi_baru || '';
        if (g.sandi_hash && g.sandi_hash !== hashPassword(sandiLama)) return err('Kata sandi lama salah.');
        if (!sandiBaru || sandiBaru.length < 4) return err('Kata sandi baru minimal 4 karakter.');
        db.prepare('UPDATE guru SET sandi_hash = ? WHERE id = ?').run(hashPassword(sandiBaru), g.id);
        return json({ ok: true, msg: 'Kata sandi berhasil diubah.' });
      });
    }

    if (route === '/guru/kelas' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        const guruData = formatGuruResponse(g);
        const kelasList = db.prepare('SELECT kode, nama, pin FROM kelas WHERE guru_id = ? ORDER BY created_at DESC').all(g.id);
        return json({
          maks_kelas: guruData.maks_kelas,
          kelas: kelasList
        });
      });
    }

    if (route === '/kelas/buat' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        const guruData = formatGuruResponse(g);
        if (guruData.status === 'menunggu') return err('Akun belum diaktifkan oleh admin.', 403, { kode: 'lisensi' });
        if (guruData.status === 'blokir') return err('Akun Anda diblokir oleh admin.', 403, { kode: 'blokir' });
        if (guruData.status === 'habis') return err('Masa langganan telah berakhir. Silakan perpanjang langganan.', 403, { kode: 'habis' });

        const count = db.prepare('SELECT count(*) as c FROM kelas WHERE guru_id = ?').get(g.id).c;
        if (count >= (guruData.maks_kelas || 10)) return err('Batas jumlah kelas sudah tercapai (' + guruData.maks_kelas + ').');

        let kode = genCode(6);
        while (db.prepare('SELECT kode FROM kelas WHERE kode = ?').get(kode)) {
          kode = genCode(6);
        }

        const paketJSON = typeof body.paket === 'string' ? body.paket : JSON.stringify(body.paket || {});
        db.prepare(`
          INSERT INTO kelas (kode, guru_id, nama, guru_nama, pin, paket, paket_kode, diubah, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(kode, g.id, body.nama || 'Kelas Baru', body.guru || g.nama, body.pin || '', paketJSON, body.paket_kode || '', Date.now(), Date.now());

        return json({ kode: kode });
      });
    }

    const kelasMatch = route.match(/^\/?kelas\/([A-Za-z0-9]+)$/);
    if (kelasMatch && req.method === 'GET') {
      const kd = kelasMatch[1].toUpperCase();
      const k = db.prepare('SELECT * FROM kelas WHERE kode = ?').get(kd);
      if (!k) return err('Kelas tidak ditemukan.', 404);
      
      const reqV = parsedUrl.searchParams.get('v');
      if (reqV && String(reqV) === String(k.diubah)) {
        return json({
          sama: true,
          kode: k.kode,
          nama: k.nama,
          guru: k.guru_nama,
          diubah: k.diubah
        });
      }

      return json({
        sama: false,
        kode: k.kode,
        nama: k.nama,
        guru: k.guru_nama,
        paket: parseJSON(k.paket, {}),
        paket_kode: k.paket_kode,
        diubah: k.diubah,
        terkunci: Boolean(k.terkunci)
      });
    }

    if (route === '/kelas/ubah' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        db.prepare('UPDATE kelas SET nama = ?, pin = ?, diubah = ? WHERE kode = ? AND guru_id = ?')
          .run(body.nama, body.pin || '', Date.now(), body.kode, g.id);
        return json({ ok: true });
      });
    }

    if (route === '/kelas/kunci' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        db.prepare('UPDATE kelas SET terkunci = ? WHERE kode = ? AND guru_id = ?')
          .run(body.kunci ? 1 : 0, body.kode, g.id);
        return json({ ok: true });
      });
    }

    if (route === '/kelas/paket' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        const pkJSON = typeof body.paket === 'string' ? body.paket : JSON.stringify(body.paket || {});
        db.prepare('UPDATE kelas SET paket = ?, paket_kode = ?, diubah = ? WHERE kode = ? AND guru_id = ?')
          .run(pkJSON, body.paket_kode || '', Date.now(), body.kode, g.id);
        return json({ ok: true });
      });
    }

    if (route === '/kelas/paket/ambil' && req.method === 'POST') {
      return readBody(body => {
        const k = db.prepare('SELECT * FROM kelas WHERE kode = ?').get(body.kode);
        if (!k) return err('Kelas tidak ditemukan.', 404);
        return json({
          paket: parseJSON(k.paket, {}),
          paket_kode: k.paket_kode
        });
      });
    }

    if (route === '/dashboard' && req.method === 'POST') {
      return readBody(body => {
        const kd = body.kode;
        const k = db.prepare('SELECT * FROM kelas WHERE kode = ?').get(kd);
        if (!k) return err('Kelas tidak ditemukan.', 404);

        const murids = db.prepare('SELECT token, nama, absen, blokir FROM murid WHERE kelas_kode = ? ORDER BY absen ASC, nama ASC').all(kd);
        const riwayats = db.prepare('SELECT murid_token, data, created_at FROM riwayat WHERE kelas_kode = ? ORDER BY created_at DESC').all(kd);

        const nilaiByToken = {};
        for (const rw of riwayats) {
          if (!nilaiByToken[rw.murid_token]) nilaiByToken[rw.murid_token] = [];
          const parsed = parseJSON(rw.data, {});
          if (parsed.sesi) {
            nilaiByToken[rw.murid_token].push({
              m: parsed.sesi.nama || parsed.sesi.mapel || 'Kuis',
              n: parsed.sesi.nilai != null ? parsed.sesi.nilai : parsed.sesi.benar,
              b: parsed.sesi.benar || 0,
              tot: parsed.sesi.total || 0,
              t: parsed.sesi.t || rw.created_at,
              k: parsed.sesi.tantangan ? 'tantangan' : 'kuis'
            });
          }
        }

        const muridList = murids.map(m => ({
          token: m.token,
          nama: m.nama,
          absen: m.absen,
          blokir: Boolean(m.blokir),
          nilai: nilaiByToken[m.token] || []
        }));

        const tantangans = db.prepare('SELECT * FROM tantangan WHERE kelas_kode = ? ORDER BY created_at DESC').all(kd);
        const tantanganList = tantangans.map(t => ({
          id: t.id,
          ...parseJSON(t.data, {}),
          status: t.status
        }));

        return json({
          kelas: {
            kode: k.kode,
            nama: k.nama,
            guru: k.guru_nama,
            pin: k.pin,
            terkunci: Boolean(k.terkunci)
          },
          murid: muridList,
          tantangan: tantanganList,
          paket: parseJSON(k.paket, {}),
          paket_kode: k.paket_kode
        });
      });
    }

    if (route === '/murid/masuk' && req.method === 'POST') {
      return readBody(body => {
        const kd = toStr(body.kode).toUpperCase();
        const nama = toStr(body.nama);
        const absen = toStr(body.absen);

        if (!kd) return err('Kode kelas harus diisi.');
        if (!nama) return err('Nama harus diisi.');

        const k = db.prepare('SELECT * FROM kelas WHERE kode = ?').get(kd);
        if (!k) return err('Kode kelas tidak ditemukan. Pastikan 6 digit kode benar.');
        if (k.terkunci) return err('Kelas ini sedang dikunci oleh guru.');

        let token = body.token;
        let existingMurid = token ? db.prepare('SELECT * FROM murid WHERE token = ? AND kelas_kode = ?').get(token, kd) : null;

        if (existingMurid && existingMurid.blokir) {
          return err('Kamu diblokir dari kelas ini oleh guru.', 403, { kode: 'blokir' });
        }

        if (!existingMurid) {
          token = genToken(16);
          db.prepare('INSERT INTO murid (token, kelas_kode, nama, absen, blokir, created_at) VALUES (?, ?, ?, ?, 0, ?)')
            .run(token, kd, nama, absen, Date.now());
        } else {
          db.prepare('UPDATE murid SET nama = ?, absen = ? WHERE token = ?').run(nama, absen, token);
        }

        return json({
          token: token,
          nama: nama,
          absen: absen,
          kelas: {
            kode: k.kode,
            nama: k.nama,
            guru: k.guru_nama
          },
          paket_kode: k.paket_kode,
          diubah: k.diubah,
          paket: parseJSON(k.paket, {})
        });
      });
    }

    if (route === '/catat' && req.method === 'POST') {
      return readBody(body => {
        const token = toStr(body.token);
        const kd = toStr(body.kode).toUpperCase();
        if (!token || !kd) return err('Token dan kode kelas diperlukan.');

        const m = db.prepare('SELECT * FROM murid WHERE token = ? AND kelas_kode = ?').get(token, kd);
        if (!m) return err('Murid tidak terdaftar di kelas ini.', 401);
        if (m.blokir) return err('Murid diblokir.', 403, { kode: 'blokir' });

        db.prepare('INSERT INTO riwayat (kelas_kode, murid_token, data, created_at) VALUES (?, ?, ?, ?)')
          .run(kd, token, JSON.stringify(body), Date.now());

        return json({ ok: true });
      });
    }

    if (route === '/murid/hapus' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        db.prepare('DELETE FROM murid WHERE token = ? AND kelas_kode = ?').run(body.token, body.kode);
        db.prepare('DELETE FROM riwayat WHERE murid_token = ?').run(body.token);
        return json({ ok: true });
      });
    }

    if (route === '/murid/blokir' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        db.prepare('UPDATE murid SET blokir = ? WHERE token = ? AND kelas_kode = ?').run(body.blokir ? 1 : 0, body.token, body.kode);
        return json({ ok: true });
      });
    }

    if (route === '/murid/riwayat' && req.method === 'POST') {
      return readBody(body => {
        const riwayats = db.prepare('SELECT data, created_at FROM riwayat WHERE murid_token = ? AND kelas_kode = ? ORDER BY created_at DESC LIMIT 50').all(body.token, body.kode);
        const list = riwayats.map(r => {
          const parsed = parseJSON(r.data, {});
          return parsed.sesi || { t: r.created_at };
        });
        return json({ riwayat: list });
      });
    }

    if (route === '/paket/simpan' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);

        const pk = body.paket || {};
        const judul = pk.judul || 'Paket Soal';
        let kode = body.kode;

        if (kode) {
          db.prepare('UPDATE paket SET judul = ?, paket = ?, diubah = ? WHERE kode = ? AND guru_id = ?')
            .run(judul, JSON.stringify(pk), Date.now(), kode, g.id);
        } else {
          kode = genCode(6);
          while (db.prepare('SELECT kode FROM paket WHERE kode = ?').get(kode)) {
            kode = genCode(6);
          }
          db.prepare(`
            INSERT INTO paket (kode, guru_id, judul, paket, publik, jenjang, mapel, diubah, created_at)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
          `).run(kode, g.id, judul, JSON.stringify(pk), pk.jenjang || '', pk.mapel_nama || '', Date.now(), Date.now());
        }

        return json({ kode: kode, judul: judul });
      });
    }

    if (route === '/paket/daftar' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        const rows = db.prepare('SELECT kode, judul, paket, publik, diubah FROM paket WHERE guru_id = ? ORDER BY diubah DESC').all(g.id);
        const list = rows.map(r => {
          const pk = parseJSON(r.paket, {});
          const mapels = pk.mapel || [];
          let soalCount = 0;
          for (const m of mapels) soalCount += (m.soal ? m.soal.length : 0);
          return {
            kode: r.kode,
            judul: r.judul,
            publik: Boolean(r.publik),
            diubah: r.diubah,
            mapel_count: mapels.length,
            soal_count: soalCount
          };
        });
        return json({ paket: list });
      });
    }

    if (route === '/paket/ambil' && req.method === 'POST') {
      return readBody(body => {
        const p = db.prepare('SELECT * FROM paket WHERE kode = ?').get(body.kode);
        if (!p) return err('Paket tidak ditemukan.', 404);
        return json({
          kode: p.kode,
          judul: p.judul,
          paket: parseJSON(p.paket, {})
        });
      });
    }

    if (route === '/paket/hapus' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        db.prepare('DELETE FROM paket WHERE kode = ? AND guru_id = ?').run(body.kode, g.id);
        return json({ ok: true });
      });
    }

    if (route === '/paket/publik' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        db.prepare('UPDATE paket SET publik = ? WHERE kode = ? AND guru_id = ?').run(body.publik ? 1 : 0, body.kode, g.id);
        return json({ ok: true });
      });
    }

    const paketPublicMatch = route.match(/^\/?paket\/([A-Za-z0-9]+)$/);
    if (paketPublicMatch && req.method === 'GET') {
      const kd = paketPublicMatch[1].toUpperCase();
      const p = db.prepare('SELECT * FROM paket WHERE kode = ?').get(kd);
      if (!p) return err('Paket soal tidak ditemukan.', 404);
      return json({
        kode: p.kode,
        judul: p.judul,
        paket: parseJSON(p.paket, {})
      });
    }

    if (route === '/guru/soal/simpan' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        const pkJSON = JSON.stringify(body.paket || {});
        db.prepare(`
          INSERT INTO soal_draft (guru_id, paket, pk, diubah)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(guru_id) DO UPDATE SET paket = excluded.paket, pk = excluded.pk, diubah = excluded.diubah
        `).run(g.id, pkJSON, body.pk || '', Date.now());
        return json({ ok: true, diubah: Date.now() });
      });
    }
    if (route === '/guru/soal/ambil' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        const row = db.prepare('SELECT * FROM soal_draft WHERE guru_id = ?').get(g.id);
        if (!row) return json({ paket: null });
        return json({
          paket: parseJSON(row.paket, null),
          pk: row.pk,
          diubah: row.diubah
        });
      });
    }

    if (route === '/bank/cari' && req.method === 'POST') {
      return readBody(body => {
        const rows = db.prepare('SELECT kode, judul, jenjang, mapel, diubah FROM paket WHERE publik = 1 LIMIT 50').all();
        return json({
          hasil: rows.map(r => ({
            kode: r.kode,
            judul: r.judul,
            jenjang: r.jenjang,
            mapel: r.mapel,
            bintang: 5
          }))
        });
      });
    }
    if (route === '/bank/ambil' && req.method === 'POST') {
      return readBody(body => {
        const p = db.prepare('SELECT * FROM paket WHERE kode = ?').get(body.kode);
        if (!p) return err('Paket bank soal tidak ditemukan.', 404);
        return json({ kode: p.kode, judul: p.judul, paket: parseJSON(p.paket, {}) });
      });
    }

    if (route === '/main/cek' && req.method === 'POST') {
      return readBody(body => {
        const kd = (body.kode || '').trim().toUpperCase();
        const t = db.prepare('SELECT * FROM tantangan WHERE id = ?').get(kd);
        if (!t) return err('Kode main tantangan tidak ditemukan.');

        const k = db.prepare('SELECT * FROM kelas WHERE kode = ?').get(t.kelas_kode);
        const parsedT = parseJSON(t.data, {});
        return json({
          kelas: { kode: k.kode, nama: k.nama, guru: k.guru_nama },
          tantangan: { id: t.id, ...parsedT },
          now: Date.now()
        });
      });
    }

    if (route === '/tantangan/simpan' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        const t = body.tantangan || {};
        const id = t.id || genCode(6);
        db.prepare(`
          INSERT INTO tantangan (id, kelas_kode, guru_id, data, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, status = excluded.status
        `).run(id, body.kode, g.id, JSON.stringify(t), t.status || 'draft', Date.now());
        return json({ ok: true, id: id });
      });
    }
    if (route === '/tantangan/mulai' && req.method === 'POST') {
      return readBody(body => {
        const t = db.prepare('SELECT * FROM tantangan WHERE id = ?').get(body.id);
        if (!t) return err('Tantangan tidak ditemukan.');
        return json({ ok: true, tantangan: { id: t.id, ...parseJSON(t.data, {}) } });
      });
    }
    if (route === '/tantangan/hapus' && req.method === 'POST') {
      return readBody(body => {
        const g = getGuruByLic(body.lic);
        if (!g) return err('Tidak terautentikasi.', 401);
        db.prepare('DELETE FROM tantangan WHERE id = ? AND guru_id = ?').run(body.id, g.id);
        return json({ ok: true });
      });
    }

    if (route === '/pendamping/masuk' && req.method === 'POST') {
      return readBody(body => {
        const p = db.prepare('SELECT * FROM pendamping WHERE kode = ?').get(body.kode);
        if (!p) return err('Kode pendamping tidak valid atau sudah dicabut.');
        const k = db.prepare('SELECT * FROM kelas WHERE kode = ?').get(p.kelas_kode);
        return json({
          token: p.token,
          nama: p.nama,
          kelas: { kode: k.kode, nama: k.nama, guru: k.guru_nama }
        });
      });
    }

    // ==========================================
    // --- ADMIN PANEL API ENDPOINTS ---
    // ==========================================
    const checkAdmin = (body) => {
      const token = (body && (body.admin_token || body.token)) || req.headers['x-admin-token'] || req.headers['authorization'];
      if (!token) return false;
      const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const row = db.prepare('SELECT v FROM setelan WHERE k = ?').get('admin_sess_' + cleanToken);
      return Boolean(row);
    };

    if (route === '/admin/masuk' && req.method === 'POST') {
      return readBody(body => {
        const username = (body.username || 'admin').trim();
        const pwd = body.sandi || '';
        const user = db.prepare('SELECT * FROM admin_user WHERE username = ?').get(username);
        if (!user || user.sandi_hash !== hashPassword(pwd)) {
          return err('Username atau sandi admin salah.', 401);
        }
        const token = genToken(24);
        setSetting('admin_sess_' + token, Date.now());
        return json({ ok: true, token: token });
      });
    }

    if (route.startsWith('/admin/')) {
      return readBody(body => {
        if (!checkAdmin(body)) return err('Akses ditolak. Silakan login admin.', 401);

        if (route === '/admin/stats' && req.method === 'POST') {
          const totalGuru = db.prepare('SELECT count(*) as c FROM guru').get().c;
          const guruAktif = db.prepare("SELECT count(*) as c FROM guru WHERE status IN ('aktif', 'seumur')").get().c;
          const guruMenunggu = db.prepare("SELECT count(*) as c FROM guru WHERE status = 'menunggu'").get().c;
          const totalAkses = db.prepare('SELECT count(*) as c FROM akses_gmail').get().c;
          const totalKelas = db.prepare('SELECT count(*) as c FROM kelas').get().c;
          const totalMurid = db.prepare('SELECT count(*) as c FROM murid').get().c;
          return json({
            total_guru: totalGuru,
            guru_aktif: guruAktif,
            guru_menunggu: guruMenunggu,
            total_akses_gmail: totalAkses,
            total_kelas: totalKelas,
            total_murid: totalMurid
          });
        }

        if (route === '/admin/akses/daftar' && req.method === 'POST') {
          const aksesList = db.prepare('SELECT * FROM akses_gmail ORDER BY created_at DESC').all();
          const guruList = db.prepare('SELECT id, email, nama, wa, sekolah, status, sampai, maks_kelas, no_pesanan, pemberi, created_at FROM guru ORDER BY created_at DESC').all();
          const kelasCount = {};

          for (const k of db.prepare('SELECT guru_id, count(*) as c FROM kelas GROUP BY guru_id').all()) {
            kelasCount[k.guru_id] = k.c;
          }

          const gurusWithStats = guruList.map(g => ({
            ...g,
            kelas_count: kelasCount[g.id] || 0
          }));

          return json({
            akses_gmail: aksesList,
            guru: gurusWithStats
          });
        }

        if (route === '/admin/akses/tambah' && req.method === 'POST') {
          let email = (body.email || '').trim().toLowerCase();
          const nama = (body.nama || '').trim();
          const maks_kelas = Number(body.maks_kelas) || 10;
          const catatan = (body.catatan || '').trim();
          const no_pesanan = (body.no_pesanan || '').trim();
          const pemberi = (body.pemberi || 'Admin Zentara').trim();
          let status = 'aktif';
          let sampai = Number(body.sampai) || 0;

          if (!email && no_pesanan) {
            email = 'order_' + no_pesanan.toLowerCase().replace(/[^a-z0-9]/g, '') + '@voucher.zentara';
          }

          if (!email || !email.includes('@')) return err('Email atau Nomor Pesanan harus diisi.');

          if (body.seumur || body.durasi === 'seumur') {
            status = 'seumur';
            sampai = 0;
          } else if (body.masa_hari) {
            const existing = db.prepare('SELECT sampai FROM guru WHERE email = ? COLLATE NOCASE').get(email) 
              || db.prepare('SELECT sampai FROM akses_gmail WHERE email = ? COLLATE NOCASE').get(email);
            const baseTime = (existing && existing.sampai > Date.now()) ? existing.sampai : Date.now();
            sampai = baseTime + Number(body.masa_hari) * 24 * 3600 * 1000;
          } else if (body.status) {
            status = body.status;
          }

          db.prepare(`
            INSERT INTO akses_gmail (email, nama, status, sampai, maks_kelas, catatan, no_pesanan, pemberi, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
              nama = CASE WHEN excluded.nama != '' THEN excluded.nama ELSE akses_gmail.nama END,
              status = excluded.status,
              sampai = excluded.sampai,
              maks_kelas = excluded.maks_kelas,
              catatan = excluded.catatan,
              no_pesanan = CASE WHEN excluded.no_pesanan != '' THEN excluded.no_pesanan ELSE akses_gmail.no_pesanan END,
              pemberi = CASE WHEN excluded.pemberi != '' THEN excluded.pemberi ELSE akses_gmail.pemberi END
          `).run(email, nama, status, sampai, maks_kelas, catatan, no_pesanan, pemberi, Date.now());

          const existingGuru = db.prepare('SELECT * FROM guru WHERE email = ? COLLATE NOCASE').get(email);
          if (existingGuru) {
            db.prepare("UPDATE guru SET status = ?, sampai = ?, maks_kelas = ?, no_pesanan = COALESCE(NULLIF(?, ''), no_pesanan), pemberi = COALESCE(NULLIF(?, ''), pemberi) WHERE id = ?")
              .run(status, sampai, maks_kelas, no_pesanan, pemberi, existingGuru.id);
          }

          return json({ ok: true, msg: `Akses berhasil diberikan untuk ${email}` });
        }

        if (route === '/admin/akses/setujui' && req.method === 'POST') {
          const email = (body.email || '').trim().toLowerCase();
          if (!email) return err('Email harus diisi.');

          const g = db.prepare('SELECT * FROM guru WHERE email = ? COLLATE NOCASE').get(email);
          if (!g) return err('Akun guru tidak ditemukan.');

          let status = 'aktif';
          let sampai = 0;
          if (body.seumur || body.status === 'seumur') {
            status = 'seumur';
            sampai = 0;
          } else {
            const baseTime = (g.sampai && g.sampai > Date.now()) ? g.sampai : Date.now();
            sampai = baseTime + (Number(body.masa_hari) || 365) * 24 * 3600 * 1000;
          }
          const maks_kelas = Number(body.maks_kelas) || g.maks_kelas || 10;
          const no_pesanan = (body.no_pesanan || g.no_pesanan || '').trim();
          const pemberi = (body.pemberi || g.pemberi || 'Admin Zentara').trim();

          db.prepare('UPDATE guru SET status = ?, sampai = ?, maks_kelas = ?, no_pesanan = ?, pemberi = ? WHERE id = ?')
            .run(status, sampai, maks_kelas, no_pesanan, pemberi, g.id);

          db.prepare(`
            INSERT INTO akses_gmail (email, nama, status, sampai, maks_kelas, catatan, no_pesanan, pemberi, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET 
              status = excluded.status, 
              sampai = excluded.sampai, 
              maks_kelas = excluded.maks_kelas,
              no_pesanan = CASE WHEN excluded.no_pesanan != '' THEN excluded.no_pesanan ELSE akses_gmail.no_pesanan END,
              pemberi = CASE WHEN excluded.pemberi != '' THEN excluded.pemberi ELSE akses_gmail.pemberi END
          `).run(email, g.nama, status, sampai, maks_kelas, 'Disetujui admin', no_pesanan, pemberi, Date.now());

          return json({ ok: true, msg: `Akun ${email} berhasil diaktifkan!` });
        }

        if (route === '/admin/akses/ubah' && req.method === 'POST') {
          const email = (body.email || '').trim().toLowerCase();
          if (!email) return err('Email harus diisi.');

          const g = db.prepare('SELECT * FROM guru WHERE email = ? COLLATE NOCASE').get(email);
          const no_pesanan = (body.no_pesanan !== undefined ? body.no_pesanan : (g ? g.no_pesanan : '')).trim();
          const pemberi = (body.pemberi !== undefined ? body.pemberi : (g ? g.pemberi : 'Admin Zentara')).trim();
          const maks_kelas = Number(body.maks_kelas) || (g ? g.maks_kelas : 10);

          if (g) {
            db.prepare('UPDATE guru SET no_pesanan = ?, pemberi = ?, maks_kelas = ? WHERE id = ?')
              .run(no_pesanan, pemberi, maks_kelas, g.id);
          }

          db.prepare(`
            UPDATE akses_gmail 
            SET no_pesanan = ?, pemberi = ?, maks_kelas = ? 
            WHERE email = ? COLLATE NOCASE
          `).run(no_pesanan, pemberi, maks_kelas, email);

          return json({ ok: true, msg: `Data lisensi ${email} berhasil diperbarui!` });
        }

        if (route === '/admin/akses/status' && req.method === 'POST') {
          const email = (body.email || '').trim().toLowerCase();
          const newStatus = body.status;
          if (!email || !newStatus) return err('Email dan status diperlukan.');

          db.prepare('UPDATE guru SET status = ? WHERE email = ?').run(newStatus, email);
          db.prepare('UPDATE akses_gmail SET status = ? WHERE email = ?').run(newStatus, email);

          return json({ ok: true, msg: `Status ${email} diubah menjadi ${newStatus}.` });
        }

        if (route === '/admin/akses/hapus' && req.method === 'POST') {
          const email = (body.email || '').trim().toLowerCase();
          if (!email) return err('Email diperlukan.');

          const g = db.prepare('SELECT id FROM guru WHERE email = ?').get(email);
          if (g) {
            db.prepare('DELETE FROM sesi WHERE guru_id = ?').run(g.id);
            db.prepare('DELETE FROM guru WHERE id = ?').run(g.id);
          }
          db.prepare('DELETE FROM akses_gmail WHERE email = ?').run(email);

          return json({ ok: true, msg: `Akses dan data untuk ${email} dihapus.` });
        }

        if (route === '/admin/kelas' && req.method === 'POST') {
          const rows = db.prepare(`
            SELECT k.kode, k.nama, k.guru_nama, k.pin, k.terkunci, k.created_at, g.email as guru_email,
                   (SELECT count(*) FROM murid m WHERE m.kelas_kode = k.kode) as murid_count
            FROM kelas k
            LEFT JOIN guru g ON k.guru_id = g.id
            ORDER BY k.created_at DESC
          `).all();
          return json({ kelas: rows });
        }

        if (route === '/admin/sandi' && req.method === 'POST') {
          const sandiBaru = body.sandi_baru;
          if (!sandiBaru || sandiBaru.length < 4) return err('Sandi baru minimal 4 karakter.');
          db.prepare('UPDATE admin_user SET sandi_hash = ? WHERE username = ?').run(hashPassword(sandiBaru), 'admin');
          return json({ ok: true, msg: 'Kata sandi admin berhasil diubah.' });
        }

        return err('Rute admin tidak ditemukan.', 404);
      });
    }

    return err('Alamat tidak ditemukan', 404);
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (pathname === '/admin' || pathname === '/admin/') filePath = path.join(PUBLIC_DIR, 'admin.html');

  fs.stat(filePath, (errStat, stats) => {
    if (errStat || !stats.isFile()) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallback, (errFb, data) => {
        if (errFb) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
});

// --- WEBSOCKET SERVER (Multiplayer Realtime) ---
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map();

server.on('upgrade', (request, socket, head) => {
  const parsed = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (parsed.pathname === '/ws' || parsed.pathname.startsWith('/ws/') || parsed.pathname.startsWith('/ws?') || parsed.pathname === '/kelas' || parsed.pathname.startsWith('/kelas/') || parsed.pathname.startsWith('/kelas?')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rawKode = parsed.searchParams.get('kode');
  const kode = (rawKode ? rawKode.trim().toUpperCase() : 'PUBLIK');
  const token = (parsed.searchParams.get('token') || '').trim();
  const isGuru = Boolean(parsed.searchParams.get('guru'));
  const qNama = (parsed.searchParams.get('nama') || '').trim();
  const clientId = genToken(8);

  ws.roomKode = kode;
  ws.clientId = clientId;
  ws.isGuru = isGuru;
  ws.info = {
    id: clientId,
    nama: isGuru ? 'Guru' : (qNama || 'Petualang'),
    absen: '',
    z: 'kota',
    g: isGuru ? 1 : 0,
    isGuru: isGuru,
    o: null,
    p: null,
    lv: 1
  };

  if (kode && token && !isGuru) {
    try {
      const m = db.prepare('SELECT token, nama, absen FROM murid WHERE kelas_kode = ? AND token = ?').get(kode, token);
      if (m) {
        ws.muridToken = m.token;
        ws.info.nama = m.nama || ws.info.nama;
        ws.info.absen = m.absen || '';
      }
    } catch (e) {
      console.error('[WS] Murid lookup error:', e);
    }
  }

  if (!rooms.has(kode)) rooms.set(kode, new Map());
  rooms.get(kode).set(clientId, ws);

  const broadcastToRoom = (data, excludeId = null) => {
    if (!ws.roomKode || !rooms.has(ws.roomKode)) return;
    const msg = JSON.stringify(data);
    for (const [id, peer] of rooms.get(ws.roomKode).entries()) {
      if (id !== excludeId && peer.readyState === peer.OPEN) {
        try { peer.send(msg); } catch {}
      }
    }
  };

  const broadcastToZone = (zone, data, excludeId = null) => {
    if (!ws.roomKode || !rooms.has(ws.roomKode) || !zone) return;
    const msg = JSON.stringify(data);
    for (const [id, peer] of rooms.get(ws.roomKode).entries()) {
      if (id !== excludeId && peer.readyState === peer.OPEN && peer.info && peer.info.z === zone) {
        try { peer.send(msg); } catch {}
      }
    }
  };

  const getRoster = () => {
    const list = [];
    if (ws.roomKode && rooms.has(ws.roomKode)) {
      for (const peer of rooms.get(ws.roomKode).values()) {
        if (peer.info && peer.info.nama) list.push(peer.info);
      }
    }
    return list;
  };

  const syncRoster = () => {
    broadcastToRoom({ t: 'roster', list: getRoster() });
  };

  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }

    if (d.t === 'auth') {
      ws.isGuru = true;
      ws.info.g = 1;
      ws.info.isGuru = true;
      if (d.mode === 'obs') ws.info.obs = true;

      if (d.lic) {
        const guru = getGuruByLic(d.lic);
        if (guru) {
          ws.info.nama = guru.nama || 'Guru';
        }
      }
      ws.send(JSON.stringify({ t: 'ok', id: clientId }));
      ws.send(JSON.stringify({ t: 'roster', list: getRoster() }));
      return;
    }

    if (d.t === 'hi') {
      ws.info = {
        ...ws.info,
        nama: (d.nama && d.nama.trim()) || ws.info.nama || 'Teman',
        z: d.z || 'kota',
        o: d.o || ws.info.o,
        p: d.p || ws.info.p,
        sc: d.sc || ws.info.sc,
        lv: (d.sc && d.sc.lv) ? d.sc.lv : (ws.info.lv || 1)
      };

      ws.send(JSON.stringify({ t: 'roster', list: getRoster() }));

      if (ws.roomKode && rooms.has(ws.roomKode)) {
        const peersInZone = [];
        for (const [id, peer] of rooms.get(ws.roomKode).entries()) {
          if (id !== clientId && peer.info && peer.info.z === ws.info.z) {
            peersInZone.push(peer.info);
          }
        }
        ws.send(JSON.stringify({ t: 'all', me: clientId, list: peersInZone }));
      }

      broadcastToZone(ws.info.z, {
        t: 'join',
        id: clientId,
        nama: ws.info.nama,
        z: ws.info.z,
        g: ws.info.g,
        o: ws.info.o,
        p: ws.info.p,
        lv: ws.info.lv
      }, clientId);

      syncRoster();
      return;
    }

    if (d.t === 'z') {
      const prevZ = ws.info.z;
      const newZ = d.z || 'kota';

      ws.info = {
        ...ws.info,
        nama: (d.nama && d.nama.trim()) || ws.info.nama || 'Teman',
        z: newZ,
        o: d.o || ws.info.o,
        p: d.p || ws.info.p,
        sc: d.sc || ws.info.sc,
        lv: (d.sc && d.sc.lv) ? d.sc.lv : (ws.info.lv || 1)
      };

      if (prevZ && prevZ !== newZ) {
        broadcastToZone(prevZ, { t: 'left', id: clientId }, clientId);
      }

      if (ws.roomKode && rooms.has(ws.roomKode)) {
        const peersInZone = [];
        for (const [id, peer] of rooms.get(ws.roomKode).entries()) {
          if (id !== clientId && peer.info && peer.info.z === newZ) {
            peersInZone.push(peer.info);
          }
        }
        ws.send(JSON.stringify({ t: 'all', me: clientId, list: peersInZone }));
      }

      broadcastToZone(newZ, {
        t: 'join',
        id: clientId,
        nama: ws.info.nama,
        z: newZ,
        g: ws.info.g,
        o: ws.info.o,
        p: ws.info.p,
        lv: ws.info.lv
      }, clientId);

      syncRoster();
      return;
    }

    if (d.t === 'p') {
      ws.info.p = d.p;
      broadcastToZone(ws.info.z, { t: 'p', id: clientId, p: d.p }, clientId);
      return;
    }

    if (d.t === 'o') {
      ws.info.o = d.o;
      broadcastToZone(ws.info.z, { t: 'o', id: clientId, o: d.o }, clientId);
      return;
    }

    if (d.t === 'e') {
      broadcastToZone(ws.info.z, { t: 'e', id: clientId, e: d.e }, clientId);
      return;
    }

    if (d.t === 'sc') {
      ws.info.sc = d.sc;
      if (d.sc && d.sc.lv) ws.info.lv = d.sc.lv;
      syncRoster();
      return;
    }

    if (d.t === 'st') {
      ws.info.st = { s: d.s, m: d.m, q: d.q };
      broadcastToRoom({ t: 'st', id: clientId, st: ws.info.st });
      return;
    }

    if (d.t === 'siap') {
      ws.info.siap = d.id;
      syncRoster();
      return;
    }

    if (d.t === 'go') {
      broadcastToRoom({ t: 'go', id: d.id, k: d.k });
      return;
    }

    if (d.t === 'ann') {
      broadcastToRoom({ t: 'ann', nama: ws.info.nama || 'Guru', text: d.text, at: Date.now() });
      return;
    }

    if (d.t === 'call') {
      broadcastToRoom({ t: 'call', nama: ws.info.nama || 'Guru', z: ws.info.z || 'kota' });
      return;
    }

    if (d.t === 'ev') {
      broadcastToRoom({ t: 'ev', id: clientId, nama: ws.info.nama, ...d });
      return;
    }
  });

  ws.on('close', () => {
    if (ws.roomKode && rooms.has(ws.roomKode)) {
      rooms.get(ws.roomKode).delete(clientId);
      broadcastToRoom({ t: 'left', id: clientId });
      if (rooms.get(ws.roomKode).size === 0) rooms.delete(ws.roomKode);
      else syncRoster();
    }
  });
});

process.on('uncaughtException', (err) => {
  console.error('[Zentara Error]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[Zentara Rejection]', err);
});

server.listen(PORT, () => {
  console.log(`[Zentara] Server aktif di http://localhost:${PORT}`);
  console.log(`[Zentara] Panel Admin di http://localhost:${PORT}/admin.html`);
});
