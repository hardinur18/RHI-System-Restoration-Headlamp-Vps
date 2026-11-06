import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMasterData } from '@/app/pages/master-data/context';
import { supabase } from '@/lib/supabaseClient';
import { Sidebar } from '../Sidebar';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { toast } from 'sonner';
import { Toaster } from '../ui/sonner';
import { Menu, Sun, Moon, LogOut, User, RefreshCcw } from 'lucide-react';
import { useTheme } from "next-themes"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../ui/sheet";
import { NotificationBell } from '../ui/NotificationBell';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"

import { AppPageContent } from './AppPageContent';
import { PageLoadingState } from './PageLoadingState';
import { PageErrorBoundary } from './PageErrorBoundary';
import { hasRequiredPermission, hasTabAccess, getRoleFallbackCandidates } from './appLayoutAccess';

// Page Components
import { usePermissions } from '@/app/hooks/usePermissions';
import { DashboardViewMode, DASHBOARD_VIEW_PERMISSION_MAP, DEFAULT_DASHBOARD_VIEW_BY_ROLE } from '../../data/permissions';
import {
  isTechnicianRole,
} from '@/app/data/roleHelpers';
import { Lock } from 'lucide-react';
import { BottomNav } from '../BottomNav';
import { AppLoadingScreen } from '../AppLoadingScreen';
import {
  ACCESS_DENIED_FALLBACK_TAB,
  APP_LAYOUT_ACCESS_FALLBACKS,
  DEFAULT_APP_LAYOUT_TAB,
  TEKNISI_ALLOWED_TABS,
} from './appLayoutTabRegistry';
import { APP_LAYOUT_TAB_PERMISSIONS } from './appLayoutTabPermissions';
import { getAppLayoutPageTitle } from './appLayoutPageTitles';
import {
  getAppRouteByPath,
  getAppRouteByTabId,
  getCanonicalAppPath,
} from '@/app/routing/appRouteRegistry';

// --- COMPONENTS ---

export function ModeToggle() {
  const { resolvedTheme, theme, setTheme } = useTheme()
  const activeTheme = (theme === "system" ? resolvedTheme : theme) ?? "light"
  const isDark = activeTheme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="appTopbarButton appTopbarSecondaryAction"
      title={isDark ? "Ubah ke mode terang" : "Ubah ke mode gelap"}
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}

export function AppLayout() {
  const context = useMasterData();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const currentRoute = React.useMemo(
    () => getAppRouteByPath(location.pathname),
    [location.pathname],
  );
  const routeTabId = React.useMemo(
    () => currentRoute?.tabId,
    [currentRoute],
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Default closed on mobile
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [fallbackActiveTab, setFallbackActiveTab] = useState(routeTabId ?? DEFAULT_APP_LAYOUT_TAB);
  const activeTab = routeTabId ?? fallbackActiveTab;
  const [dashboardViewMode, setDashboardViewMode] = useState<DashboardViewMode | undefined>(undefined);
  const currentRole = context?.currentRole;
  const currentUser = context?.currentUser;
  const isCurrentUserResolved = context?.isCurrentUserResolved ?? false;
  const currentUserIssue = context?.currentUserIssue;
  const triggerRefresh = context?.triggerRefresh ?? (() => {});
  const isRefreshingData = Boolean(
    context?.isMasterDataLoading ||
    context?.isOperationalDataLoading ||
    context?.isOrdersLoading ||
    context?.isLeadsLoading,
  );
  const handleGlobalRefresh = React.useCallback(() => {
    if (isRefreshingData) {
      toast.info('Data masih dimuat...');
      return;
    }

    triggerRefresh();
  }, [isRefreshingData, triggerRefresh]);
  const isTechnicianAppMode = isTechnicianRole(currentRole);
  const dashboardViewModes = React.useMemo(
    () => Object.keys(DASHBOARD_VIEW_PERMISSION_MAP) as DashboardViewMode[],
    [],
  );
  const isRecoverableCurrentUserIssue =
    currentUserIssue?.code === 'profile_timeout' ||
    currentUserIssue?.code === 'profile_query_error';
  const hasInvalidRoleSession = isCurrentUserResolved && !currentUser;
  const currentUserIssueTitle = (() => {
    switch (currentUserIssue?.code) {
      case 'profile_not_found':
        return 'Profil App V2 Belum Ada';
      case 'profile_inactive':
        return 'Akun Dinonaktifkan';
      case 'invalid_role':
        return 'Role Belum Didukung';
      case 'profile_query_error':
        return 'Profil Tidak Bisa Dibaca';
      case 'profile_timeout':
        return 'Koneksi Profil Timeout';
      default:
        return 'Profil Login Belum Valid';
    }
  })();
  const currentUserIssueHint =
    currentUserIssue?.message ||
    'Sesi browser masih aktif, tetapi profil pengguna belum siap dipakai di app v2.';

  React.useEffect(() => {
    const root = document.documentElement;
    const workspaceLayerLeft = isTechnicianAppMode ? '0px' : isSidebarCollapsed ? '88px' : '304px';

    root.style.setProperty('--workspace-layer-left', workspaceLayerLeft);

    return () => {
      root.style.removeProperty('--workspace-layer-left');
    };
  }, [isSidebarCollapsed, isTechnicianAppMode]);

  const preferredDashboardView = currentRole ? DEFAULT_DASHBOARD_VIEW_BY_ROLE[currentRole] : undefined;
  const preferredDashboardPermission = preferredDashboardView
    ? DASHBOARD_VIEW_PERMISSION_MAP[preferredDashboardView]
    : undefined;
  const availableDashboardViewModes = React.useMemo(
    () => dashboardViewModes.filter(mode => hasPermission(DASHBOARD_VIEW_PERMISSION_MAP[mode])),
    [dashboardViewModes, hasPermission],
  );
  const resolvedDashboardViewMode = React.useMemo(() => {
      if (!hasPermission('dashboard.view')) {
          return undefined;
      }

      if (dashboardViewMode && hasPermission(DASHBOARD_VIEW_PERMISSION_MAP[dashboardViewMode])) {
          return dashboardViewMode;
      }

      if (preferredDashboardPermission && hasPermission(preferredDashboardPermission)) {
          return preferredDashboardView;
      }

      return availableDashboardViewModes[0];
  }, [availableDashboardViewModes, dashboardViewMode, hasPermission, preferredDashboardPermission, preferredDashboardView]);

  React.useEffect(() => {
      if (!currentRoute) {
          return;
      }

      const canonicalPath = getCanonicalAppPath(currentRoute);
      if (canonicalPath !== location.pathname) {
          navigate(canonicalPath, { replace: true });
          return;
      }

      if (currentRoute.tabId) {
          setFallbackActiveTab(currentRoute.tabId);
      }
  }, [currentRoute, location.pathname, navigate]);

  const handleNavigate = React.useCallback((tabId: string) => {
      const route = getAppRouteByTabId(tabId);
      const nextPath = route ? getCanonicalAppPath(route) : null;
      const isSameRoute = nextPath === location.pathname && tabId === activeTab;

      if (isSameRoute) {
          return;
      }

      if (!route || !nextPath) {
          setFallbackActiveTab(tabId);
          return;
      }

      if (nextPath !== location.pathname) {
          navigate(nextPath);
          window.setTimeout(() => {
              const targetPath = new URL(nextPath, window.location.origin).pathname;
              if (window.location.pathname !== targetPath) {
                  window.location.assign(nextPath);
              }
          }, 180);
          return;
      }

      setFallbackActiveTab(tabId);
  }, [activeTab, location.pathname, navigate]);

  const getAccessibleFallbackTab = React.useCallback(() => {
      const roleCandidates = getRoleFallbackCandidates(currentRole);
      const fallbackCandidates = [
        ...roleCandidates,
        ...APP_LAYOUT_ACCESS_FALLBACKS.map(({ tab }) => tab),
        ACCESS_DENIED_FALLBACK_TAB,
      ];

      return fallbackCandidates.find((tabId) =>
        tabId !== activeTab && hasTabAccess(tabId, hasPermission)
      );
  }, [activeTab, currentRole, hasPermission]);

  // Effect: Auto-switch tab if permission denied (e.g. when switching roles)
  React.useEffect(() => {
      if (!isCurrentUserResolved || !currentUser || !currentRole) {
          return;
      }

      if (permissionsLoading) {
          return;
      }

      // STRICT REDIRECT FOR TEKNISI
      if (isTechnicianRole(currentRole)) {
          if (!TEKNISI_ALLOWED_TABS.includes(activeTab as (typeof TEKNISI_ALLOWED_TABS)[number])) {
              handleNavigate('teknisi-mobile');
          }
          return;
      }

      const requiredPermission = APP_LAYOUT_TAB_PERMISSIONS[activeTab];
      if (requiredPermission) {
          const isAllowed = hasRequiredPermission(requiredPermission, hasPermission);
          
          if (!isAllowed) {
              const fallbackTab = getAccessibleFallbackTab();

              if (fallbackTab) {
                  handleNavigate(fallbackTab);
              }
          }
      }
  }, [activeTab, currentRole, currentUser, getAccessibleFallbackTab, handleNavigate, hasPermission, isCurrentUserResolved, permissionsLoading]);

  React.useEffect(() => {
      if (dashboardViewMode !== resolvedDashboardViewMode) {
          setDashboardViewMode(resolvedDashboardViewMode);
      }
  }, [dashboardViewMode, resolvedDashboardViewMode]);

  // Safe check context
  if (!context) {
      return <div className="p-4 text-red-500">Error: MasterData Context not loaded.</div>;
  }

  // Helper to render the correct page content
  const renderContent = () => {
    // --- 1. ACCESS CONTROL CHECK ---
    const requiredPermission = APP_LAYOUT_TAB_PERMISSIONS[activeTab];
    let isAllowed = true;

    if (requiredPermission) {
        const isAllowedByCurrentSnapshot = hasRequiredPermission(requiredPermission, hasPermission);
        if (!isAllowedByCurrentSnapshot && permissionsLoading) {
            return (
              <AppLoadingScreen
                inline
                label="Membuka akses"
                detail="Menyiapkan menu sesuai role akun..."
              />
            );
        }

        if (!isAllowedByCurrentSnapshot) {
            isAllowed = false;
        }
    }

    if (!isAllowed) {
        const fallbackTab = getAccessibleFallbackTab();
        if (fallbackTab) {
             return (
               <AppLoadingScreen
                 inline
                 label="Mengalihkan halaman"
                 detail="Mengarahkan ke menu yang tersedia untuk role ini..."
               />
             );
        }
        return <AccessDenied />;
    }

    // --- 2. RENDER CONTENT ---
    return <AppPageContent
      activeTab={activeTab}
      currentRole={currentRole}
      resolvedDashboardViewMode={resolvedDashboardViewMode}
      availableDashboardViewModes={availableDashboardViewModes}
      setDashboardViewMode={setDashboardViewMode}
      handleNavigate={handleNavigate}
      accessDenied={<AccessDenied />}
    />;
  };

  const getPageTitle = () => {
    return getAppLayoutPageTitle(activeTab);
  };
  const isFlushContentPage = activeTab === 'whatsapp-chats';

  const handleLogout = async () => {
    const loadingToast = toast.loading('Sedang keluar...');
    try {
      localStorage.clear();
      sessionStorage.clear();

      if (import.meta.env.VITE_AUTH_MODE !== 'local') {
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.warn('Logout warning:', error.message);
        }
      }
    } catch (error) {
      console.error('Logout critical error:', error);
    } finally {
      toast.dismiss(loadingToast);
      window.location.href = '/'; 
    }
  };

  const AccessDenied = () => (
    <main className="loginShell">
      <section className="loginCard">
        <span className="loginMark dangerMark">
          <Lock size={26} />
        </span>
        <p className="loginEyebrow">Akses</p>
        <h1>Akses Ditolak</h1>
        <p className="loginHint">
            Anda tidak memiliki izin untuk mengakses halaman ini ({activeTab}). 
            Silakan hubungi Administrator jika Anda yakin ini kesalahan.
        </p>
        <Button onClick={() => handleNavigate(getAccessibleFallbackTab() || DEFAULT_APP_LAYOUT_TAB)} variant="outline">
            Kembali ke Halaman Utama
        </Button>
      </section>
    </main>
  );

  const RoleConfigurationRequired = () => (
    <main className="loginShell">
      <section className="loginCard">
        <span className="loginMark">
          <Lock size={26} />
        </span>
        <p className="loginEyebrow">Session App V2</p>
        <h1>{currentUserIssueTitle}</h1>
        <p className="loginHint">
          {currentUserIssueHint} Login ulang akan membersihkan session lama dari browser ini.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {isRecoverableCurrentUserIssue && (
            <Button onClick={() => window.location.reload()} variant="default">
              Coba Muat Ulang
            </Button>
          )}
          <Button onClick={handleLogout} variant="outline">
            Bersihkan Session
          </Button>
        </div>
      </section>
    </main>
  );

  if (hasInvalidRoleSession) {
    return <RoleConfigurationRequired />;
  }

  if (!isCurrentUserResolved) {
    return <AppLoadingScreen />;
  }

  return (
    <div
      className={cn(
        'appShell',
        isSidebarCollapsed && 'sidebarCollapsed',
        isTechnicianAppMode && 'sidebarHidden technicianAppMode',
      )}
    >
      
      {/* MOBILE SIDEBAR (Drawer/Sheet) - Still accessible via Hamburger for full menu */}
      {!isTechnicianAppMode && (
        <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
          <SheetContent side="left" className="appSheetContent w-[300px] border-r-0 bg-white p-0 text-slate-700 focus:outline-none dark:bg-slate-950 dark:text-slate-300">
              <SheetHeader className="sr-only">
                <SheetTitle>Mobile Navigation</SheetTitle>
                <SheetDescription>Main navigation sidebar for mobile devices</SheetDescription>
              </SheetHeader>
              <Sidebar 
                  activeTab={activeTab} 
                  onNavigate={(id) => {
                      handleNavigate(id);
                      setIsSidebarOpen(false); // Close sheet on navigate
                  }} 
                  mobileMode={true}
                  onLogout={handleLogout}
              />
          </SheetContent>
        </Sheet>
      )}

      {/* DESKTOP SIDEBAR (Static) */}
      {!isTechnicianAppMode && (
        <div className="desktopSidebarSlot">
          <Sidebar 
              activeTab={activeTab} 
              onNavigate={handleNavigate} 
              isCollapsed={isSidebarCollapsed}
              toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              onLogout={handleLogout}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="appMain">
        {/* Topbar - Hidden on Teknisi Mobile */}
        {!isTechnicianAppMode && activeTab !== 'teknisi-mobile' && (
        <header className="appTopbar">
          <div className="appTopbarStart">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsSidebarOpen(true)} 
              className="appTopbarButton"
              aria-label="Buka menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            
            {/* Breadcrumbs / Page Title */}
            <div className="crumbLine">
               <span className="hidden md:inline">RHI System</span>
               <span className="truncate">
                  {getPageTitle()}
               </span>
            </div>
          </div>

          <div className="appTopbarActions">
             <Button 
               variant="ghost" 
               size="icon" 
               onClick={handleGlobalRefresh}
               className="appTopbarButton appTopbarSecondaryAction"
               title={isRefreshingData ? "Data sedang dimuat" : "Refresh Data"}
               disabled={isRefreshingData}
               aria-label="Refresh data aplikasi"
             >
               <RefreshCcw className={cn("h-[1.2rem] w-[1.2rem]", isRefreshingData && "animate-spin")} />
             </Button>
             
            <ModeToggle />

            <NotificationBell onNavigate={handleNavigate} />
            
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="appUserTrigger" aria-label="Buka menu akun">
                   <div className="appUserAvatar">
                     {currentUser?.avatar ? (
                        <img src={currentUser.avatar} alt="User" />
                     ) : (
                        <div className="appUserFallback">
                            {currentUser?.name?.substring(0, 2).toUpperCase() || 'DU'}
                        </div>
                     )}
                   </div>
                   <div className="appUserMeta hidden lg:grid">
                      <strong>{currentUser?.name || 'User'}</strong>
                      <small>{currentUser?.role || 'Online'}</small>
                   </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="appDropdownPanel w-56">
                <DropdownMenuLabel className="appDropdownLabel">Akun Saya</DropdownMenuLabel>
                <DropdownMenuSeparator className="appDropdownSeparator" />
                <DropdownMenuItem onClick={() => handleNavigate('profile')} className="appDropdownItem cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  <span>Profil</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="appDropdownSeparator" />
                <DropdownMenuItem onClick={handleLogout} className="appDropdownItem danger cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Keluar</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
        </header>
        )}

        {/* Page Content with bottom padding for mobile nav */}
        <div
          className={
            isFlushContentPage
              ? 'workspaceViewport flush'
              : cn('workspaceViewport withMobileNav', 'lg:pb-0')
          }
        >
           <PageErrorBoundary key={activeTab}>
           <React.Suspense fallback={<PageLoadingState />}>
             {renderContent()}
           </React.Suspense>
           </PageErrorBoundary>
        </div>

        {/* Bottom Navigation (Mobile Only) */}
        {!permissionsLoading && (
        <BottomNav 
            activeTab={activeTab} 
            onRefresh={handleGlobalRefresh}
            isRefreshing={isRefreshingData}
            onNavigate={(id) => {
                if (id === 'menu' && !isTechnicianAppMode) {
                    setIsSidebarOpen(true);
                } else {
                    handleNavigate(id);
                }
            }} 
        />
        )}
      </main>

      <Toaster
        position="bottom-right"
        richColors
        closeButton
        duration={2200}
        visibleToasts={2}
        gap={8}
        offset={16}
        toastOptions={{
          className: 'appToast',
        }}
      />
    </div>
  );
}
