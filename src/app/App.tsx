import React from 'react';
import { ThemeProvider, useTheme } from "next-themes";
import { RouterProvider } from 'react-router';
import appLogo from '@/assets/polesheadlamp-app-logo-round.png';
import { router } from './routes';
import { PwaStatus } from './components/pwa/PwaStatus';
import { isSupabaseConfigured, supabaseConfigErrorMessage } from '/utils/supabase/info';

const useLocalAuth = import.meta.env.VITE_AUTH_MODE === 'local';
const readOnlyPreview = import.meta.env.VITE_RHI_READ_ONLY === 'true';
const isolatedTest = import.meta.env.VITE_RHI_UAT === 'true';

function ThemeClassBridge() {
  const { resolvedTheme, theme } = useTheme();

  React.useEffect(() => {
    const activeTheme = (theme === "system" ? resolvedTheme : theme) ?? "light";
    const isDark = activeTheme === "dark";
    const root = document.documentElement;
    const body = document.body;

    root.classList.toggle("dark", isDark);
    root.dataset.theme = activeTheme;
    root.style.colorScheme = isDark ? "dark" : "light";

    body.classList.toggle("dark", isDark);
    body.dataset.theme = activeTheme;
    body.style.colorScheme = isDark ? "dark" : "light";
  }, [resolvedTheme, theme]);

  return null;
}

export default function App() {
  const content = isSupabaseConfigured || useLocalAuth ? <RouterProvider router={router} /> : <SupabaseConfigMissing />;
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="rhi-system-theme"
    >
      <ThemeClassBridge />
        <div className="rhiPreview">
          <PwaStatus />
          {(readOnlyPreview || isolatedTest) && (
          <aside className="rhiPreviewNotice" aria-label="Lingkungan aplikasi">
            <strong>{isolatedTest ? 'Lingkungan uji' : 'Mode baca'}</strong>
            <span>{isolatedTest ? 'Salinan data uji. Perubahan di sini tidak mengubah data operasional.' : `Salinan data ${import.meta.env.VITE_RHI_SNAPSHOT_LABEL || 'migrasi'}. Input di aplikasi operasional.`}</span>
            <a href="https://rhi.polesheadlamp.id/" target="_blank" rel="noopener noreferrer">Buka aplikasi operasional ↗</a>
          </aside>
          )}
          <div className="rhiPreviewContent">{content}</div>
        </div>
    </ThemeProvider>
  );
}

function SupabaseConfigMissing() {
  return (
    <main className="loginShell">
      <section className="loginCard">
        <span className="loginMark brandLogo">
          <img src={appLogo} alt="Poles Headlamp.ID" />
        </span>
        <p className="loginEyebrow">Konfigurasi V2 Belum Lengkap</p>
        <h1>Supabase env belum terbaca</h1>
        <p className="loginHint">{supabaseConfigErrorMessage}</p>
        <div className="codeBlock">
          VITE_SUPABASE_URL=...
          <br />
          VITE_SUPABASE_ANON_KEY=...
        </div>
      </section>
    </main>
  );
}
