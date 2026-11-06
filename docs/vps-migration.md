# Migrasi VPS Polesheadlamp

Status 6 November 2026: preview baca aktif di `https://rhi.polesheadlamp.id`.
Belum cutover input; produksi lama tetap menjadi sumber data aktif.

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
parameter dan checksum saat memakai snapshot baru. `verify-storage-api.py`
menerima direktori snapshot sebagai argumen. Jangan menjalankan restore awal
pada database yang sudah berisi data.

## Sinkronisasi perubahan

`deploy/plan-delta.py` membaca sumber dan staging dalam transaksi read-only
REPEATABLE READ. Perbandingan semua hash baris menangkap insert, update, dan
delete, termasuk tabel tanpa `updated_at`. Inventaris Storage berasal dari
snapshot yang sama. Angka di payload JSON dipertahankan sebagai teks PostgreSQL
agar angka berpresisi tinggi tidak dibulatkan oleh decoder float Python.
Sequence tidak mengikuti MVCC; rekonsiliasi akhirnya dilakukan saat penulis
berhenti. Perubahan schema atau tabel internal cloud yang mulai berisi data
menghentikan proses untuk ditinjau.

Sebelum `apply-delta.py` dijalankan, hentikan penulis **pada staging** dan salin
serta verifikasi file snapshot. Script menolak layanan penulis yang masih hidup,
cron aktif, atau baseline target yang berubah. Ia membuat arsip rollback,
mengunci tabel, menerapkan perubahan dalam satu transaksi, memeriksa seluruh
foreign key dan hash hasil akhir, lalu merekonsiliasi sequence. Gunakan
`--rollback-rehearsal` lebih dulu untuk menguji perubahan tanpa commit.
Jalankan kembali layanan staging setelah berhasil. Script tidak menghentikan
atau memindahkan penulis produksi secara otomatis.

## Email dan pengujian

`compose.mail-test.yml` menggunakan Mailpit di jaringan internal untuk menguji
reset password, sekali pakai token, undangan, login setelah penggantian password,
serta batas izin reset oleh admin. Jalankan `test-mail-and-reset.py` hanya dengan
override penampung email tersebut. Akun uji dan email ditangani oleh cleanup.
Hasil ini **tidak membuktikan pengiriman email ke penyedia eksternal**.

Pada 6 November 2026 pemilik menunda Resend dan memilih reset password melalui
admin. Jalur reset admin telah lulus UAT: pengguna tanpa login ditolak, pengguna
biasa ditolak, admin dapat mengganti password, password lama tidak berlaku, dan
login dengan password baru berhasil. Pengujian ini memakai akun disposable di
UAT; perubahan password pada preview publik tetap mengikuti pembatasan tulis.
Email lupa password dan undangan eksternal belum tersedia; jangan menjanjikan
pengiriman email sebelum penyedia diaktifkan. Penundaan ini bukan kegagalan
penyalinan data dan bukan alasan untuk mengaktifkan SMTP tanpa persetujuan baru.

Setelah aplikasi menerima input, admin dengan izin `users.reset_password` dapat
membuka pengelolaan pengguna, memilih menu **Aksi User → Reset Password**, lalu
mengisi password baru beserta konfirmasinya. Jangan mengubah password staf di
salinan preview sebagai pengganti reset pada sistem operasional yang masih aktif.

Jika layanan email dilanjutkan, API key dan verifikasi domain masih dibutuhkan.
Template konfigurasi tersedia pada `smtp.production.env.example`;
salinan berisi kredensial harus privat di `/opt/rhi/migration/`. Override
`compose.smtp.yml` hanya diaktifkan setelah konfigurasi penyedia diverifikasi,
dan tidak boleh digabung dengan override Mailpit. SMTP sungguhan belum aktif.

Uji Realtime tersedia pada `scripts/smoke-vps-realtime.mjs`: ia menunggu
kesiapan subscription PostgreSQL, memeriksa penerimaan INSERT melalui WebSocket,
lalu menghapus fixture. Pengujian CRUD prospek, kontrak logika inti, login tujuh
role, dan webhook tanpa signature telah dilakukan. Ini belum menggantikan UAT
seluruh operasi bisnis dan verifikasi integrasi eksternal.

`deploy/smoke-business-reads.py` menguji baca data bisnis dengan akun Owner
sementara dan memastikan akses anonim ditolak pada setiap endpoint yang diuji.
Cakupannya meliputi data master, order, prospek, jadwal, stok, keuangan dan
payroll. Respons bisnis dan kredensial tidak ditulis ke laporan. Akun uji
dihapus setelah selesai; ini belum menguji seluruh transaksi tulis bisnis.

`smoke-business-writes.py` menambah uji API transaksi pada staging terisolasi:
order dari pending sampai done, affiliate, jadwal teknisi, stok masuk/keluar
dan biaya rata-rata, serta tambah/ubah/void biaya operasional. Script menolak
cron aktif dan jaringan worker yang memiliki akses keluar. Fixture diberi
penanda unik, termasuk antrean konversi dan audit, lalu dibersihkan dan diperiksa.
Pengujian ini lulus 21 pemeriksaan; bukan pengganti seluruh UAT melalui UI.

## Backup operasional dan di luar VPS

`backup-database.sh` membuat arsip PostgreSQL aplikasi dan internal, role, serta
konfigurasi privat; ia memeriksa katalog arsip dan checksum sebelum mempromosikan
direktori sementara. Timer `rhi-database-backup.timer` berjalan harian pukul
03:30 Asia/Jakarta dengan jitter maksimal lima menit, menyimpan tujuh arsip
selesai terakhir. Konfigurasi SMTP juga disertakan jika sudah tersedia.
**Timer ini belum mencakup file Storage atau replikasi ke luar VPS.**

`rehearse-database-backup.py BACKUP_DIR NEW_DATABASE` memulihkan schema
aplikasi/Auth/Storage ke database pembanding baru yang tertutup bagi PUBLIC,
lalu membandingkan semua baris dengan staging yang tenang. Database lama tidak
ditimpa. Drift menghasilkan kegagalan dan laporan privat. Uji ini terbatas pada
pemulihan data logis, bukan pemulihan seluruh server dari nol.

`prepare-encrypted-backup.py DELTA_DIR DATABASE_BACKUP_DIR` memeriksa arsip,
kesamaan inventaris objek database/Storage dan checksum file. Ia membuat
repository Restic lokal terenkripsi, membaca ulang seluruh data repository,
dan mencoba restore arsip database serta objek Storage terbesar. Kunci
pemulihan harus disalin ke penyimpanan aman terpisah sebelum mengandalkan backup.
Repository lokal tersebut belum merupakan backup di luar VPS.

Google Drive dipilih sebagai tujuan salinan luar VPS. OAuth, privasi folder,
kuota tersedia, transfer penuh, restore dari Drive, jadwal, retensi sesuai kuota,
dan pemberitahuan kegagalan harus diverifikasi sebelum menyatakan backup
otomatis di luar VPS aktif. `root_folder_id` membatasi tujuan rclone, bukan
membatasi cakupan izin OAuth akun Google. Jangan mempublikasikan folder backup.

Format salinan yang dapat dibaca pemilik memakai tiga folder: `Data CSV`,
`Foto & Dokumen`, dan `Backup Pemulihan`. `prepare-readable-backup.py DELTA_DIR
DATABASE_BACKUP_DIR` membaca database hasil rehearsal yang sudah terverifikasi,
mengekspor tabel operasional menjadi CSV UTF-8 dalam bagian maksimal 20.000
baris, lalu memeriksa header dan jumlah baris setiap bagian. Teks yang dapat
menjadi formula dilindungi dengan apostrof. Kolom kredensial disamarkan, tabel
KV campuran dan status scheduler hanya masuk arsip pemulihan, dan sel sangat
panjang disimpan terpisah dengan rujukan dari CSV. CSV merupakan salinan untuk
dibaca, bukan pengganti arsip database lengkap.

File Storage ditempatkan berdasarkan bucket dan nama aslinya dengan indeks
pemetaan serta SHA256. Hardlink hanya digunakan pada snapshot lokal yang tidak
diubah; transfer ke Drive tetap menghasilkan file biasa. Arsip Restic di
`Backup Pemulihan` menyimpan database, role, konfigurasi dan metadata Storage,
tanpa menggandakan seluruh foto. Seluruh isi arsip ini dibaca ulang dan diuji
restore. Ketiga folder dan kunci Restic terpisah diperlukan untuk pemulihan.

`upload-readable-backup.py PACKAGE_DIR` membutuhkan OAuth yang sudah disetujui.
Scope yang diterima hanya `drive.file`, sehingga aplikasi hanya dapat mengakses
file yang dibuat atau dipilih untuk aplikasi tersebut. Jika folder tujuan lama
belum dapat diakses dengan scope ini, gunakan subfolder privat yang dibuat oleh
aplikasi lalu pindahkan melalui UI Drive ke folder pilihan pemilik. Uploader
memeriksa ID induknya sebelum mengirim data; memperluas scope ke seluruh Drive
bukan langkah fallback otomatis. Aplikasi OAuth dalam status Testing memiliki
batas masa berlaku token dan belum cukup untuk backup otomatis jangka panjang.
Skrip memeriksa privasi folder dan kuota, menyalin paket bertanggal tanpa
menimpa file berbeda, membaca ulang seluruh file dari Drive untuk pemeriksaan,
lalu menguji pemulihan database serta konfigurasi dari arsip remote. Menyiapkan
paket atau skrip tersebut belum membuktikan upload berhasil maupun mengaktifkan
backup otomatis di luar VPS.

## Penyimpanan privat

Repository ini publik. Kredensial, bundle produksi, backup, detail inventaris,
fixture akun dan hasil pemeriksaan rinci hanya disimpan dalam `.migration-local/`
(yang diabaikan Git) serta direktori privat `/opt/rhi/migration/` dan
`/opt/rhi/backups/` di VPS. Laporan lokal lengkap:
`.migration-local/migration-checkpoint-private.md`. Jangan commit file tersebut.

## Syarat cutover

Selama staf masih bekerja di sumber, RHI dapat dibuka sebagai preview baca.
Gunakan `nginx-preview.conf`, banner build `VITE_RHI_READ_ONLY=true`, serta
`enable-preview-fence.sql` pada **database VPS saja**. Trigger statement menolak
perubahan tabel bisnis dan objek Storage dari koneksi aplikasi, termasuk jalur
internal melalui Edge Function. Hanya administrator migrasi dapat menulis untuk
sinkronisasi snapshot berikutnya. Nginx juga mengembalikan pesan mode baca untuk
mutasi eksternal; login, refresh sesi, logout, dan penandatanganan URL tetap boleh.
Provider callback dan scheduler tetap di sumber, jaringan worker tetap staging.
Preview ini bukan cutover dan tidak menerima transaksi baru. Sebelum input
dipindahkan, sinkronkan sekali lagi lalu lepaskan fence dengan
`disable-preview-fence.sql`, ganti build/banner dan konfigurasi ingress.

1. Terapkan pilihan reset melalui admin selama SMTP ditunda. Jika email hendak
   diaktifkan, uji pengiriman sungguhan, reset/undangan, template dan redirect.
2. Selesaikan UAT alur bisnis serta verifikasi integrasi. Daftarkan OAuth callback
   target dan inventaris semua titik konfigurasi webhook/scheduler.
3. Siapkan backup terjadwal dan salinan Storage di luar VPS; uji pemulihannya.
4. Ulangi sinkronisasi insert/update/delete yang sudah dilatih untuk database,
   akun, file, serta konfigurasi dan secret yang berubah selama produksi aktif.
5. Sepakati jendela cutover dan penanganan webhook selama perpindahan. Hentikan
   penulis lama pada batas waktu terukur, ambil snapshot final, terapkan delta,
   verifikasi, lalu alihkan traffic dan aktifkan satu pemilik scheduler.

Snapshot staging bukan data final. Rollback setelah target menerima transaksi
baru memerlukan rekonsiliasi balik; mengganti DNS saja tidak mengembalikan data.
Domain RHI menerima akses preview baca. Traffic input, webhook produksi, dan
scheduler tetap pada sistem lama; scheduler VPS belum aktif.

Konfigurasi aktivasi disiapkan terpisah: `nginx-production.conf` membuka frontend
dan route API yang sama, sementara Studio dan database tetap privat.
`compose.production.yml` ditumpuk setelah `compose.staging.yml` untuk menambah
jaringan keluar worker dan menetapkan `RHI_DEPLOYMENT_MODE=production`.
Router tetap memeriksa JWT dan checksum bundle. Mode default tetap staging;
nilai mode yang tidak dikenal menghentikan startup. Pada runtime yang dipin,
permission jaringan kosong berarti akses jaringan penuh untuk worker produksi;
perilaku ini diuji dengan container terpisah tanpa kredensial. Perubahan mode
memerlukan restart worker agar pool lama tidak digunakan kembali.
Konfigurasi tersebut belum diaktifkan. Cron sengaja tetap mati dalam override
produksi sampai pemilik scheduler lama dihentikan dan perpindahan diverifikasi.

## Referensi

- [Restore Supabase ke self-hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
- [Storage dari Platform](https://supabase.com/docs/guides/self-hosting/copy-from-platform-s3)
- [Supabase Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/)

## UAT terpisah sebelum cutover

`prepare-uat.py` membuat database baru `rhi_uat_20261106`, salinan byte Storage
mandiri, JWT khusus uji, serta container Auth, REST, Storage, Functions, gateway,
Realtime dan Mailpit pada jaringan internal. Realtime memakai tenant dan slot
replikasi khusus database UAT; pengiriman perubahan PostgreSQL melalui WebSocket
telah diuji dengan `scripts/smoke-vps-realtime.mjs --uat` dan fixture dibersihkan.
Gateway dan Mailpit hanya tersedia melalui
listener loopback host; akses browser memakai SSH tunnel. Kredensial provider
pada worker diganti nilai uji. Tidak ada scheduler produksi atau pengiriman email
keluar. Jangan memakai hardlink untuk Storage UAT yang bisa ditulis.

`verify-uat.py` dijalankan sebelum transaksi uji. Pada 6 November 2026, seluruh
115 tabel dan seluruh byte Storage cocok terhadap snapshot RHI; kepemilikan dan
grant schema juga disalin agar role aplikasi dapat memakai hasil restore.
`VITE_RHI_UAT=true` menampilkan banner khusus lingkungan uji. Mode ini terpisah
dari `VITE_RHI_READ_ONLY=true` pada preview publik.

Pemeriksaan yang sudah lolos pada kandidat:

- 21 pemeriksaan transaksi: siklus pesanan, affiliate, jadwal teknisi, stok dan
  harga rata-rata, serta pembuatan/perubahan/pembatalan biaya.
- 22 pemeriksaan payroll, posting biaya yang tidak menggandakan transaksi,
  formulir prospek, routing CS, sumber booking, penolakan duplikat, serta upload,
  unduh bertanda tangan, akses anonim dan penghapusan file privat.
- 34 jalur pembacaan bisnis dan penolakan akses anonim.
- 3 alur email melalui Mailpit: reset, undangan, serta reset oleh admin dengan
  penolakan akses tanpa hak. Ini belum membuktikan pengiriman email eksternal.
- Browser: login, dashboard, daftar pesanan, formulir pesanan, validasi input
  wajib, halaman payroll, dan logout. Persistensi transaksi diuji lewat API.
- 11 pemeriksaan webhook sintetis (`deploy/test-uat-webhooks.py`): HMAC valid,
  signature hilang/diubah ditolak, timestamp kedaluwarsa ditolak, challenge Meta,
  persistensi event serta deduplikasi Kirimdev. Fixture event dihapus; ini belum
  membuktikan pengiriman webhook sungguhan dari penyedia.

Fixture diberi identitas khusus dan dibersihkan setelah tes. Laporan lengkap
berada di direktori privat UAT. Daftar tersebut adalah cakupan yang diuji,
bukan jaminan semua kemungkinan interaksi pengguna telah diuji.

### Menjalankan aplikasi lokal

Jalankan `npm run dev:uat` dari repo ini, kemudian buka `http://127.0.0.1:4173/`.
Frontend memakai kode lokal dengan hot reload; Auth, database dan Storage memakai
salinan UAT di VPS melalui SSH loopback `127.0.0.1:18080`. Ini membutuhkan akses
SSH RHI dan koneksi internet. Aplikasi ini bukan backend yang berjalan offline
di Mac. Port 5173 proyek lain tidak digunakan.

Launcher memeriksa penanda database UAT sebelum menjalankan Vite, menggunakan
anon key UAT saja, dan mempertahankan URL issuer Auth aslinya. Kunci service role
dan secret provider tidak dikirim ke frontend. Jika port dipakai lingkungan yang
tidak dikenal, launcher berhenti; ia tidak beralih ke Supabase produksi.
Masuk memakai akun pada snapshot migrasi. Fitur input menulis ke salinan UAT.
Hentikan dengan Ctrl+C; tunnel milik launcher ikut ditutup. Tunnel yang sebelumnya
sudah aktif tetap menjadi tanggung jawab proses pembuatnya.

### Verifikasi koneksi penyedia

`scripts/audit-provider-readiness.mjs` menerima path JSON privat secret runtime,
KV token, dan output melalui `--secrets`, `--kv`, serta `--output`. Output harus
di `.migration-local`. Script memeriksa akses baca Google Ads, Kirimdev,
Instagram, Meta Ads/Pages, dan TikTok tanpa mengirim pesan/conversion atau mengubah
webhook. Probe Meta menyertakan `appsecret_proof`, sama dengan aplikasi, agar hasil
tidak keliru akibat autentikasi probe yang tidak lengkap.

Pemeriksaan 6 November 2026: akses baca Instagram, Meta Ads dan Facebook Pages
berhasil. Google Ads membutuhkan otorisasi ulang (`invalid_grant`);
kedua subscription webhook Kirimdev lama nonaktif; TikTok menolak
akun dengan `User is blocked`. Status ini adalah kendala penyedia yang ditemukan
pada kredensial salinan, bukan bukti kehilangan data saat migrasi. Jangan
menyamakan akses baca yang lolos dengan pengiriman pesan, webhook, conversion,
dan scheduler yang sudah lulus end-to-end. Callback sumber tetap dipertahankan
sampai cutover terkoordinasi. SMTP tetap ditunda sesuai keputusan pemilik.

Probe tanpa query sensitif juga menemukan callback sumber lama
`/functions/v1/meta-messaging-webhook/kirimdev` merespons 404, sedangkan
`/functions/v1/kirimdev-messaging-webhook` merespons 200. Saat cutover, gunakan
endpoint Kirimdev khusus dan verifikasi signing secret; jangan menyalin rute lama
yang tidak tersedia. Penyebab kegagalan subscription kedua belum teridentifikasi
karena API daftar delivery mengembalikan kosong. Subscription sumber belum diubah.

Pemilik menegaskan Cekat sudah tidak digunakan. Cekat dikeluarkan dari integrasi
wajib dan audit default; data historis dan kode kompatibilitasnya dipertahankan.
`--include-cekat` hanya diperlukan bila layanan itu dipakai kembali.

`scripts/reconnect-google-ads.mjs --secrets PRIVATE.json --email EMAIL --output
.migration-local/google-ads-reconnected.json` menyiapkan callback loopback
53682 dengan state acak dan PKCE. URL otorisasi ditulis ke file privat berakhiran
`.authorization-url`; buka melalui browser pada akun pengelola Google Ads.
Refresh token disimpan mode600 tanpa dicetak atau otomatis dikirim ke produksi.
Verifikasi akses akun iklan sebelum memperbarui konfigurasi target. Script tidak
mengganti secret Supabase sumber. Alur mengikuti
[OAuth aplikasi lokal Google](https://developers.google.com/identity/protocols/oauth2/native-app).

### Perbaikan sumber booking

Fallback schema lama membuang hampir seluruh field tambahan ketika satu kolom
opsional tidak tersedia. Booking affiliate dapat tersimpan sebagai `manual`.
Sekarang fallback hanya melepas kolom yang secara eksplisit dilaporkan tidak
tersedia oleh PostgREST; identitas, sumber, affiliate, dan CS tidak boleh dibuang.
Error constraint/izin tidak dicoba ulang dengan payload yang kehilangan data.
`scripts/test-lead-schema-fallback.mjs` menguji kasus tersebut.

`patch-lead-bundle.py` menyiapkan kandidat dari bundle sumber yang hash-nya sudah
diverifikasi. Ini mempertahankan snapshot npm dan semua modul lainnya byte demi
byte, hanya mengganti fungsi tersebut serta menghapus source map yang menjadi
usang. Format dibatasi pada ESZIP2.3 tanpa checksum internal; router tetap
memeriksa SHA256 seluruh bundle. Validasi ulang memakai parser resmi
`@deno/eszip@0.106.0` dengan `scripts/verify-eszip-patch.mjs`, lalu jalankan UAT
pada runtime yang dipin. Jangan memakai patch jika hash sumber sudah berubah.
Bundle asli, kandidat, dependency parser dan laporan tetap privat.

`promote-uat-bundle.py` memeriksa bukti UAT dan fence sebelum mempromosikan bundle
ke **preview baca**. Script menyimpan bundle/manifest sebelumnya dan mengembalikan
keduanya jika pemeriksaan gagal. Promosi ini tidak mengaktifkan input, webhook,
cron, maupun mengganti konfigurasi aplikasi sumber. Setelah sinkronisasi terakhir,
periksa versi fungsi sumber lagi sebelum memakai kandidat saat cutover.

Uploader Drive memakai daftar rekursif yang dibatch dan memeriksa inventaris
nama/ukuran serta nama ganda sebelum membaca ulang isi file. Bukti selesai tetap
`report.json` yang baru ditulis setelah pemeriksaan seluruh file dan pemulihan
arsip berhasil; statistik unggah atau folder yang terlihat belum cukup.
