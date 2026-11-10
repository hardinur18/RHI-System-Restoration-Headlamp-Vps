# Perbaikan PWA — 10 November 2026

Menindaklanjuti audit mobile: pembaruan tidak boleh memuat ulang form tanpa
tindakan pengguna; data tidak boleh tampak kosong ketika browser offline.

## Perubahan

- Service worker memakai mode prompt, tanpa `skipWaiting` otomatis. Pengguna
  menyelesaikan isian, memilih Perbarui, lalu mengonfirmasi muat ulang.
- Persetujuan berlaku per tab. Aktivasi oleh tab lain hanya menampilkan
  pemberitahuan; tab yang belum menyetujui tidak di-refresh. Gagal/timeout
  aktivasi mencabut persetujuan agar aktivasi terlambat tidak mengejutkan user.
- Kegagalan lazy chunk juga menawarkan reload, tidak langsung me-refresh.
- Ketika browser mendeteksi offline, penutup aksesibel menyembunyikan data dan
  membuat konten/form/dialog di belakangnya inert. Komponen form tetap terpasang;
  koneksi kembali memulihkan akses dan menawarkan reload yang dikonfirmasi.
  Ini bukan penyimpanan draft tahan tutup aplikasi dan bukan antrean transaksi
  offline. `navigator.onLine` juga tidak menjamin server dapat dijangkau.
- Manifest mempunyai identitas `/` (sama dengan identitas implisit sebelumnya),
  bahasa Indonesia, ikon `any` tanpa klaim maskable yang belum tervalidasi,
  dan tautan Apple touch icon. Nginx mengirim MIME `application/manifest+json`.
- Fallback SPA mengecualikan `/backup/` dan metadata rilis/manifest sehingga
  service worker tidak mengganti halaman publik tersebut dengan aplikasi.

## Verifikasi dan batasan

`node scripts/test-pwa-update.mjs` menguji discovery tanpa reload, penolakan
offline, persetujuan per tab, aktivasi eksternal, reload sekali, unsubscribe,
kegagalan aktivasi, timeout/aktivasi terlambat, dan reload lazy chunk. Tes ini
menguji controller lifecycle, bukan dua perangkat fisik atau rollout aktual
dua versi service worker.

Uji lokal memakai komponen produksi dengan simulasi lifecycle/jaringan dan
form disposable, tanpa koneksi database. Bukti browser/deployment akhir
dicatat sesudah verifikasi. Lint, typecheck, kontrak modular, dan build release
harus lulus sebelum promosi preview.

Instalasi dari home screen Android/iPhone, Safari, keyboard fisik/virtual,
upload foto dan izin lokasi teknisi masih membutuhkan perangkat tersebut.
Screenshot untuk tampilan instalasi yang lebih kaya bersifat opsional dan
belum ditambahkan. Jangan menyebut seluruh matriks perangkat lulus.

## Transisi dari worker lama

Kode lama sudah mempunyai listener auto-reload. Rilis baru tidak bisa mengubah
JavaScript yang masih berjalan di tab lama. Worker baru tidak memaksa aktivasi;
untuk berpindah pertama kali, simpan pekerjaan, tutup semua tab/jendela PWA RHI,
lalu buka lagi. Setelah kode baru termuat, update berikutnya mengikuti prompt
dan persetujuan per tab. Preview tetap mode baca; belum ada perpindahan staf,
webhook, atau pembukaan input VPS.
