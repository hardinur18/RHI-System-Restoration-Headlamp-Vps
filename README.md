
# RHI System App

> Repo ini adalah salinan khusus migrasi VPS. Status, batas isolasi, dan syarat
> perpindahan ada di [docs/vps-migration.md](docs/vps-migration.md).
> Workflow deploy Cloudflare/Supabase lama di bawah hanya berlaku di repo asal
> `hardinur18/app-polesheadlamp.id`; repo VPS tidak menjalankannya.

Repository ini berisi aplikasi operasional internal untuk Restoration Headlamp Indonesia (RHI System). Fokus utamanya adalah mengelola alur marketing, prospek, pesanan, teknisi lapangan, keuangan, inventaris, dan administrasi user dalam satu dashboard web.

## Cakupan utama

- Login dengan Supabase Auth
- Role-based access untuk `Owner`, `Super Admin`, `Admin PIC`, `CS`, `Advertiser`, `Teknisi`, dan `Finance`
- Dashboard multi-role
- Iklan harian dan monitoring performance marketing
- Affiliate dan formulir booking publik
- Prospek, follow up WhatsApp, dan konversi lead ke order
- Pesanan, assignment teknisi, peta/rute, dan upload dokumentasi kerja
- Monitoring lapangan, jadwal teknisi, pembayaran, kas, hutang/piutang, payroll, dan stock
- Master data, template WhatsApp, serta manajemen user dan permission

## Tech stack

- React 18
- Vite 6
- Tailwind CSS 4
- Supabase Auth, Postgres, Realtime, dan Storage
- Supabase Edge Functions dengan Hono
- Recharts, Leaflet, React Hook Form, Radix UI

## Cara menjalankan

1. Install dependency:

```bash
npm install
```

2. Jalankan development server:

```bash
npm run dev
```

3. Buka URL lokal dari Vite di browser.

## Konfigurasi Supabase

- Frontend membaca `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, dan `VITE_SUPABASE_ANON_KEY` dari `.env.local`.
- Fallback default tetap tersedia di `utils/supabase/info.tsx` supaya logic aplikasi tidak berubah.
- Edge Functions lokal membaca `supabase/functions/.env` sesuai pola resmi Supabase CLI.
- `SUPABASE_SERVICE_ROLE_KEY` dan `SUPABASE_DB_URL` hanya untuk server/local functions, jangan dipakai di browser.
- `Access Token` Supabase tidak dibutuhkan untuk runtime app; itu dipakai saat `supabase link`, deploy, atau secrets management via CLI.

## Integrasi Meta yang stabil

- Jalur default aplikasi sekarang adalah `frontend -> Edge Function -> Meta Graph API`.
- `VITE_META_ACCESS_TOKEN` di frontend dianggap `dev-only fallback`, bukan sumber token utama untuk operasional harian.
- Untuk penggunaan jangka panjang, simpan `META_ACCESS_TOKEN` di `supabase/functions/.env.local` saat lokal dan di server/secret manager saat deploy.
- Isi juga `META_APP_ID` dan `META_APP_SECRET` di backend agar server bisa mengirim `appsecret_proof` ke Graph API.
- UI sekarang menyimpan snapshot live Meta terakhir ke cache browser dan akan memakai snapshot itu kalau fetch terbaru gagal, sehingga kolom `Business Manager` tidak langsung hilang.
- Saat akun Meta dipilih di `Master Data > Akun Iklan`, metadata `Business Manager` ikut disimpan ke config akun agar tetap terbaca walau live fetch sedang bermasalah.
- Kalau ingin mengaktifkan fallback token langsung di frontend untuk debugging lokal, set `VITE_META_DIRECT_FALLBACK=true`. Jangan pakai mode ini sebagai arsitektur produksi.
- Backend sekarang punya endpoint `GET /make-server-f781cd00/meta/token-health` untuk mengecek validitas token server-side dan masa hidupnya.
- Untuk cek kesiapan `system user token` sekaligus mencoba generate token baru dari business/app yang aktif, jalankan `npm run meta:system-user-token`.
- Kalau token `system user` sudah berhasil dibuat dan ingin langsung dipasang ke backend lokal, jalankan `npm run meta:system-user-token -- --write-env`.
- Script itu akan berhenti sendiri bila business masih punya kurang dari dua `ADMIN` aktif atau masih ada admin yang statusnya pending.
- Untuk audit aset multi-akun Messenger/Instagram yang bisa diakses token saat ini, jalankan `npm run meta:messaging-assets`.
- Untuk meminta ulang scope DM ke akun yang punya role di app lewat Google Chrome aktif, jalankan `npm run meta:role-dm-token`.
- Kalau token hasil OAuth role-test ingin langsung dipasang ke backend lokal, jalankan `npm run meta:role-dm-token -- --write-env`.
- Untuk lane IG Login yang sudah berhasil, jalankan `npm run meta:ig-refresh -- --write-env` agar token IG long-lived diperbarui langsung di env lokal.
- Untuk mode otomatis berbasis masa aktif token, jalankan `npm run meta:ig-refresh:auto`. Script ini hanya refresh kalau sisa masa aktif token tinggal 21 hari atau kurang.
- Untuk refresh penuh sekaligus ke dua env lokal dan secret live Supabase, jalankan `npm run meta:ig-refresh:live`.
- Untuk automation server-side, jalankan `npm run meta:ig-refresh:server`. Script ini membaca state token terakhir dari Supabase KV, refresh bila perlu, lalu sync lagi ke secret live Supabase.
- Workflow GitHub Actions server-side ada di `.github/workflows/meta-ig-refresh.yml` dan dijadwalkan setiap hari pukul `03:17` WIB.
- Token IG tidak memakai model `system user permanent` seperti WA; jalur yang stabil adalah `long-lived token` sekitar 60 hari yang direfresh berkala.
- Secret GitHub minimum untuk workflow server-side:
  - `SUPABASE_URL`
  - `SUPABASE_PROJECT_REF`
  - `SUPABASE_ACCESS_TOKEN`
  - `SUPABASE_SERVICE_ROLE_KEY`
- LaunchAgent macOS `~/Library/LaunchAgents/com.polesheadlamp.meta-ig-refresh.plist` sekarang hanya fallback lokal, bukan jalur utama automation.
- Untuk memastikan app subscription webhook WhatsApp aktif ke endpoint Supabase, jalankan `npm run meta:wa-webhook-subscribe`.
- Endpoint backend untuk inbox multi-akun ada di prefix `GET|POST /make-server-f781cd00/meta/messaging/*`.
- Function utama `make-server-f781cd00` tetap dipakai untuk route internal yang lewat gateway auth Supabase.
- Webhook Meta harus memakai function publik terpisah di `GET|POST /functions/v1/meta-messaging-webhook`, bukan route internal di function utama.
- Isi `META_MESSAGING_VERIFY_TOKEN` di backend sebelum webhook diverifikasi di Meta Dashboard.
- Endpoint yang disiapkan untuk operasional inbox: `GET /meta/messaging/readiness`, `GET /meta/messaging/assets/live`, `POST /meta/messaging/assets/sync`, `GET /meta/messaging/channels`, `GET /meta/messaging/conversations`, `GET /meta/messaging/messages`, dan `POST /meta/messaging/send`.

## Integrasi Google Ads

- Jalur Google Ads mengikuti pola Meta: `frontend -> Edge Function -> Google Ads API`.
- Secret Google Ads sengaja hanya dibaca dari runtime Edge Function, bukan dari env Vite frontend.
- Endpoint backend yang sekarang disiapkan:
  - `GET /make-server-f781cd00/google/token-health`
  - `GET /make-server-f781cd00/google/live-breakdown`
  - `GET /make-server-f781cd00/google/integration-configs`
  - `POST /make-server-f781cd00/google/integration-configs/:adAccountId`
- `Unified Ads Monitoring` sekarang bisa merge live spend/click/impression/conversion dari Google Ads dengan lead internal selama nama akun internal cocok dengan nama customer/account Google Ads.
- Kalau live fetch Google Ads gagal, UI akan fallback ke snapshot cache terakhir atau data internal agar monitoring tidak langsung kosong.
- Env minimum yang harus tersedia di backend:
  - `GOOGLE_ADS_DEVELOPER_TOKEN`
  - `GOOGLE_ADS_CLIENT_ID`
  - `GOOGLE_ADS_CLIENT_SECRET`
  - `GOOGLE_ADS_REFRESH_TOKEN`
- Env opsional:
  - `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
  - `GOOGLE_ADS_CUSTOMER_IDS`
  - `GOOGLE_ADS_API_VERSION`
- Agar Google Ads tidak sering putus:
  - OAuth consent screen Google Cloud untuk OAuth client yang dipakai harus berstatus `In production`, bukan `Testing`. Google Ads mencatat `invalid_grant` berulang biasanya muncul karena app `Testing` memberi refresh token yang kedaluwarsa sekitar 7 hari.
  - OAuth project lokal saat ini terbaca dari `google-oauth-client.json`; project ID-nya `codex-sheets-access-492116`.
  - Gunakan satu Google account khusus yang punya akses ke MCC/manager Google Ads, lalu jangan revoke akses app tersebut dari halaman Google Account.
  - Jangan generate refresh token baru berulang kalau `GET /google/token-health` masih `ok`; Google membatasi jumlah refresh token per user/client dan token lama bisa otomatis mati saat limit terlewati.
  - Scheduler `Google Ads Snapshot Refresh` sengaja berjalan tiap 30 menit agar token tetap dipakai rutin dan tidak kedaluwarsa karena idle.
  - Kalau memang harus reconnect, gunakan `npm run ads:google-oauth-token -- --sync-supabase=true` agar secret Supabase langsung diganti tanpa menampilkan token mentah di log.
  - Referensi Google: `https://developers.google.com/google-ads/api/docs/get-started/common-errors` dan `https://developers.google.com/identity/protocols/oauth2#expiration`.
- Saat ini route Google Ads masih fokus ke monitoring live read-only. Optimizer / mutate action belum dihubungkan ke project ini.

## Deploy Supabase Functions

- Source function utama ada di `supabase/functions/server`, tetapi target deploy CLI yang cocok dengan endpoint live ada di wrapper `supabase/functions/make-server-f781cd00`.
- Deploy function utama ke project Polesheadlamp dengan:
  - `npx supabase functions deploy make-server-f781cd00 --project-ref dhnxwrteolnjdrxlmgwi`
- Deploy webhook Meta publik dengan:
  - `npx supabase functions deploy meta-messaging-webhook --project-ref dhnxwrteolnjdrxlmgwi --no-verify-jwt`
- Alasan webhook dipisah: gateway Supabase untuk function utama masih butuh header auth/anon key, sedangkan webhook dari Meta tidak membawa header itu.
- Sebelum deploy, siapkan `SUPABASE_ACCESS_TOKEN` untuk CLI serta secret runtime yang sesuai di project:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `META_APP_ID`
  - `META_APP_SECRET`
  - `META_ACCESS_TOKEN`
  - `META_DM_USER_TOKEN`
  - `META_IG_ACCESS_TOKEN`
  - `META_IG_USER_ID`
  - `META_IG_ACCOUNT_ID`
  - `META_IG_USERNAME`
  - `META_GRAPH_VERSION`
  - `META_MESSAGING_VERIFY_TOKEN`
  - `GOOGLE_ADS_DEVELOPER_TOKEN`
  - `GOOGLE_ADS_CLIENT_ID`
  - `GOOGLE_ADS_CLIENT_SECRET`
  - `GOOGLE_ADS_REFRESH_TOKEN`
  - `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
  - `GOOGLE_ADS_CUSTOMER_IDS`
  - `GOOGLE_ADS_API_VERSION`
- URL webhook yang dipasang di Meta Dashboard setelah deploy adalah:
  - `https://dhnxwrteolnjdrxlmgwi.supabase.co/functions/v1/meta-messaging-webhook`

## Git workflow

- `development` adalah branch integrasi/staging
- `main` adalah branch production
- branch fitur sebaiknya dibuat dari `development`
- pull request default sebaiknya menuju `development`
- perubahan dipromosikan ke `main` hanya setelah lolos validasi
- production sebaiknya dipromosikan ke `main` melalui pull request merge, bukan direct push

## Deploy otomatis ke Cloudflare Pages

- Repo ini sudah disiapkan untuk deploy otomatis ke project Cloudflare Pages `polesheadlamp-id`.
- Workflow GitHub Actions ada di `.github/workflows/pages-delivery.yml`.
- Production resmi project ini adalah `https://polesheadlamp-id.pages.dev`; custom domain lain tidak dianggap bagian dari deployment aplikasi ini.
- Tambahkan dua repository secrets di GitHub sebelum workflow dijalankan:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- Push ke branch selain `main` akan membuat preview deployment di Cloudflare Pages.
- Merge pull request ke `main` akan deploy production ke `https://polesheadlamp-id.pages.dev`.
- Pull request ke `development` atau `main` menjalankan build validation.
- Direct push ke `main` juga akan deploy production ke Cloudflare Pages.
- Workflow `Cloudflare Pages Delivery` juga bisa dijalankan manual via `workflow_dispatch` bila perlu redeploy.

## Deploy otomatis ke Supabase Edge Functions

- Workflow GitHub Actions ada di `.github/workflows/supabase-functions-delivery.yml`.
- Function production yang dideploy adalah `make-server-f781cd00` untuk project `dhnxwrteolnjdrxlmgwi`.
- Source utama function tetap berada di `supabase/functions/server`.
- Entrypoint deploy production disiapkan lewat wrapper `supabase/functions/make-server-f781cd00/index.ts` supaya nama function di Supabase sama dengan URL yang dipakai frontend.
- Pull request ke `development` atau `main` akan menjalankan validasi `deno check` untuk function tersebut.
- Merge pull request ke `main` akan deploy function production ke Supabase.
- Direct push ke `main` pada file function production juga akan memicu deploy Supabase.
- Tambahkan repository secret `SUPABASE_ACCESS_TOKEN` di GitHub sebelum workflow deploy dijalankan.
- QRIS live tetap membutuhkan konfigurasi Payment Gateway di aplikasi sudah lengkap, terutama secret key dan webhook token Xendit.

## Route yang tersedia

- `/` -> aplikasi internal
- `/booking?ref=<affiliateId>` -> formulir booking publik untuk affiliate/referral

## Arsitektur singkat

- Entry app ada di `src/main.tsx` dan `src/app/App.tsx`
- Auth gate ada di `src/app/AuthenticatedApp.tsx`
- Shared data dimuat lewat `src/app/pages/master-data/context/MasterDataCtx.tsx`
- Permission logic ada di `src/app/hooks/usePermissions.tsx`
- Shell layout dan navigasi internal ada di `src/app/components/layout/AppLayout.tsx`
- Source Edge Functions ada di `supabase/functions/server`
- Entrypoint deploy production ada di `supabase/functions/make-server-f781cd00/index.ts`
- Konfigurasi Supabase client ada di `src/lib/supabaseClient.ts`

## Catatan penting

- Navigasi internal utama masih memakai state `activeTab` di `AppLayout`, jadi belum semua halaman punya URL terpisah.
- `utils/supabase/info.tsx` menyimpan fallback default untuk `projectId` dan `publicAnonKey`, tetapi runtime sekarang bisa dioverride lewat env Vite.
- `package.json` saat ini hanya menyediakan script `dev` dan `build`; belum ada test runner otomatis.
- Folder `node_modules` tidak ada di repo, jadi dependency perlu di-install dulu sebelum develop/build.

## Dokumentasi lanjutan

Lihat `APP_OVERVIEW.md` untuk penjelasan modul, alur bisnis, arsitektur data, dan struktur folder yang lebih detail.
  
