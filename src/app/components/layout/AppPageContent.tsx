import React from 'react';
import type { ReactNode } from 'react';
import type { DashboardViewMode } from '../../data/permissions';
import type { Role } from '../../pages/master-data/data';
import { PlaceholderPage } from '../../pages/PlaceholderPage';
import { getAppLayoutPlaceholderMeta } from './appLayoutWorkspaceMeta';

const Dashboard = React.lazy(() => import('../../pages/Dashboard'));

const Prospek = React.lazy(() =>
  import('../../pages/Prospek').then((module) => ({ default: module.Prospek })),
);

const EmbedLeadFormManagerPage = React.lazy(() =>
  import('../../pages/leads/EmbedLeadFormManagerPage').then((module) => ({ default: module.EmbedLeadFormManagerPage })),
);

const ProofAssetLibraryPage = React.lazy(() =>
  import('../../pages/proof-assets/ProofAssetLibraryPage').then((module) => ({ default: module.ProofAssetLibraryPage })),
);

const Pesanan = React.lazy(() =>
  import('../../pages/Pesanan').then((module) => ({ default: module.Pesanan })),
);

const Schedule = React.lazy(() => import('../../pages/Schedule'));

const Pemantauan = React.lazy(() =>
  import('../../pages/Pemantauan').then((module) => ({ default: module.Pemantauan })),
);

const Kas = React.lazy(() =>
  import('../../pages/Kas').then((module) => ({ default: module.Kas })),
);

const Laporan = React.lazy(() =>
  import('../../pages/Laporan').then((module) => ({ default: module.Laporan })),
);

const UserManagement = React.lazy(() => import('../../pages/users/UserManagementPage'));

const MasterDataPage = React.lazy(() =>
  import('../../pages/master-data/MasterDataPage').then((module) => ({ default: module.MasterDataPage })),
);

const ProfilePage = React.lazy(() =>
  import('../../pages/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);

const AffiliateList = React.lazy(() =>
  import('../../pages/affiliates/AffiliateList').then((module) => ({ default: module.AffiliateList })),
);

const MapPage = React.lazy(() =>
  import('../../pages/MapPage').then((module) => ({ default: module.MapPage })),
);

const DebtsPage = React.lazy(() =>
  import('../../pages/finance/DebtsPage').then((module) => ({ default: module.DebtsPage })),
);

const RoleManagement = React.lazy(() =>
  import('../../pages/settings/RoleManagement').then((module) => ({ default: module.RoleManagement })),
);

const UsageControlPage = React.lazy(() =>
  import('../../pages/settings/UsageControlPage').then((module) => ({ default: module.UsageControlPage })),
);

const TeknisiMobile = React.lazy(() =>
  import('../../pages/TeknisiMobile').then((module) => ({ default: module.TeknisiMobile })),
);

const MonitoringPage = React.lazy(() =>
  import('../../pages/MonitoringPage').then((module) => ({ default: module.MonitoringPage })),
);

const TechnicianSchedulePage = React.lazy(() => import('../../pages/technician/TechnicianSchedulePage'));

const RecurringExpensesTab = React.lazy(() =>
  import('../../pages/master-data/tabs/RecurringExpensesTab').then((module) => ({ default: module.RecurringExpensesTab })),
);

const AuditLogPage = React.lazy(() =>
  import('../../pages/AuditLogPage').then((module) => ({ default: module.AuditLogPage })),
);

const AdsMonitoringOverviewPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringOverviewPage').then((module) => ({ default: module.AdsMonitoringOverviewPage })),
);

const UnifiedAdsMonitoringPage = React.lazy(() =>
  import('../../pages/ads/UnifiedAdsMonitoringPage').then((module) => ({ default: module.UnifiedAdsMonitoringPage })),
);

const AdsMonitoringAdvertiserMatrixPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringAdvertiserMatrixPage').then((module) => ({ default: module.AdsMonitoringAdvertiserMatrixPage })),
);

const AdsMonitoringCsMatrixPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringCsMatrixPage').then((module) => ({ default: module.AdsMonitoringCsMatrixPage })),
);

const AdsMonitoringDiagnosticsPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringDiagnosticsPage').then((module) => ({ default: module.AdsMonitoringDiagnosticsPage })),
);

const AdsMonitoringOpenClawPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringOpenClawPage').then((module) => ({ default: module.AdsMonitoringOpenClawPage })),
);

const AdsMonitoringActionSandboxPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringActionSandboxPage').then((module) => ({ default: module.AdsMonitoringActionSandboxPage })),
);

const ConversationLiveInboxPage = React.lazy(() =>
  import('../../pages/conversations/ConversationLiveInboxPage').then((module) => ({ default: module.ConversationLiveInboxPage })),
);

const ConversationChannelSettingsPage = React.lazy(() =>
  import('../../pages/conversations/ConversationChannelSettingsPage').then((module) => ({ default: module.ConversationChannelSettingsPage })),
);

const WhatsAppChatsPage = React.lazy(() =>
  import('../../pages/whatsapp/WhatsAppChatsPage').then((module) => ({ default: module.WhatsAppChatsPage })),
);

const WhatsAppContactsPage = React.lazy(() =>
  import('../../pages/whatsapp/WhatsAppContactsPage').then((module) => ({ default: module.WhatsAppContactsPage })),
);

const WhatsAppTemplatesPage = React.lazy(() =>
  import('../../pages/whatsapp/WhatsAppTemplatesPage').then((module) => ({ default: module.WhatsAppTemplatesPage })),
);

const WhatsAppInboxSettingsPage = React.lazy(() =>
  import('../../pages/whatsapp/WhatsAppInboxSettingsPage').then((module) => ({ default: module.WhatsAppInboxSettingsPage })),
);

const PayrollPage = React.lazy(() =>
  import('../../pages/finance/PayrollPage').then((module) => ({ default: module.PayrollPage })),
);

const StockManagementPage = React.lazy(() =>
  import('../../pages/stock/StockManagementPage').then((module) => ({ default: module.StockManagementPage })),
);

const WATemplatesPage = React.lazy(() =>
  import('../../pages/WATemplatesPage').then((module) => ({ default: module.WATemplatesPage })),
);

const IklanHarianPage = React.lazy(() =>
  import('../../pages/IklanHarian').then((module) => ({ default: module.IklanHarian })),
);

const MarketingMonitoringPage = React.lazy(() =>
  import('../../pages/ads/MarketingMonitoringPage').then((module) => ({ default: module.MarketingMonitoringPage })),
);

const CsOkrReportPage = React.lazy(() =>
  import('../../pages/cs/CsOkrReportPage').then((module) => ({ default: module.CsOkrReportPage })),
);

type AppPageContentProps = {
  activeTab: string;
  currentRole: Role;
  resolvedDashboardViewMode?: DashboardViewMode;
  availableDashboardViewModes: DashboardViewMode[];
  setDashboardViewMode: (mode: DashboardViewMode) => void;
  handleNavigate: (tabId: string) => void;
  accessDenied: ReactNode;
};

// This component only selects pages. AppLayout performs access checks before mounting it.
export function AppPageContent({ activeTab, currentRole, resolvedDashboardViewMode,
  availableDashboardViewModes, setDashboardViewMode, handleNavigate, accessDenied,
}: AppPageContentProps) {
    switch (activeTab) {
      case 'dashboard':
        if (!resolvedDashboardViewMode) {
            return accessDenied;
        }
        return (
          <Dashboard
            viewMode={resolvedDashboardViewMode}
            availableViewModes={availableDashboardViewModes}
            onViewModeChange={setDashboardViewMode}
          />
        );
      case 'daily-ads':
        return <IklanHarianPage />;
      case 'ads-monitoring':
        return <MarketingMonitoringPage />;
      case 'ads-monitoring-workspace':
      case 'ads-monitoring-overview':
        return <AdsMonitoringOverviewPage />;
      case 'ads-realtime':
      case 'ads-monitoring-integrasi-iklan':
        return <UnifiedAdsMonitoringPage />;
      case 'ads-monitoring-advertiser-matrix':
        return <AdsMonitoringAdvertiserMatrixPage />;
      case 'ads-monitoring-cs-matrix':
        return <AdsMonitoringCsMatrixPage />;
      case 'ads-monitoring-diagnostics':
        return <AdsMonitoringDiagnosticsPage />;
      case 'ads-monitoring-openclaw':
        return <AdsMonitoringOpenClawPage />;
      case 'ads-monitoring-action-sandbox':
        return <AdsMonitoringActionSandboxPage />;
      case 'conversation-center':
      case 'conversation-live-inbox':
        return <ConversationLiveInboxPage />;
      case 'conversation-channel-settings':
        return <ConversationChannelSettingsPage />;
      case 'whatsapp':
      case 'whatsapp-chats':
        return <WhatsAppChatsPage />;
      case 'whatsapp-contacts':
        return <WhatsAppContactsPage />;
      case 'whatsapp-templates':
        return <WhatsAppTemplatesPage />;
      case 'whatsapp-inbox-settings':
        return <WhatsAppInboxSettingsPage />;
      default: {
        const placeholderMeta = getAppLayoutPlaceholderMeta(activeTab);

        return placeholderMeta ? (
          <PlaceholderPage
            title={placeholderMeta.title}
            description={placeholderMeta.description}
          />
        ) : (
          <PlaceholderPage
            title="Halaman Belum Tersedia"
            description="Route ini belum terhubung ke halaman aplikasi."
          />
        );
      }
      case 'affiliates':
        return <AffiliateList />;
      case 'leads': // Changed to leads to match sidebar
      case 'prospek':
        return <Prospek onNavigate={handleNavigate} />;
      case 'embed-forms':
        return <EmbedLeadFormManagerPage />;
      case 'proof-assets':
        return <ProofAssetLibraryPage />;
      case 'orders':
        return <Pesanan />;
      case 'daily-report':
        return <Laporan />;
      case 'cs-okr-report':
        return <CsOkrReportPage />;
      case 'schedule':
        return <Schedule />;
      case 'teknisi-mobile':
        return <TeknisiMobile />;
      case 'monitoring-activity':
        return <MonitoringPage />;
      case 'monitoring':
        return <Pemantauan />;
      case 'map':
        return <MapPage />;
      case 'recurring-expenses':
        return <div className="recurringExpensesRouteFrame"><RecurringExpensesTab currentRole={currentRole} /></div>;
      case 'cashflow':
        return <Kas />;
      case 'debts':
        return <DebtsPage />;
      case 'finance-report':
        return <Laporan mode="finance" />;
      case 'payroll':
        return <PayrollPage />;
      case 'inventory':
      case 'inventory-products':
        return <StockManagementPage key={activeTab} defaultTab="products" />;
      case 'inventory-transactions':
        return <StockManagementPage key={activeTab} defaultTab="transactions" />;
      case 'inventory-valuation':
        return <StockManagementPage key={activeTab} defaultTab="valuation" />;
      case 'inventory-settings':
        return <StockManagementPage key={activeTab} defaultTab="settings" />;
      case 'master-data':
        return (
          <MasterDataPage currentRole={currentRole} />
        );
      case 'users':
        return <UserManagement />;
      case 'technician-schedule':
        return <TechnicianSchedulePage />;
      case 'profile':
        return <ProfilePage />;
      case 'wa-templates':
        return <WATemplatesPage />;
      case 'audit-logs':
        return <AuditLogPage onBack={() => handleNavigate('dashboard')} />;
      case 'roles':
        return <RoleManagement />;
      case 'usage-control':
        return <UsageControlPage />;
    }
}
