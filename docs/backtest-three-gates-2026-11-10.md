# Backtest tiga tahap perpindahan — 10 November 2026

Permintaan: uji WhatsApp, web HP/PWA, dan perpindahan terakhir tanpa mengganggu
staf di aplikasi lama. Hasil di bawah membedakan simulasi dari operasi nyata.

## WhatsApp dan prospek

Pengulangan awal kembali menghasilkan `KV getByPrefix timeout` pada pembacaan
pesan pertama. Sepuluh pemeriksaan sebelumnya berhasil, termasuk penerimaan
webhook bertanda tangan, pemetaan CS, pembuatan prospek dan deduplikasi. Semua
fixture dibersihkan, bundle/gateway UAT dikembalikan. Karena terulang, kegagalan
ini tidak lagi dianggap kejadian sesaat yang boleh diabaikan.

Mitigasi konfigurasi kandidat: `KV_READ_TIMEOUT_MS=8000`, dari default 2500 ms.
Tidak ada error yang disembunyikan dan tidak ada retry pengiriman sungguhan.
Ini memberi batas waktu baca lebih longgar, bukan pembuktian akar penyebab atau
perbaikan performa query. Pengukuran REST langsung untuk prefix channel,
conversation dan contact berkisar 0,052–0,172 detik; akar perlambatan intermiten
di worker belum dipastikan. Kegagalan berikutnya dapat menunggu sampai 8 detik.

Dengan konfigurasi kandidat, **tiga worker baru berturut-turut lulus 24 pemeriksaan
masing-masing**. Cakupan: Meta/Kirimdev inbound, prospek Pending, pemetaan CS,
penolakan pengirim anonim, balasan ke provider palsu, idempotensi, dan kegagalan
provider yang tidak dicatat sebagai berhasil. Enam pembacaan pesan berkisar
0,065–0,438 detik. Tes order/stok/expense (21) serta payroll/form/Storage (22)
juga lulus. Total 115 assertion berhasil, termasuk pengulangan 24 skenario;
ini bukan 115 fitur berbeda. Selesai 16:09 WIB.

Semua pengiriman keluar menuju provider palsu di jaringan internal UAT.
**Belum membuktikan pesan diterima nomor WhatsApp nyata**, status delivery Meta/
Kirimdev, maupun callback baru setelah perpindahan. Timeout 8 detik ditambahkan
ke paket produksi kandidat; konfigurasi preview publik tetap tidak berubah.

Bukti privat: `/opt/rhi/uat-20261106/scope-rehearsal-20261110T090914Z`, termasuk
`messaging-run-1.json` sampai `messaging-run-3.json`. Fixture tersisa: nol.

## Web HP/PWA

Chrome native, incognito, viewport **360 × 740**, menggunakan komponen `PwaStatus`
produksi yang dibundel ulang ke harness lokal. Harness tidak mengakses database;
status offline dan aktivasi update disimulasikan. Browser control memakai CUA.

- Penutup offline terlihat dan konten/form di belakangnya hilang dari pohon
  aksesibilitas. Teks dan instruksi terbaca pada lebar 360 px.
- Setelah kembali online, input `Draft backtest RHI tetap ada` tetap utuh.
- Memilih Lanjutkan isian menutup pemberitahuan koneksi tanpa reload.
- Pemberitahuan versi baru tidak memuat ulang draft.
- Perbarui sekarang menampilkan konfirmasi. Cancel mempertahankan draft.
- Setelah konfirmasi OK, halaman benar-benar reload; input kembali ke nilai awal
  harness. Draft ini sengaja disposable, dan tidak diklaim tersimpan permanen.
- Controller tests juga lulus: aktivasi oleh tab lain tanpa reload, consent per
  tab, timeout, kegagalan aktivasi, aktivasi terlambat dan stale chunk.

Server harness dihentikan setelah uji. Ini **bukan** uji Safari/iPhone/Android
fisik, pemasangan home-screen, keyboard virtual, kamera/lokasi, ataupun rollout
dua service worker nyata. Login/navigasi/form aplikasi penuh masih mengacu pada
audit mobile sebelumnya; tidak dihitung ulang sebagai hasil harness ini.

## Simulasi perpindahan dan rollback

Arsip target sebelum delta **6 November 19:33 WIB** diverifikasi SHA-256, lalu
dipulihkan ke database baru privat tanpa cron dan tanpa layanan aplikasi.
Program `apply-delta.py` yang sama menjalankan delta historis dengan mode
`--rollback-rehearsal --isolated-rehearsal-database`.

- Seluruh byte Storage yang dirujuk snapshot diperiksa melalui receipt SHA-256;
  file yang sedang digunakan tidak ditulis atau ditimpa.
- Skema, primary key dan hash baseline target cocok sebelum mutasi.
- Insert/update/delete dijalankan di transaksi terisolasi; semua foreign key
  divalidasi dan hash hasil **111 tabel** cocok dengan snapshot sumber historis.
- Transaksi di-rollback; hash seluruh 111 tabel kembali cocok dengan baseline.
- Database disposable dihapus setelah pemeriksaan nol koneksi; bukti tes disimpan.
- Percobaan pertama tertahan pengaman karena runner masih memegang koneksinya
  sendiri. Penutupan koneksi diperbaiki; database percobaan itu juga dibersihkan.
  Pengaman tidak dilemahkan untuk melewatkan koneksi layanan lain.

Selesai 16:09 WIB. Bukti privat:
`/opt/rhi/migration/rehearsals/rhi_delta_rehearsal_20261110090636/result.json`.
Pemeriksaan berikutnya: tujuh layanan publik sehat, write fence tetap aktif,
cron nol/off, worker tetap staging terisolasi, backup Drive otomatis tetap aktif.

Ini membuktikan replay dan rollback **delta historis**, bukan kesamaan data hari
perpindahan. Final delta, file baru, penghentian seluruh writer, pengalihan webhook,
dan satu pemilik scheduler masih harus dijalankan pada jendela cutover yang disepakati.
