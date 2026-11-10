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
- Promosi menyimpan aset publik terverifikasi dari manifest versi sebelumnya
  ke `/var/www/rhi/retained/assets`; Nginx memakai ini hanya bila aset tidak ada
  di rilis aktif. Tab yang menunda update tetap dapat mengambil lazy chunks.
  Tabrakan nama dengan isi berbeda ditolak. Tidak ada backup/config privat yang
  disalin. Belum ada penghapusan otomatis aset lama; pantau kapasitas disk.

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

Hasil akhir:

- Lint, typecheck, kontrak modular, controller PWA dan build bersih lulus.
- CUA Chrome pada harness lokal mengonfirmasi penutup offline, pemulihan online,
  isian `Draft uji tidak boleh hilang` tetap ada, serta notifikasi update tanpa
  reload. Lifecycle jaringan/update disimulasikan oleh harness. Perubahan
  penempatan penutup ke portal body sesudah pemeriksaan ini lolos lint/typecheck
  dan build; pemeriksaan visual ulang tidak selesai karena CUA timeout.
- Interaksi konfirmasi update melalui UI dan browser publik sesudah deploy
  tidak diklaim lulus: fokus browser berpindah dan native UI kemudian timeout.
  Persetujuan/aktivasi per tab tetap diuji oleh controller test di atas.
- Frontend `f27c949a026000bf70472fb4d7ef17d4d4fd8ee9` dipromosikan pada
  10 November 12:42 WIB. Pemeriksaan HTTP eksternal 12:45 WIB mencocokkan
  **211 file** dengan SHA-256 manifest, empat rute SPA, dua halaman backup,
  manifest MIME dan cache header. Sebanyak **103 aset yang hanya ada di rilis
  lama** juga diunduh dan cocok SHA-256 melalui fallback retained-assets.
- Uji API preview baru: login, refresh, issuer sesi, lookup user, baca order,
  penolakan write API dan SQL lulus. Akun/profil/sesi disposable dibersihkan.
  Eksternal write tetap 409 dan callback provider tetap 503.
- Pengaman retained-assets diuji untuk copy, idempotensi, penolakan tabrakan
  nama/isi dan traversal. Nginx test/reload lulus untuk kedua perubahan.

Bukti privat: `pwa-release-postcheck.json`, `pwa-retained-assets-postcheck.json`,
`pwa-header-deployment.json`, `pwa-retained-assets-deployment.json`, dan
`preview-readonly-verification.json` di direktori migrasi lokal/VPS.
Rollback frontend tersedia di `/var/www/rhi/releases/preview-b6d12bc`;
konfigurasi Nginx sebelum setiap perubahan disimpan terpisah di VPS.

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
