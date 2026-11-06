import { Component, type ReactNode } from 'react';
import { Button } from '../ui/button';

// Keep navigation available when a lazy chunk or a page fails. A route change
// remounts this boundary; reload retries failed chunks without clearing login.
export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="emptyState" role="alert">
        <div className="emptyStateCard">
          <h1>Halaman belum bisa ditampilkan</h1>
          <p>Coba muat ulang halaman. Kamu juga bisa membuka menu lain dari navigasi.</p>
          <Button onClick={() => window.location.reload()}>Muat ulang halaman</Button>
        </div>
      </section>
    );
  }
}
