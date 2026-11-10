import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { pwaUpdates } from '../../services/pwaUpdateService';
import './pwa-status.css';

export function PwaStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [reconnected, setReconnected] = useState(false);
  const update = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot);
  const cover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (online) return;
    const focused = document.activeElement;
    const previous = new Map<HTMLElement, boolean>();
    const block = () => {
      const targets = [document.querySelector('.rhiPreviewContent'),
        ...Array.from(document.body.children).filter(element => element.id !== 'root' && !element.classList.contains('rhiOfflineCover'))];
      for (const element of targets) {
        if (element instanceof HTMLElement && !previous.has(element)) {
          previous.set(element, element.inert);
          element.inert = true;
        }
      }
    };
    block();
    cover.current?.focus();
    const observer = new MutationObserver(block);
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      previous.forEach((inert, element) => { element.inert = inert; });
      if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
    };
  }, [online]);

  useEffect(() => {
    const offline = () => setOnline(false);
    const connected = () => { setOnline(true); setReconnected(true); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', connected);
    // Catch a transition between the initial render and listener registration.
    setOnline(navigator.onLine);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', connected); };
  }, []);

  const refresh = () => {
    if (window.confirm('Pastikan perubahan sudah disimpan. Muat ulang aplikasi sekarang?')) window.location.reload();
  };
  return (
    <>
      {!online && createPortal(
        <div className="rhiOfflineCover" role="alert" aria-live="assertive" ref={cover} tabIndex={-1}>
          <section>
            <h1>Koneksi internet terputus</h1>
            <p>Data terbaru belum dapat dimuat. Tampilan data ditutup sementara agar data yang gagal dimuat tidak terbaca sebagai kosong.</p>
            <p>Isian yang belum disimpan tetap ada di halaman ini. Sambungkan internet untuk melanjutkan; jangan tutup aplikasi.</p>
          </section>
        </div>, document.body
      )}
      {online && (update.available || reconnected) && (
        <aside className="rhiPwaNotice" aria-label="Status aplikasi" role="status">
          <div>
            <strong>{update.available ? 'Versi baru tersedia' : 'Koneksi internet kembali'}</strong>
            <p>{update.available ? 'Selesaikan dan simpan isian sebelum memperbarui. Kamu bisa tetap bekerja.' : 'Periksa data kembali. Selesaikan dan simpan isian sebelum memuat ulang.'}</p>
            {update.error && <p role="alert">{update.error}</p>}
          </div>
          <div className="rhiPwaActions">
            <button type="button" disabled={update.applying} onClick={() => {
              if (update.available) {
                if (window.confirm('Pastikan perubahan di tab ini sudah disimpan. Perbarui dan muat ulang sekarang?')) void pwaUpdates.apply();
              } else refresh();
            }}>{update.applying ? 'Memperbarui…' : update.available ? 'Perbarui sekarang' : 'Muat ulang'}</button>
            {!update.available && <button type="button" onClick={() => setReconnected(false)}>Lanjutkan isian</button>}
          </div>
        </aside>
      )}
    </>
  );
}
