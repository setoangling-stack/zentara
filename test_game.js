/**
 * Zentara Test Suite
 * Pengujian otomatis endpoint backend, websocket, dan manajemen langganan guru.
 */

const http = require('http');
const WebSocket = require('ws');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(BASE_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(resBody) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: resBody });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + path, res => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(resBody) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: resBody });
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('🚀 Memulai pengujian Zentara...\n');

  // 1. Endpoint Publik
  const setelan = await get('/api/setelan');
  assert.strictEqual(setelan.status, 200);
  assert.strictEqual(setelan.body.app_title, 'Zentara - Semesta Belajar 3D');
  console.log('✅ Setelan sistem Zentara terverifikasi.');

  // 2. Registrasi & Siklus Langganan Guru
  const testEmail = `guru_${Date.now()}@test.com`;
  const reg = await post('/api/akun/daftar', {
    email: testEmail,
    sandi: 'password123',
    nama: 'Budi Santoso',
    wa: '08123456789',
    sekolah: 'SMP Zentara 1'
  });
  assert.strictEqual(reg.status, 200);
  assert(reg.body.sess, 'Sesi token harus ada');
  assert.strictEqual(reg.body.guru.status, 'menunggu', 'Status guru awal harus menunggu');
  assert.strictEqual(reg.body.guru.kelas, 0);
  assert.strictEqual(reg.body.guru.perangkat, 1);
  console.log('✅ Registrasi guru berhasil dengan status "menunggu".');

  const sessToken = reg.body.sess;
  const lic = { sess: sessToken };

  // Profil saya saat menunggu
  const profilMenunggu = await post('/api/akun/saya', { lic });
  assert.strictEqual(profilMenunggu.body.guru.status, 'menunggu');
  assert.strictEqual(profilMenunggu.body.guru.wa, '08123456789');
  assert.strictEqual(profilMenunggu.body.guru.sekolah, 'SMP Zentara 1');
  console.log('✅ Profil guru saat status menunggu valid.');

  // Guru berstatus menunggu dilarang membuat kelas
  const buatDitolak = await post('/api/kelas/buat', { lic, nama: 'Kelas Matematika' });
  assert.strictEqual(buatDitolak.status, 403);
  console.log('✅ Pembuatan kelas dicegah saat status menunggu.');

  // 3. Admin Login & Aktivasi Guru
  const adminLogin = await post('/api/admin/masuk', { username: 'admin', sandi: 'admin123' });
  assert.strictEqual(adminLogin.status, 200);
  const admToken = adminLogin.body.token;

  // Setujui 365 hari
  const appRes = await post('/api/admin/akses/setujui', {
    token: admToken,
    email: testEmail,
    masa_hari: 365
  });
  assert.strictEqual(appRes.status, 200);

  // Cek profil setelah disetujui
  const profilAktif = await post('/api/akun/saya', { lic });
  assert.strictEqual(profilAktif.body.guru.status, 'aktif');
  assert(profilAktif.body.guru.sampai > Date.now());
  const initialExpiry = profilAktif.body.guru.sampai;
  console.log('✅ Guru berhasil diaktifkan 365 hari.');

  // 4. Perpanjangan Langganan (+30 hari tidak boleh mereset hari tersisa)
  const extRes = await post('/api/admin/akses/setujui', {
    token: admToken,
    email: testEmail,
    masa_hari: 30
  });
  assert.strictEqual(extRes.status, 200);
  const profilDiperpanjang = await post('/api/akun/saya', { lic });
  const extendedExpiry = profilDiperpanjang.body.guru.sampai;
  const diffDays = Math.round((extendedExpiry - initialExpiry) / (24 * 3600 * 1000));
  assert.strictEqual(diffDays, 30, 'Perpanjangan harus menambah 30 hari ke masa aktif sebelumnya');
  console.log('✅ Perpanjangan langganan akumulatif (+30 hari) berhasil.');

  // 5. Pembuatan Kelas oleh Guru Aktif
  const buatKelas = await post('/api/kelas/buat', { lic, nama: 'Kelas Zentara 7A' });
  assert.strictEqual(buatKelas.status, 200);
  const kodeKelas = buatKelas.body.kode;
  assert(kodeKelas, 'Kode kelas harus terbuat');
  console.log(`✅ Pembuatan kelas berhasil dengan kode: ${kodeKelas}`);

  // Cek jumlah kelas di profil bertambah 1
  const profilKelas = await post('/api/akun/saya', { lic });
  assert.strictEqual(profilKelas.body.guru.kelas, 1);
  console.log('✅ Sinkronisasi counter kelas terverifikasi.');

  // 6. Ganti Kata Sandi (dukung parameter frontend "lama" & "baru")
  const gantiSandi = await post('/api/akun/sandi', {
    lic,
    lama: 'password123',
    baru: 'sandiBaru456'
  });
  assert.strictEqual(gantiSandi.status, 200);
  console.log('✅ Perubahan kata sandi berhasil.');

  // 7. Pengujian Masa Langganan Habis
  // Paksa masa aktif ke masa lampau via SQLite / akses_tambah
  const expRes = await post('/api/admin/akses/tambah', {
    token: admToken,
    email: testEmail,
    sampai: Date.now() - (10 * 24 * 3600 * 1000) // 10 hari lalu (lewat masa tenggang 7 hari)
  });
  assert.strictEqual(expRes.status, 200);

  const profilHabis = await post('/api/akun/saya', { lic });
  assert.strictEqual(profilHabis.body.guru.status, 'habis', 'Status harus menjadi habis jika lewat tenggang');
  console.log('✅ Deteksi dinamis status "habis" berfungsi.');

  // Pembuatan kelas harus ditolak saat status habis
  const buatKelasHabis = await post('/api/kelas/buat', { lic, nama: 'Kelas Baru Saat Habis' });
  assert.strictEqual(buatKelasHabis.status, 403);
  assert.strictEqual(buatKelasHabis.body.kode, 'habis');
  console.log('✅ Pembuatan kelas dicegah saat langganan habis dengan kode error "habis".');

  // 8. Aktivasi Seumur Hidup (Lifetime)
  const seumurRes = await post('/api/admin/akses/setujui', {
    token: admToken,
    email: testEmail,
    seumur: true
  });
  assert.strictEqual(seumurRes.status, 200);

  const profilSeumur = await post('/api/akun/saya', { lic });
  assert.strictEqual(profilSeumur.body.guru.status, 'seumur');
  assert.strictEqual(profilSeumur.body.guru.sampai, 0);
  console.log('✅ Aktivasi lisensi Seumur Hidup terverifikasi.');

  // Bisa buat kelas kembali
  const buatKelasSeumur = await post('/api/kelas/buat', { lic, nama: 'Kelas Seumur Hidup' });
  assert.strictEqual(buatKelasSeumur.status, 200);
  console.log('✅ Pembuatan kelas kembali aktif setelah lisensi seumur hidup diberikan.');

  // 9. WebSocket Multiplayer Test
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3000/ws?kode=${kodeKelas}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'auth' }));
    });
    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.t === 'ok') {
        ws.close();
        console.log('✅ Koneksi WebSocket multiplayer terautentikasi.');
        resolve();
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Timeout WebSocket')), 3000);
  });

  // 10. Fitur Tracking No. Pesanan dan Pemberi Lisensi
  console.log('\n--- Uji Fitur No. Pesanan & Pemberi Lisensi ---');
  const testEmail2 = `guru_pesanan_${Date.now()}@sekolah.id`;

  // Admin menambah akses dengan nomor pesanan & pemberi
  const tambahAksesRes = await post('/api/admin/akses/tambah', {
    token: admToken,
    email: testEmail2,
    nama: 'Guru Pesanan Test',
    masa_hari: 60,
    maks_kelas: 15,
    no_pesanan: 'INV-202611-9988',
    pemberi: 'CS Maya Zentara'
  });
  assert.strictEqual(tambahAksesRes.status, 200);

  // Guru mendaftar akun
  const daftarRes2 = await post('/api/akun/daftar', {
    email: testEmail2,
    sandi: 'guru123456',
    nama: 'Guru Pesanan Test',
    wa: '081299998888',
    sekolah: 'SMP Zentara Mandiri'
  });
  assert.strictEqual(daftarRes2.status, 200);
  assert.strictEqual(daftarRes2.body.guru.no_pesanan, 'INV-202611-9988');
  assert.strictEqual(daftarRes2.body.guru.pemberi, 'CS Maya Zentara');
  console.log('✅ Auto-link data no_pesanan & pemberi dari akses_gmail ke guru saat daftar berhasil.');

  // Admin mengedit / mengubah nomor pesanan dan pemberi lisensi
  const ubahLisensiRes = await post('/api/admin/akses/ubah', {
    token: admToken,
    email: testEmail2,
    no_pesanan: 'INV-MODIF-5544',
    pemberi: 'Supervisor Budi',
    maks_kelas: 20
  });
  assert.strictEqual(ubahLisensiRes.status, 200);

  // Cek profil guru setelah update
  const lic2 = daftarRes2.body.sess;
  const profilRes2 = await post('/api/akun/saya', { lic: lic2 });
  assert.strictEqual(profilRes2.body.guru.no_pesanan, 'INV-MODIF-5544');
  assert.strictEqual(profilRes2.body.guru.pemberi, 'Supervisor Budi');
  assert.strictEqual(profilRes2.body.guru.maks_kelas, 20);
  console.log('✅ Endpoint ubah lisensi berhasil memperbarui nomor pesanan dan pemberi.');

  // Cek tabel akses di admin
  const listAdmin = await post('/api/admin/akses/daftar', { token: admToken });
  const rowGuru = listAdmin.body.guru.find(g => g.email === testEmail2);
  assert.ok(rowGuru, 'Guru harus ada di daftar guru admin');
  assert.strictEqual(rowGuru.no_pesanan, 'INV-MODIF-5544');
  assert.strictEqual(rowGuru.pemberi, 'Supervisor Budi');
  console.log('✅ Daftar guru di admin panel menampilkan nomor pesanan dan pemberi lisensi.');

  // ==========================================
  // 11. UJI VOUCHER / KLAIM NOMOR PESANAN OLEH GURU MANDIRI
  // ==========================================
  console.log('\n--- 11. Uji Klaim Nomor Pesanan Voucher Oleh Guru ---');
  const voucherOrder = 'ORD-VOUCHER-' + Date.now();
  // Admin buat akses lisensi dengan nomor pesanan
  const buatVoucherRes = await post('/api/admin/akses/tambah', {
    token: admToken,
    no_pesanan: voucherOrder,
    pemberi: 'CS Shopee Zentara',
    masa_hari: 365,
    maks_kelas: 15
  });
  assert.strictEqual(buatVoucherRes.status, 200);

  // Guru mendaftar dengan emailnya sendiri memakai bukti / nomor pesanan voucher
  const realGuruEmail = `guru.real.${Date.now()}@belajar.id`;
  const daftarVoucherRes = await post('/api/akun/daftar', {
    email: realGuruEmail,
    sandi: 'passwordGuru123',
    nama: 'Guru Pembeli Voucher',
    wa: '085712345678',
    sekolah: 'SD Negeri Cerdas',
    bukti: voucherOrder // Memakai nomor pesanan yang diberikan admin
  });
  assert.strictEqual(daftarVoucherRes.status, 200);
  assert.strictEqual(daftarVoucherRes.body.guru.status, 'aktif', 'Akun guru harus langsung aktif saat memakai nomor pesanan yang valid');
  assert.strictEqual(daftarVoucherRes.body.guru.no_pesanan, voucherOrder);
  assert.strictEqual(daftarVoucherRes.body.guru.pemberi, 'CS Shopee Zentara');

  // Pastikan langsung masuk dan muncul di dashboard admin
  const listAdmin2 = await post('/api/admin/akses/daftar', { token: admToken });
  const foundInGuru = listAdmin2.body.guru.find(g => g.email === realGuruEmail);
  assert.ok(foundInGuru, 'Guru pembeli voucher harus langsung masuk ke daftar guru admin');
  assert.strictEqual(foundInGuru.no_pesanan, voucherOrder);
  assert.strictEqual(foundInGuru.status, 'aktif');

  const foundInAkses = listAdmin2.body.akses_gmail.find(a => a.no_pesanan === voucherOrder);
  assert.ok(foundInAkses, 'Nomor pesanan harus ada di tabel whitelist/pesanan admin');
  assert.strictEqual(foundInAkses.email, realGuruEmail, 'Akses gmail harus tertaut ke email asli guru');
  console.log('✅ Guru berhasil memakai nomor pesanan dan langsung masuk ke dashboard admin.');

  console.log('\n🎉 SEMUA PENGUJIAN ZENTARA DAN SISTEM LANGGANAN GURU SUKSES 100%!');
}

runTests().catch(err => {
  console.error('❌ Uji gagal:', err);
  process.exit(1);
});
