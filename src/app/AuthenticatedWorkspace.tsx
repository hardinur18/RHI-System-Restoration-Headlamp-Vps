import type { Session } from '@supabase/supabase-js';
import { MasterDataProvider } from './pages/master-data/context';
import { PermissionsProvider } from './hooks/usePermissions';
import { AppLayout } from './components/layout/AppLayout';

// Keep providers mounted across menu changes. A different signed-in user gets
// a new workspace (keyed by AuthenticatedApp), including fresh in-memory data.
export default function AuthenticatedWorkspace({ session, activePath }: {
  session: Session;
  activePath: string;
}) {
  return (
    <MasterDataProvider session={session} activePath={activePath}>
      <PermissionsProvider>
        <AppLayout />
      </PermissionsProvider>
    </MasterDataProvider>
  );
}
