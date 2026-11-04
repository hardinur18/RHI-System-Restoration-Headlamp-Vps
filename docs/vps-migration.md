# Migrasi VPS Polesheadlamp

Status: staging privat; belum cutover. Produksi tetap menjadi sumber data aktif.

## Batas perubahan

Repo ini terpisah dari repo produksi `hardinur18/app-polesheadlamp.id`.
Workflow deployment dan scheduler warisan dibatasi ke repo produksi agar push
ke repo migrasi tidak mengubah layanan yang sedang berjalan. Baseline aplikasi
mengikuti commit produksi; business logic dipertahankan.

Frontend menggunakan konfigurasi Supabase/Functions target untuk tautan peta,
dan origin aplikasi yang sedang dibuka untuk undangan pengguna. Konfigurasi
Nginx menjaga redirect SPA, cache aset/PWA, serta header aplikasi.

## Staging

Supabase self-hosted dipin ke `self-hosted/v0.8.3`, commit
`bc27d2661edd09a5d0b8d76ce33da6d4071a756e`. Database memakai Postgres 17.
API terikat loopback, Studio tidak dipublikasikan, dan Nginx membatasi akses uji.
Edge workers menggunakan bundle produksi dengan checksum dan pengaturan JWT
per fungsi. Jaringan internal dan permission runtime membatasi akses keluar.
Cron dinonaktifkan secara global; job hasil migrasi juga tetap nonaktif.

`deploy/bootstrap-vps.sh` dan `prepare-staging.sh` memeriksa identitas VPS.
Prepare memerlukan `runtime.env` privat dan menolak menimpa instalasi lama.

## Backup, restore, dan verifikasi

- `export-source.py`: snapshot read-only, inventaris tabel/Storage dan arsip penuh.
- `backup-storage.py`: salin objek berdasarkan snapshot; verifikasi ukuran,
  ETag dan SHA256; dapat dilanjutkan tanpa mengunduh ulang file terverifikasi.
- `restore-reference.py`: restore schema/data sumber ke database pembanding.
- `restore-database.py`: restore sekali ke database staging kosong; pertahankan
  schema/ledger internal versi layanan target. Perbedaan tabel internal kosong
  dicatat, sedangkan tabel sumber berisi data yang tidak kompatibel menghentikan restore.
- `restore-storage.py`: pemulihan file, version dan metadata mengikuti layout
  filesystem yang sudah diuji memakai objek sementara.
- `verify-database.py` dan `verify-schema.py`: bandingkan hash seluruh baris,
  schema, RLS, privilege efektif, publication dan sequence.
- `rewrite-storage-urls.py`: transformasi prefix URL aset di target dengan
  menjaga data lain; riwayat pesan tidak ditulis ulang.
- `verify-storage-api.py`: baca seluruh isi objek melalui HTTPS dan bandingkan SHA256.
- `smoke-staging.py`: uji login/API/CORS memakai akun sementara, beserta cleanup.
  `scripts/smoke-vps-browser.mjs` menguji browser melalui SSH SOCKS port 19080.

Default grant dari template self-hosted harus dibersihkan sebelum restore ACL
sumber, supaya target tidak mewarisi izin anonim yang lebih luas. Laporan
perbandingan privilege wajib lulus sebelum membuka akses.

Sejumlah verifier sengaja mengacu pada snapshot rehearsal tetap. Review ulang
parameter dan checksum saat memakai snapshot baru. Jangan menjalankan restore
awal pada database yang sudah berisi data; siapkan prosedur delta terpisah.

## Penyimpanan privat

Repository ini publik. Kredensial, bundle produksi, backup, detail inventaris,
fixture akun dan hasil pemeriksaan rinci hanya disimpan dalam `.migration-local/`
(yang diabaikan Git) serta direktori privat `/opt/rhi/migration/` dan
`/opt/rhi/backups/` di VPS. Laporan lokal lengkap:
`.migration-local/migration-checkpoint-private.md`. Jangan commit file tersebut.

## Syarat cutover

1. Uji SMTP, reset password/undangan, template dan redirect.
2. Selesaikan UAT alur bisnis serta verifikasi integrasi. Daftarkan OAuth callback
   target dan inventaris semua titik konfigurasi webhook/scheduler.
3. Siapkan backup terjadwal dan salinan Storage di luar VPS; uji pemulihannya.
4. Latih sinkronisasi insert/update/delete untuk database, akun, file, serta
   konfigurasi dan secret yang berubah selama produksi masih aktif.
5. Sepakati jendela cutover dan penanganan webhook selama perpindahan. Hentikan
   penulis lama pada batas waktu terukur, ambil snapshot final, terapkan delta,
   verifikasi, lalu alihkan traffic dan aktifkan satu pemilik scheduler.

Snapshot staging bukan data final. Rollback setelah target menerima transaksi
baru memerlukan rekonsiliasi balik; mengganti DNS saja tidak mengembalikan data.
Belum ada pengalihan traffic, webhook produksi, atau scheduler aktif.

## Referensi

- [Restore Supabase ke self-hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
- [Storage dari Platform](https://supabase.com/docs/guides/self-hosting/copy-from-platform-s3)
- [Supabase Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
