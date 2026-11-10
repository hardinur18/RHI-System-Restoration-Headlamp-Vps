# Audit refactor, web HP, dan PWA — 10 November 2026

Status: refactor kerangka aplikasi sudah terpasang dan web HP dapat dipreview.
PWA belum dinyatakan selesai untuk rilis. Audit ini tidak membuka input VPS,
memindahkan webhook, atau menyinkronkan data produksi.

## Lingkup dan bukti

- Sumber: branch `chore/vps-isolated-migration`, commit aplikasi/operasional
  `7281f77`; frontend publik `b6d12bc`, mode baca, snapshot 6 November 19:33 WIB.
- Chrome desktop melalui CUA, sesi incognito dengan viewport responsif
  390 × 844 dan 360 × 740. Ini bukan Android/iOS fisik atau Safari.
- Akun Owner disposable dibuat khusus untuk audit dan kemudian dihapus bersama
  sesi serta profilnya. Tidak ada order, prospek, atau pesan sungguhan dibuat.
- Tes modular dijalankan ulang: izin tab, fallback tujuh role, 61 pemetaan rute,
  slot workspace, loading, dan placeholder lulus.
- `npm run lint` dan `npm run typecheck` lulus pada audit ini; bukan pengulangan
  seluruh suite typecheck per domain atau 67 pengujian backend.

## Refactor yang sudah lebih baik

Commit `ff1a15e` memisahkan pemilihan halaman dan lazy imports ke
`AppPageContent`, aturan akses ke `appLayoutAccess`, loading ke
`PageLoadingState`, serta penanganan kegagalan halaman ke `PageErrorBoundary`.
`AppLayout` berkurang dari 918 menjadi 568 baris. `WorkspaceFrame` dipakai
bersama oleh workspace percakapan dan iklan; filter iklan memiliki komponen
tersendiri dan nama aksesibel.

Ini modularisasi kerangka, bukan refactor seluruh modul bisnis. Misalnya,
`src/styles/foundation.css` masih 31.272 baris dan tetap menjadi utang
pemeliharaan. Belum ada pengukuran performa sebelum/sesudah yang membuktikan
aplikasi lebih cepat akibat refactor.

## Pemeriksaan browser

| Pemeriksaan | Hasil | Batasan |
| --- | --- | --- |
| Login 390 px | Berhasil menuju dashboard | Akun uji Owner |
| Dashboard 390 px | Header, kartu, filter, navigasi bawah terbaca | Bukan seluruh tab/role |
| Pesanan dari navigasi bawah | Halaman dan kontrol tampil | Default hari ini kosong karena snapshot lama |
| Form tambah pesanan 360 px | Dialog, field, tombol batal/simpan tampil | Dibatalkan; tidak menguji penyimpanan melalui UI |
| Refresh halaman Pesanan | Sesi tetap masuk | Satu refresh pada sesi audit |
| Prospek 360 px | Halaman dan navigasi tampil | Default tanggal hari ini; bukan validasi jumlah historis |
| Drawer menu 360 px | Kelompok menu, submenu, profil tampil | Tidak menguji semua rute |
| Service worker | `sw.js` activated and running, scope `/` | Incognito tidak membuktikan pemasangan |
| Reload offline di Prospek | Shell dan sesi tetap tampil | Request API gagal; tidak ada dukungan transaksi offline yang terbukti |

Browser access host tidak tersedia sehingga audit memakai Chrome native.
Pada akhir pemeriksaan native UI kehilangan jendela (`noWindowsAvailable`).
Pemulihan online, logout melalui UI, dan route halaman backup belum berhasil
diverifikasi; jangan menghitungnya sebagai lulus. Akun uji dan seluruh sesinya
tetap sudah dibersihkan melalui administrator VPS.

## Temuan yang perlu dibereskan

### Prioritas sebelum rilis PWA

1. **Status offline belum jelas.** Pada reload offline Prospek, API gagal tetapi
   UI tetap menampilkan hitungan nol dan pesan tidak ada data. Tidak terlihat
   banner offline. Bedakan data kosong dari gagal memuat, tampilkan status
   koneksi/data terakhir, dan beri pemulihan saat koneksi kembali. Cache shell
   tidak berarti order dapat disimpan tanpa internet.
2. **Update dapat memuat ulang sesi kerja.** `vite.config.ts` memakai
   `registerType: 'autoUpdate'` dan `skipWaiting: true`. Implementasi terpasang
   `vite-plugin-pwa` memanggil `window.location.reload()` saat aktivasi update.
   Belum ada perlindungan form belum tersimpan di alur ini. Ini temuan tinjauan
   kode, bukan reproduksi kehilangan data. Perlu update yang dapat ditunda
   sampai staf menyelesaikan input, termasuk skenario beberapa tab.
3. **Uji perangkat fisik belum dilakukan.** Instalasi dan buka ulang dari home
   screen Android/iPhone, Safari, keyboard virtual, safe area, upload foto,
   izin lokasi teknisi, jaringan putus/pulih, dan pergantian versi perlu diuji.

### Penyempurnaan konfigurasi

- Manifest publik HTTP 200 dan terbaca Chrome, tetapi MIME masih
  `application/octet-stream`; sebaiknya `application/manifest+json`.
- Bahasa manifest masih `en`, sedangkan HTML/aplikasi berbahasa Indonesia.
- Manifest tidak mempunyai `id` eksplisit; Chrome memakai `start_url` sebagai
  identitas. Tetapkan identitas yang sama saat merapikan konfigurasi.
- Chrome memperingatkan kedua ikon memakai `purpose: 'any maskable'` dan
  screenshot instalasi belum tersedia. Ini peringatan tampilan instalasi,
  bukan bukti pemasangan gagal. Ukuran PNG 192 dan 512 sesuai deklarasinya.
- `index.html` belum mempunyai `apple-touch-icon` eksplisit.
- Navigation fallback service worker berlaku untuk semua navigasi dan belum
  mengecualikan halaman HTML publik `/backup/`. Risiko routing perlu diuji pada
  sesi yang dikontrol service worker; belum direproduksi sampai selesai.

HTTP langsung mengonfirmasi `/login/`, `/orders/`, manifest, service worker,
dan dua ikon tersedia. `sw.js` mempunyai `no-cache, no-store, must-revalidate`;
HTML dan manifest `no-cache`. Pemeriksaan ini tidak menggantikan tes update
dari versi lama ke versi baru.

Tidak ada kode aplikasi atau konfigurasi VPS diubah oleh audit ini. Keputusan
rilis tetap mengikuti `release-2026-11-07.md`, termasuk sinkronisasi terakhir,
uji WhatsApp nyata, backup berkelanjutan, dan jadwal perpindahan staf.
