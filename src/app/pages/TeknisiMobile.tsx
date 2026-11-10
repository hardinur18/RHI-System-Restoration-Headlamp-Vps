import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useMasterData } from './master-data/context';
import { 
  isSameDay, 
  parseISO, 
  format,
  addDays,
  subDays 
} from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { 
  Navigation, 
  X, 
  Calendar as CalendarIcon, 
  Clock,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  LogIn,
  LogOut,
  MapPin,
  Camera,
  Upload,
  Phone,
  Car,
  Trash2,
  Plus,
  AlertTriangle,
  Eraser,
  PenTool,
  Edit2,
  Map,
  MapPinOff
} from 'lucide-react';
import { motion, useAnimation, PanInfo, AnimatePresence, useDragControls } from 'motion/react';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { toast } from 'sonner';
import { supabase } from '../../lib/supabaseClient';
import { getDistance } from '../../utils/mapUtils';
import { isTechnicianRole } from '@/app/data/roleHelpers';
import { getSessionBackedEdgeHeaders } from '@/app/services/internal/sessionClientHeaders';
import { buildMakeServerUrl } from '@/app/services/internal/functionsBaseUrl';

const LazyMapCard = React.lazy(() =>
  import('../components/ui/MapCard').then((module) => ({ default: module.MapCard }))
);

const mobileIconPlainButton =
  'inline-flex h-9 w-9 items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-500 shadow-none transition-colors hover:bg-transparent hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 dark:text-slate-400 dark:hover:text-blue-300';

// Leaflet icons fix removed - handled by MapCard custom icons
// This avoids import errors with Vite in some environments


export function TeknisiMobile() {
  const context = useMasterData();
  const { currentUser, users = [], updateOrder, waTemplates = [] } = context || {};
  
  // Map Visibility State (Default False for Performance)
  const [showMap, setShowMap] = useState(false);
  
  // Safe check for mounting to prevent Map/Leaflet issues
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Local state for server-side fetched orders to reduce lag
  const [serverOrders, setServerOrders] = useState<any[]>([]);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const ordersFetchAbortRef = useRef<AbortController | null>(null);
  const ordersFetchSerialRef = useRef(0);

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Job Detail State
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [isJobDetailOpen, setIsJobDetailOpen] = useState(false);
  
  // Sheet State
  const controls = useAnimation();
  const dragControls = useDragControls();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const SHEET_HEIGHT = 'min(86dvh, calc(100dvh - 96px))';
  const SHEET_MINIMIZED_OFFSET = 'calc(100% - 88px)'; // Semakin ringkas, pas di header
  
  // Data Logic
  const technicians = useMemo(() => users.filter(u => isTechnicianRole(u.role)), [users]);
  const [selectedTechId, setSelectedTechId] = useState<string>('');
  
  // Set default tech
  useEffect(() => {
    if (currentUser) {
        if (isTechnicianRole(currentUser.role)) {
            setSelectedTechId(currentUser.id);
        } else if (technicians.length > 0 && !selectedTechId) {
            setSelectedTechId(technicians[0].id);
        }
    }
  }, [currentUser, technicians]);

  // Date Navigation
  const handlePrevDay = () => setSelectedDate(prev => subDays(prev, 1));
  const handleNextDay = () => setSelectedDate(prev => addDays(prev, 1));

  // Shift Logic
  const isToday = isSameDay(selectedDate, new Date());
  const [shiftData, setShiftData] = useState<{
      status: 'idle' | 'active' | 'completed';
      startTime: string | null;
      endTime: string | null;
      startLocation: { lat: number; lng: number } | null;
      endLocation: { lat: number; lng: number } | null;
  }>({
      status: 'idle',
      startTime: null,
      endTime: null,
      startLocation: null,
      endLocation: null
  });
  const [isShiftLoading, setIsShiftLoading] = useState(false);

  // Fetch Shift
  useEffect(() => {
    const fetchShift = async () => {
        const targetTechId = isTechnicianRole(currentUser?.role) ? currentUser.id : selectedTechId;
        if (!targetTechId) return;
        
        const dateKey = format(selectedDate, 'yyyy-MM-dd');
        const url = buildMakeServerUrl(`/shifts/${targetTechId}/${dateKey}`);
        
        try {
            const headers = await getSessionBackedEdgeHeaders();
            const res = await fetch(url, { headers });
            if (res.ok) {
                const data = await res.json();
                if (data) setShiftData(data);
                else setShiftData({
                    status: 'idle',
                    startTime: null,
                    endTime: null,
                    startLocation: null,
                    endLocation: null
                });
            }
        } catch (e) {
            console.error("Fetch shift error", e);
        }
    };
    fetchShift();
  }, [selectedDate, currentUser, selectedTechId]);

  // Fetch Orders Server Side (Optimized)
  useEffect(() => {
        const targetTechId = isTechnicianRole(currentUser?.role) ? currentUser.id : selectedTechId;
        if (!targetTechId) {
            setServerOrders([]);
            setIsOrdersLoading(false);
            return;
        }

        ordersFetchAbortRef.current?.abort();
        const abortController = new AbortController();
        ordersFetchAbortRef.current = abortController;
        const requestId = ordersFetchSerialRef.current + 1;
        ordersFetchSerialRef.current = requestId;

        const fetchServerOrders = async () => {
        setIsOrdersLoading(true);
        try {
            const dateKey = format(selectedDate, 'yyyy-MM-dd');
            const url = buildMakeServerUrl(`/mobile/technician-orders/${targetTechId}?date=${dateKey}`);
            
            const headers = await getSessionBackedEdgeHeaders();
            if (abortController.signal.aborted) return;

            const res = await fetch(url, { headers, signal: abortController.signal });
            
            if (res.ok) {
                const data = await res.json();
                if (requestId !== ordersFetchSerialRef.current) return;
                // Ensure data is array
                setServerOrders(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            if ((e as any)?.name === 'AbortError') return;
            console.error("Fetch orders error", e);
            // toast.error("Gagal memuat jadwal"); // Silent error better for auto-fetch
        } finally {
            if (ordersFetchAbortRef.current === abortController) {
                ordersFetchAbortRef.current = null;
            }
            if (requestId === ordersFetchSerialRef.current) {
                setIsOrdersLoading(false);
            }
        }
        };

        void fetchServerOrders();

        return () => {
            abortController.abort();
        };
  }, [selectedDate, selectedTechId, currentUser?.id, currentUser?.role]);

  // Routes Calculation
  const myRoutes = useMemo(() => {
      // Use serverOrders directly - filtering is done on server
      const userOrders = [...serverOrders].sort((a, b) => (a.serviceTime || '00:00').localeCompare(b.serviceTime || '00:00'));

      let cumulativeDistance = 0;
      let lastLat = -6.2088;
      let lastLng = 106.8456;

      const firstOrderWithCoordinates = userOrders.find((o) => Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng)));
      if (firstOrderWithCoordinates) {
          lastLat = Number(firstOrderWithCoordinates.lat);
          lastLng = Number(firstOrderWithCoordinates.lng);
      }

      return userOrders.map((o, index) => {
          const rawLat = Number(o.lat);
          const rawLng = Number(o.lng);
          const hasCoordinates = Number.isFinite(rawLat) && Number.isFinite(rawLng);
          const lat = hasCoordinates ? rawLat : lastLat;
          const lng = hasCoordinates ? rawLng : lastLng;
          
          let dist = 0;
          if (index > 0 && hasCoordinates) {
              dist = getDistance(lastLat, lastLng, lat, lng);
              cumulativeDistance += dist;
          }
          
          if (hasCoordinates) {
              lastLat = lat;
              lastLng = lng;
          }

          // Normalize Status for Badge/Pin
          let currentStatus = o.status;
          
          if (currentStatus === 'processing' && o.payload?.technicianStatus) {
              // Backward compatibility for old data that used payload
              currentStatus = o.payload.technicianStatus;
          }

          let mapStatus = 'pending';
          if (['done', 'teknisi_completed', 'completed'].includes(currentStatus)) mapStatus = 'done';
          else if (['processing', 'working', 'otw', 'qc'].includes(currentStatus)) mapStatus = 'processing';
          else if (['cancelled'].includes(currentStatus)) mapStatus = 'cancelled';

          return {
              ...o,
              lat,
              lng,
              distanceFromPrev: dist,
              orderIndex: index + 1,
              mapStatus,
              effectiveStatus: currentStatus,
              hasCoordinates,
          };
      });
  }, [serverOrders]); // Dependency changed from 'orders' to 'serverOrders'

  const mapRoutes = useMemo(() => myRoutes.filter(o => o.hasCoordinates).map(o => ({
        id: o.id,
        name: o.customerName,
        address: o.address,
        lat: o.lat || 0,
        lng: o.lng || 0,
        status: o.mapStatus as any, 
        orderIndex: o.orderIndex,
        iconType: 'building' as const
    })), [myRoutes]);

  const stats = useMemo(() => {
      const completed = myRoutes.filter(r => r.mapStatus === 'done').length;
      const totalDist = myRoutes.reduce((acc, curr) => acc + (curr.distanceFromPrev || 0), 0);
      return { completed, total: myRoutes.length, distance: totalDist.toFixed(1) };
  }, [myRoutes]);


  // Helper: Get Location
  const getSilentLocation = (): Promise<{ lat: number; lng: number } | null> => {
      return new Promise((resolve) => {
          if (!navigator.geolocation) { resolve(null); return; }
          navigator.geolocation.getCurrentPosition(
              (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
              () => resolve(null),
              { enableHighAccuracy: true, timeout: 5000 }
          );
      });
  };

  // Helper: Map Status for UI Display
    const getStatusLabel = (order: any) => {
        const s = order.effectiveStatus || order.payload?.technicianStatus || order.status;
        if (['done', 'teknisi_completed', 'completed'].includes(s)) return 'SELESAI';
        if (s === 'working') return 'PENGERJAAN';
        if (s === 'otw') return 'DI PERJALANAN';
        if (s === 'qc') return 'MENUNGGU QC';
        if (s === 'reschedule') return 'JADWAL ULANG';
        if (s === 'cancelled') return 'CANCEL';
        return 'TERJADWAL';
    };

    // Helper: Map Status for DB Saving
    const mapStatusForSave = (uiStatus: string) => {
        return { status: uiStatus, techStatus: uiStatus };
    };

  // Shift Actions
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    action: () => Promise<void>;
    confirmLabel: string;
    isDestructive?: boolean;
  }>({ 
    isOpen: false, 
    title: '', 
    description: '', 
    action: async () => {}, 
    confirmLabel: 'Ya, Lanjutkan',
    isDestructive: false
  });

  const processStartShift = async () => {
      setIsShiftLoading(true);
      try {
          const now = new Date();
          const location = await getSilentLocation();
          const newData = {
              status: 'active' as const,
              startTime: now.toISOString(),
              endTime: null,
              startLocation: location,
              endLocation: null
          };
          setShiftData(newData);
          
          const targetUserId = isTechnicianRole(currentUser?.role) ? currentUser.id : selectedTechId;
          if (targetUserId) {
             const dateKey = format(selectedDate, 'yyyy-MM-dd');
             const headers = await getSessionBackedEdgeHeaders({ includeJsonContentType: true });
             await fetch(buildMakeServerUrl('/shifts'), {
                 method: 'POST',
                 headers,
                 body: JSON.stringify({ userId: targetUserId, date: dateKey, data: newData })
             });
          }
          toast.success("Shift Dimulai!");
      } finally {
          setIsShiftLoading(false);
      }
  };

  const processEndShift = async () => {
      setIsShiftLoading(true);
      try {
          const now = new Date();
          const location = await getSilentLocation();
          const newData = {
              ...shiftData,
              status: 'completed' as const,
              endTime: now.toISOString(),
              endLocation: location
          };
          setShiftData(newData);
          
          const targetUserId = isTechnicianRole(currentUser?.role) ? currentUser.id : selectedTechId;
          if (targetUserId) {
             const dateKey = format(selectedDate, 'yyyy-MM-dd');
             const headers = await getSessionBackedEdgeHeaders({ includeJsonContentType: true });
             await fetch(buildMakeServerUrl('/shifts'), {
                 method: 'POST',
                 headers,
                 body: JSON.stringify({ userId: targetUserId, date: dateKey, data: newData })
             });
          }
          toast.success("Shift Selesai!");
      } finally {
          setIsShiftLoading(false);
      }
  };

  const handleStartShift = () => {
      if (!isToday) return;
      setConfirmState({
          isOpen: true,
          title: "Mulai Shift Hari Ini",
          description: "Pastikan tidak ada peralatan yang tertinggal, jangan lupa berdoa, dan hati-hati di jalan.",
          confirmLabel: "Mulai Shift",
          isDestructive: false,
          action: processStartShift
      });
  };

  const handleEndShift = () => {
      if (!isToday) return;

      const activeOrders = myRoutes.filter(o => ['otw', 'working', 'processing'].includes(o.effectiveStatus || o.status));
      if (activeOrders.length > 0) {
          toast.error("Gagal Mengakhiri Shift", {
              description: "Masih ada pekerjaan yang statusnya Berjalan (OTW/Working). Harap selesaikan atau Lapor Kendala (Tunda) terlebih dahulu."
          });
          return;
      }

      setConfirmState({
          isOpen: true,
          title: "Akhiri Shift Kerja",
          description: "Terima kasih atas kerja kerasnya hari ini! Pastikan kamu sudah sampai di rumah atau kost dengan selamat sebelum mengakhiri shift ya. Selamat beristirahat.",
          confirmLabel: "Selesaikan Shift",
          isDestructive: true,
          action: processEndShift
      });
  };

  // DEBUG: Reset Shift
  const handleResetShift = async () => {
      if (!confirm("RESET DATA SHIFT? (Hanya untuk testing)")) return;
      setIsShiftLoading(true);
      try {
           const newData = {
              status: 'idle' as const,
              startTime: null,
              endTime: null,
              startLocation: null,
              endLocation: null
          };
          setShiftData(newData);

          const targetUserId = isTechnicianRole(currentUser?.role) ? currentUser.id : selectedTechId;
          if (targetUserId) {
             const dateKey = format(selectedDate, 'yyyy-MM-dd');
             const headers = await getSessionBackedEdgeHeaders({ includeJsonContentType: true });
             await fetch(buildMakeServerUrl('/shifts'), {
                 method: 'POST',
                 headers,
                 body: JSON.stringify({ userId: targetUserId, date: dateKey, data: newData })
             });
          }
          toast.success("Shift Direset!");
      } finally {
          setIsShiftLoading(false);
      }
  };

  // Sheet Animation Logic
  const handleDragEnd = (event: any, info: PanInfo) => {
    const offset = info.offset.y;
    const velocity = info.velocity.y;

    if (offset > 100 || velocity > 500) {
      controls.start({ y: SHEET_MINIMIZED_OFFSET });
      setIsSheetOpen(false);
    } else if (offset < -100 || velocity < -500) {
      controls.start({ y: 0 });
      setIsSheetOpen(true);
    } else {
      // Snap back to current state if threshold not met
      if (isSheetOpen) {
        controls.start({ y: 0 });
      } else {
        controls.start({ y: SHEET_MINIMIZED_OFFSET });
      }
    }
  };

  // Initial Animation
  useEffect(() => {
     controls.start({ y: SHEET_MINIMIZED_OFFSET });
  }, []);

  // Helper: Open WhatsApp
  const handleWhatsApp = (order: any, template?: any) => {
      if (!order.customerPhone) {
          toast.error("Nomor telepon tidak tersedia");
          return;
      }

      let phone = order.customerPhone.replace(/\D/g, '');
      if (phone.startsWith('0')) phone = '62' + phone.substring(1);
      
      let message = '';
      
      if (template) {
          // Replace Variables
          message = template.message
            .replace(/\[Nama\]/g, order.customerName || '')
            .replace(/\[Mobil\]/g, order.vehicleType || '')
            .replace(/\[Order ID\]/g, `\`\`\`${order.id || ''}\`\`\``)
            .replace(/\[Alamat\]/g, order.address || '')
            .replace(/\[Tanggal\]/g, order.serviceDate || '') // Raw date for now
            .replace(/\[Jam\]/g, order.serviceTime || '')
            .replace(/\[Layanan\]/g, order.serviceType || 'Service');
      }

      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
  };

  // Helper: Check Shift Status
  const checkShiftActive = () => {
      if (shiftData.status !== 'active') {
          toast.error("Silakan melakukan Absensi Masuk (Mulai Shift) terlebih dahulu untuk memulai pekerjaan.");
          // Scroll to top to show attendance card
          window.scrollTo({ top: 0, behavior: 'smooth' });
          controls.start({ y: 0 }); // Open sheet if closed
          setIsSheetOpen(true);
          return false;
      }
      return true;
  };

  return (
    <div className="technicianMobilePage relative w-full h-full flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 font-sans">
      
      {/* 1. Map Background */}
      <div className="technicianMobileMapLayer absolute inset-0 z-0 bg-slate-100 dark:bg-slate-950">
         {showMap ? (
             isMounted && (
                 <React.Suspense fallback={<div className="technicianMobileMapFallback" />}>
                 <LazyMapCard
                    routes={mapRoutes}
                    hideControls={true}
                    showLegend={false}
                    showLocationControl={true}
                    disableRouting={true}
                    height="100%"
                    className="w-full h-full"
                 />
                 </React.Suspense>
             )
         ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center opacity-40 select-none">
                <div className="bg-slate-200 p-4 rounded-full mb-3">
                    <Map className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-sm font-bold text-slate-500">Peta Disembunyikan</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-[200px]">
                    Mode hemat daya & performa. Klik tombol di atas untuk menampilkan peta.
                </p>
            </div>
         )}
      </div>

      {/* 2. Top Floating Controls */}
      <div className="technicianMobileFloatingControls absolute top-2 left-2 right-2 z-10 flex flex-col items-center pointer-events-none">
          <div className="technicianMobileControlCard bg-white/95 dark:bg-slate-900/95 backdrop-blur rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 pointer-events-auto overflow-hidden w-full max-w-[340px]">
              
              <div className="flex items-center justify-between px-2 py-1 border-b border-slate-100">
                  <button
                      type="button"
                      className={`${mobileIconPlainButton} h-8 w-8`}
                      onClick={handlePrevDay}
                      aria-label="Hari sebelumnya"
                  >
                      <ChevronLeft className="w-4 h-4" />
                  </button>
                  
                  <div className="text-center flex flex-col items-center">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-0.5">Jadwal Kunjungan</span>
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">
                        {isSameDay(selectedDate, new Date()) 
                          ? `Hari Ini, ${format(selectedDate, 'd MMM', { locale: localeId })}`
                          : format(selectedDate, 'EEEE, d MMM', { locale: localeId })
                        }
                      </h2>
                  </div>
                  
                  <button
                      type="button"
                      className={`${mobileIconPlainButton} h-8 w-8`}
                      onClick={handleNextDay}
                      aria-label="Hari berikutnya"
                  >
                      <ChevronRight className="w-4 h-4" />
                  </button>
              </div>

              <div className="px-3 py-2 border-b border-slate-50">
                  <div className="flex items-center justify-between">
                      <LegendItem color="bg-yellow-500" label="Terjadwal" />
                      <LegendItem color="bg-blue-500" label="Proses" />
                      <LegendItem color="bg-emerald-500" label="Selesai" />
                      <LegendItem color="bg-red-500" label="Cancel" />
                  </div>
              </div>

              <div className="px-3 py-2 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
                 <div className="flex items-center gap-2">
                    <div className="w-8 h-1 bg-[#0E7490] rounded-full"></div>
                    <span className="text-[10px] font-medium text-slate-600">Rute</span>
                 </div>
                 
                 <Button 
                    variant="ghost" 
                    size="sm" 
                    className={`h-6 px-2 text-[10px] font-medium gap-1.5 rounded-full transition-colors ${showMap ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm'}`}
                    onClick={() => setShowMap(!showMap)}
                 >
                    {showMap ? (
                        <>
                            <MapPinOff className="w-3 h-3" /> Sembunyikan
                        </>
                    ) : (
                        <>
                            <Map className="w-3 h-3" /> Tampilkan Peta
                        </>
                    )}
                 </Button>
              </div>
          </div>
      </div>

      {/* 3. Bottom Sheet */}
      <motion.div
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 500 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        animate={controls}
        initial={{ y: SHEET_MINIMIZED_OFFSET }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="technicianMobileVisitSheet absolute bottom-0 left-0 right-0 z-20 bg-white dark:bg-slate-900 rounded-t-[32px] shadow-[0_-8px_30px_rgba(0,0,0,0.12)] flex flex-col border-t border-slate-100 dark:border-slate-800"
        style={{ height: SHEET_HEIGHT }}
      >
        <div 
            onPointerDown={(e) => dragControls.start(e)}
            className="technicianMobileSheetHandle w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none z-30 bg-white dark:bg-slate-900 rounded-t-[32px]"
        >
             <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
        </div>

        <div className="technicianMobileSheetHeader px-6 pb-4 flex items-center justify-between bg-white dark:bg-slate-900 z-20">
             <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Daftar Kunjungan</h2>
             <div className="flex items-center gap-1">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{myRoutes.length} Lokasi</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300" />
                    <span className="text-xs font-medium text-slate-500">{stats.distance} km</span>
                </div>
                <button
                    type="button"
                    className={`${mobileIconPlainButton} -mr-2 ${isSheetOpen ? 'text-slate-500 dark:text-slate-400' : 'text-blue-600 dark:text-blue-300'}`}
                    onClick={() => {
                        if (isSheetOpen) {
                            controls.start({ y: SHEET_MINIMIZED_OFFSET });
                            setIsSheetOpen(false);
                        } else {
                            controls.start({ y: 0 });
                            setIsSheetOpen(true);
                        }
                    }}
                    aria-label={isSheetOpen ? 'Tutup daftar kunjungan' : 'Buka daftar kunjungan'}
                >
                    {isSheetOpen ? <X className="w-5 h-5" /> : <ChevronUp className="w-6 h-6 animate-bounce" />}
                </button>
             </div>
        </div>

        <div className="technicianMobileSheetBody flex-1 overflow-y-auto overscroll-y-none px-5 py-2 space-y-4 bg-white dark:bg-slate-900">
             
             <Card className="border border-slate-100 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 overflow-hidden rounded-xl">
                 <CardContent className="p-3">
                    <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-3">
                             <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                                <LogIn className="w-5 h-5" />
                             </div>
                             <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Absensi Masuk</h3>
                                <p className="text-[10px] text-slate-500 font-medium">
                                    {shiftData.startTime 
                                       ? `Tercatat: ${format(parseISO(shiftData.startTime), 'HH:mm')}`
                                       : 'Mulai aktivitas Anda'}
                                </p>
                             </div>
                        </div>
                        {shiftData.startTime && (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100 h-6 px-2">
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Sukses
                            </Badge>
                        )}
                    </div>

                    {shiftData.status === 'idle' && (
                         isToday ? (
                            <Button 
                                className="w-full font-bold bg-emerald-600 text-white hover:bg-emerald-700 h-9 rounded-lg shadow-sm text-xs"
                                onClick={handleStartShift}
                                disabled={isShiftLoading}
                            >
                                {isShiftLoading ? '...' : 'MULAI SHIFT'}
                            </Button>
                        ) : (
                            <div className="w-full h-9 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center bg-slate-50 dark:bg-slate-800">
                                <span className="text-[10px] text-slate-400">Absen hanya tersedia hari ini</span>
                            </div>
                        )
                    )}
                 </CardContent>
             </Card>

             <div className="space-y-0 pb-4">
                {myRoutes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800">
                        <CalendarIcon className="w-6 h-6 text-slate-300 mb-1" />
                        <p className="text-[10px] text-slate-400 font-medium">Jadwal kosong</p>
                    </div>
                ) : (
                    myRoutes.map((order, idx) => {
                        const isDone = order.mapStatus === 'done';
                        const isActive = order.mapStatus === 'processing';
                        const isCancelled = order.mapStatus === 'cancelled';
                        const isLast = idx === myRoutes.length - 1;

                        return (
                        <div key={order.id} className="relative pl-10 pb-8 last:pb-0 group">
                             {!isLast && (
                                 <div className={`absolute left-[14px] top-8 bottom-0 w-[2px] ${
                                     isDone ? 'bg-emerald-200' : 
                                     (isActive ? 'bg-slate-200' : 'bg-slate-200 border-l-[2px] border-dashed border-slate-300 bg-transparent w-0')
                                 }`} />
                             )}
                             {idx > 0 && (
                                <div className={`absolute left-[14px] top-0 h-8 w-[2px] ${
                                     myRoutes[idx-1].mapStatus === 'done' ? 'bg-emerald-200' : 'bg-slate-200'
                                 }`} />
                             )}

                             {/* Distance Badge */}
                             {idx > 0 && (order.distanceFromPrev || 0) > 0.1 && (
                                 <div className="absolute left-[15px] -top-5 -translate-x-1/2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded-full z-20 flex items-center shadow-sm">
                                     <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">
                                         {(order.distanceFromPrev || 0).toFixed(1)} km
                                     </span>
                                 </div>
                             )}
                             
                             <div className={`absolute left-0 top-1 w-8 h-8 rounded-full flex items-center justify-center z-10 transition-all duration-300 ${
                                 isDone ? 'bg-emerald-500 text-white shadow-emerald-200 shadow-md scale-100' :
                                 isActive ? 'bg-blue-600 text-white shadow-blue-200 shadow-lg scale-110 ring-4 ring-blue-50' :
                                 isCancelled ? 'bg-red-100 text-red-500 border-2 border-red-200' :
                                 'bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-400'
                             }`}>
                                 {isDone ? (
                                     <CheckCircle2 className="w-5 h-5" />
                                 ) : isCancelled ? (
                                     <X className="w-5 h-5" />
                                 ) : (
                                     <span className="text-xs font-bold font-mono">{idx + 1}</span>
                                 )}
                             </div>

                             <Card 
                                className={`border shadow-sm transition-all bg-white dark:bg-slate-900 rounded-xl overflow-hidden ${
                                    isActive ? 'border-blue-200 shadow-blue-100/50 ring-1 ring-blue-100' : 'border-slate-100'
                                }`}
                             >
                                 <CardContent className="p-4">
                                     <div className="flex justify-between items-center mb-2">
                                         <div className="flex items-center gap-2">
                                             <Clock className="w-4 h-4 text-slate-400" />
                                             <span className="text-sm font-bold text-slate-600 font-mono tracking-tight">
                                                 {order.serviceTime}
                                             </span>
                                         </div>
                                         <ChevronRight className="w-4 h-4 text-slate-300" />
                                     </div>

                                     <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">{order.customerName}</h3>

                                     <div className="space-y-2 mb-3">
                                         <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button 
                                                    className="flex items-center gap-2.5 text-sm text-slate-600 hover:bg-green-50 w-full p-1 -ml-1 rounded-lg transition-colors group text-left"
                                                    onClick={(e) => {
                                                        if (!checkShiftActive()) {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                        }
                                                    }}
                                                >
                                                    <div className="w-5 flex justify-center">
                                                        <img 
                                                            src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" 
                                                            alt="WA" 
                                                            className="w-4 h-4"
                                                        />
                                                    </div>
                                                    <span className="font-medium group-hover:text-green-700 transition-colors">{order.customerPhone || '-'}</span>
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="start" className="w-[280px] bg-white dark:bg-slate-800 z-50 shadow-xl border-slate-200 dark:border-slate-700">
                                                <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800">
                                                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pilih Template</h4>
                                                </div>
                                                <div className="max-h-[250px] overflow-y-auto py-1 custom-scrollbar">
                                                    {waTemplates.filter(t => t.category === 'Teknisi' || t.category === 'General' || !t.category).length === 0 && (
                                                        <div className="px-3 py-2 text-xs text-slate-400 text-center">Belum ada template teknisi</div>
                                                    )}
                                                    {waTemplates.filter(t => t.category === 'Teknisi' || t.category === 'General' || !t.category).map(t => (
                                                        <DropdownMenuItem 
                                                            key={t.id} 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleWhatsApp(order, t);
                                                            }} 
                                                            className="flex flex-col items-start px-3 py-2 cursor-pointer focus:bg-slate-50 dark:focus:bg-slate-700 mx-1 rounded my-0.5"
                                                        >
                                                            <span className="font-medium text-xs text-slate-900 dark:text-slate-200 mb-0.5">{t.title}</span>
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 w-full text-left">
                                                                {t.message.replace(/\[Nama\]/g, order.customerName || '')}
                                                            </span>
                                                        </DropdownMenuItem>
                                                    ))}
                                                </div>
                                                <div className="p-2 border-t border-slate-100 dark:border-slate-700">
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        className="w-full text-xs h-8 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700" 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleWhatsApp(order);
                                                        }}
                                                    >
                                                        Chat Kosong (Tanpa Template)
                                                    </Button>
                                                </div>
                                            </DropdownMenuContent>
                                         </DropdownMenu>
                                         <div className="flex items-center gap-2.5 text-sm text-slate-600 px-1">
                                             <div className="w-5 flex justify-center"><Car className="w-4 h-4 text-blue-600" /></div>
                                             <span className="font-medium capitalize">{order.vehicleType || '-'}</span>
                                         </div>
                                     </div>

                                     <div className="pl-[30px] mb-4">
                                        {order.mapsUrl ? (
                                            <a 
                                                href={order.mapsUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-start gap-1.5 group cursor-pointer"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <MapPin className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                                                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 group-hover:text-blue-600 transition-colors underline-offset-2 group-hover:underline">
                                                    {order.address || 'Alamat tidak tersedia'}
                                                </p>
                                            </a>
                                        ) : (
                                            <div className="flex items-start gap-1.5">
                                                <MapPin className="w-4 h-4 text-red-500 mt-0.5 shrink-0 opacity-70" />
                                                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                                                    {order.address || 'Alamat tidak tersedia'}
                                                </p>
                                            </div>
                                        )}
                                     </div>

                                     {!isCancelled && (
                                         (() => {
                                             const statusConfig = (s: string) => {
                                                 switch(s) {
                                                     case 'otw': return { label: 'OTW JALAN', color: 'bg-blue-600 hover:bg-blue-700 text-white', icon: Navigation };
                                                     case 'working': 
                                                     case 'processing': return { label: 'PENGERJAAN', color: 'bg-blue-600 hover:bg-blue-700 text-white', icon: MapPin };
                                                     case 'qc': return { label: 'MENUNGGU QC', color: 'bg-yellow-500 hover:bg-yellow-600 text-white', icon: Clock };
                                                     case 'done': 
                                                     case 'completed': 
                                                     case 'teknisi_completed': return { label: 'SELESAI', color: 'bg-emerald-600 hover:bg-emerald-700 text-white', icon: CheckCircle2 };
                                                     case 'reschedule': return { label: 'JADWAL ULANG', color: 'bg-orange-500 hover:bg-orange-600 text-white', icon: CalendarIcon };
                                                     default: return { label: 'TERJADWAL', color: 'bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700', icon: CalendarIcon };
                                                 }
                                             };
                                             
                                             const config = statusConfig(order.effectiveStatus);
                                             const Icon = config.icon;

                                             return (
                                                 <Button 
                                                    size="sm"
                                                    className={`w-full font-bold h-10 rounded-lg shadow-sm transition-colors ${config.color}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        
                                                        // Allow viewing 'done' orders even if shift is not active
                                                        if (!isDone && !checkShiftActive()) return;
                                                        
                                                        setSelectedOrder(order);
                                                        setIsJobDetailOpen(true);
                                                    }}
                                                 >
                                                    <Icon className="w-4 h-4 mr-2" />
                                                    {config.label}
                                                 </Button>
                                             );
                                         })()
                                     )}
                                 </CardContent>
                             </Card>
                        </div>
                    )})
                )}
             </div>

             {(shiftData.status === 'active' || shiftData.status === 'completed') && (
                 <Card className="border border-slate-100 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 overflow-hidden rounded-xl">
                     <CardContent className="p-3">
                          <div className="flex justify-between items-center mb-3">
                             <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 rounded-full bg-orange-50 flex items-center justify-center text-orange-600">
                                     <LogOut className="w-5 h-5" />
                                  </div>
                                  <div>
                                     <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Absensi Pulang</h3>
                                     <p className="text-[10px] text-slate-500 font-medium">
                                         {shiftData.endTime 
                                            ? `Tercatat: ${format(parseISO(shiftData.endTime), 'HH:mm')}`
                                            : 'Selesaikan pekerjaan'}
                                     </p>
                                  </div>
                             </div>
                             {shiftData.endTime && (
                                 <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100 h-6 px-2">
                                     <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Sukses
                                 </Badge>
                             )}
                         </div>

                         {shiftData.status === 'active' && isToday && (
                             <Button 
                                 variant="outline"
                                 className="w-full font-bold h-9 rounded-lg text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 shadow-sm"
                                 onClick={handleEndShift}
                                 disabled={isShiftLoading}
                             >
                                 {isShiftLoading ? '...' : 'SELESAI SHIFT'}
                             </Button>
                         )}

{/* Reset Shift Removed */}
                     </CardContent>
                 </Card>
             )}
             
             <div className="h-24" />
        </div>
      </motion.div>

      <AlertDialog open={confirmState.isOpen} onOpenChange={(open) => setConfirmState(prev => ({ ...prev, isOpen: open }))}>
        <AlertDialogContent className="technicianMobileConfirmDialog bg-white dark:bg-slate-900 border-none shadow-xl max-w-[90%] rounded-2xl w-[90%] sm:max-w-lg p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900 dark:text-slate-100 text-lg font-bold">{confirmState.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500 text-sm">
              {confirmState.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-row gap-3 mt-4 sm:justify-end">
            <AlertDialogCancel className="flex-1 sm:flex-none mt-0 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 h-10 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction 
                className={`flex-1 sm:flex-none h-10 rounded-xl font-bold shadow-sm transition-all ${
                  confirmState.isDestructive 
                    ? 'bg-red-500 hover:bg-red-600 text-white ring-red-200' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white ring-blue-200'
                }`}
                onClick={confirmState.action}
            >
              {confirmState.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <JobDetailSheet 
        order={selectedOrder} 
        isOpen={isJobDetailOpen} 
        onClose={() => setIsJobDetailOpen(false)} 
        onConfirm={(opts) => {
            setConfirmState({
                isOpen: true,
                title: opts.title,
                description: opts.description,
                confirmLabel: "Ya, Lanjutkan",
                isDestructive: false,
                action: opts.action
            });
        }}
        onUpdateStatus={async (status, data) => {
            if (!selectedOrder) return;
            
            const { status: dbStatus, techStatus } = mapStatusForSave(status);
            
            // Handle different data types
            let proofUrl = typeof data === 'string' ? data : data?.proofUrl;
            let beforePhotos = typeof data === 'object' ? data?.beforePhotos : undefined;
            let afterPhotos = typeof data === 'object' ? data?.afterPhotos : undefined;
            let signature = typeof data === 'object' ? data?.signature : undefined;
            let notes = typeof data === 'object' ? data?.notes : undefined;

            if (updateOrder) {
                const currentPhotos = selectedOrder.photos || {};
                const nextPhotos = { ...currentPhotos };

                if (beforePhotos) nextPhotos.before = beforePhotos;
                if (afterPhotos) nextPhotos.after = afterPhotos;
                if (signature) nextPhotos.signature = [signature];
                
                if (proofUrl && !afterPhotos) {
                    nextPhotos.after = [proofUrl];
                }

                // Activity Tracking: Location & Time
                const now = new Date();
                let additionalPayload: any = {};
                
                if (techStatus === 'working') {
                     // Start Job: Record Time & Location
                     const loc = await getSilentLocation();
                     additionalPayload = {
                        startedAt: now.toISOString(),
                        startLocation: loc
                     };
                } else if (techStatus === 'qc' || techStatus === 'done') {
                     // Finish Job: Record Time, Location & Calculate Duration
                     const loc = await getSilentLocation();
                     const startedAt = selectedOrder.payload?.startedAt;
                     let duration = 0;
                     if (startedAt) {
                        const start = new Date(startedAt);
                        duration = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60000)); // Minutes
                     }

                     additionalPayload = {
                        finishedAt: now.toISOString(),
                        endLocation: loc,
                        durationMinutes: duration
                     };
                }

                const updatedOrder = {
                    ...selectedOrder,
                    status: dbStatus,
                    photos: nextPhotos,
                    notes: notes ? (selectedOrder.notes ? `${selectedOrder.notes}\n\n[Teknisi]: ${notes}` : notes) : selectedOrder.notes,
                    payload: {
                        ...(selectedOrder.payload || {}),
                        technicianStatus: techStatus,
                        ...(notes ? { completionNotes: notes } : {}),
                        ...additionalPayload
                    }
                };
                
                setSelectedOrder(updatedOrder); // Update local state so duration calc works if continued
                
                // Optimistic Update Local List
                setServerOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
                
                await updateOrder(updatedOrder);
                toast.success(`Status updated: ${getStatusLabel({...updatedOrder, status: dbStatus})}`);
            }
        }}
      />
    </div>
  );
}

// Extended Type to handle both new file uploads and existing URLs
type PhotoItem = { file?: File, preview: string, url?: string, isExisting?: boolean };

function JobDetailSheet({ 
  order, 
  isOpen, 
  onClose, 
  onUpdateStatus,
  onConfirm
}: { 
  order: any, 
  isOpen: boolean, 
  onClose: () => void,
  onUpdateStatus: (status: string, data?: any) => Promise<void>,
  onConfirm: (opts: { title: string, description: string, action: () => Promise<void> }) => void
}) {
    const { waTemplates } = useMasterData();
    const [status, setStatus] = useState<'pending' | 'otw' | 'working' | 'qc' | 'done'>('pending');
    const [isLoading, setIsLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    
    // Photo & Signature State
    const [beforePhotos, setBeforePhotos] = useState<PhotoItem[]>([]);
    const [afterPhotos, setAfterPhotos] = useState<PhotoItem[]>([]);
    const [signature, setSignature] = useState<{ blob: Blob, preview: string } | null>(null);
    
    // UI State
    const [showBeforeUpload, setShowBeforeUpload] = useState(false);
    const [note, setNote] = useState('');
    const [showSignaturePad, setShowSignaturePad] = useState(false);
    const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
    const [issueText, setIssueText] = useState('');
    const [isReschedule, setIsReschedule] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    
    const sigCanvas = useRef<any>(null);

    // Helper: Open WhatsApp
    const handleWhatsApp = (template?: any) => {
        if (!order.customerPhone) {
            toast.error("Nomor telepon tidak tersedia");
            return;
        }

        let phone = order.customerPhone.replace(/\D/g, '');
        if (phone.startsWith('0')) phone = '62' + phone.substring(1);
        
        let message = '';
        
        if (template) {
            message = template.message
                .replace(/\[Nama\]/g, order.customerName || '')
                .replace(/\[Mobil\]/g, order.vehicleType || '')
                .replace(/\[Alamat\]/g, order.address || '')
                .replace(/\[Tanggal\]/g, order.serviceDate || '')
                .replace(/\[Jam\]/g, order.serviceTime || '')
                .replace(/\[Layanan\]/g, order.serviceType || 'Service');
        }

        const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    // Initial Load & Reset
    useEffect(() => {
        if (isOpen && order) {
             // Reset state
             setBeforePhotos([]);
             setAfterPhotos([]);
             setSignature(null);
             setNote('');
             setIssueText('');
             setShowBeforeUpload(false);
             setIsEditing(false);
             
             // Map status
             let currentStatus = order.status;
             if (currentStatus === 'processing' && order.payload?.technicianStatus) {
                 currentStatus = order.payload.technicianStatus;
             }
             if (order.effectiveStatus) currentStatus = order.effectiveStatus;
            
            let s: any = 'pending';
            if (['done', 'teknisi_completed', 'completed'].includes(currentStatus)) s = 'done';
            else if (['working'].includes(currentStatus)) s = 'working';
            else if (['qc'].includes(currentStatus)) s = 'qc';
            else if (['otw'].includes(currentStatus)) s = 'otw';
            else if (['processing'].includes(currentStatus)) s = 'working';
            
            setStatus(s);
        }
    }, [isOpen, order]);

    // Handle Safe Close
    const handleClose = () => {
        // Check for unsaved changes (Dirty State)
        const isWorkingDirty = status === 'working' && (afterPhotos.some(p => !!p) || note.length > 0 || signature !== null);
        const isEditingDirty = isEditing && (afterPhotos.some(p => !p.isExisting) || afterPhotos.length === 0);
        const isBeforeDirty = showBeforeUpload && beforePhotos.some(p => !!p);

        if (isWorkingDirty || isEditingDirty || isBeforeDirty) {
            setShowCloseConfirm(true);
        } else {
            onClose();
        }
    };

    // Helper: Upload file to storage
    const uploadFileToStorage = async (file: File | Blob, folder: string): Promise<string | null> => {
        try {
            const fileExt = file instanceof File ? file.name.split('.').pop() : 'png';
            const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
            const filePath = `${order.id}/${folder}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('orders')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data } = supabase.storage
                .from('orders')
                .getPublicUrl(filePath);

            return data.publicUrl;
        } catch (error) {
            console.error('Upload error:', error);
            return null;
        }
    };

    const deleteFilesFromStorage = async (urls: string[]) => {
        if (urls.length === 0) return;
        try {
            const paths = urls.map(url => {
                const parts = url.split('/orders/');
                return parts.length > 1 ? parts[1] : null;
            }).filter(Boolean) as string[];

            if (paths.length > 0) {
                await supabase.storage.from('orders').remove(paths);
            }
        } catch (e) {
            console.error("Delete files error", e);
        }
    };

    // Helper: Local File Change
    const handleLocalFileChange = (
        e: React.ChangeEvent<HTMLInputElement>, 
        setter: React.Dispatch<React.SetStateAction<PhotoItem[]>>,
        currentFiles: PhotoItem[],
        index: number
    ) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const preview = URL.createObjectURL(file);
            
            const newFiles = [...currentFiles];
            newFiles[index] = { file, preview, isExisting: false };
            setter(newFiles);
        }
    };

    const handleBeforeFileChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        handleLocalFileChange(e, setBeforePhotos, beforePhotos, index);
    };

    const handleAfterFileChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        handleLocalFileChange(e, setAfterPhotos, afterPhotos, index);
    };

    const saveSignature = async () => {
        if (sigCanvas.current) {
            // Use getCanvas() to avoid getTrimmedCanvas error
            const dataUrl = sigCanvas.current.getCanvas().toDataURL('image/png');
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            setSignature({ blob, preview: dataUrl });
            setShowSignaturePad(false);
        }
    };

    // Submit Handlers
    const handleStartWork = async () => {
        const validPhotos = beforePhotos.filter(Boolean);
        if (validPhotos.length === 0) {
            toast.error("Mohon upload minimal 1 foto sebelum pengerjaan");
            return;
        }

        setIsUploading(true);
        try {
            const uploadedUrls = await Promise.all(
                validPhotos.map(async (p) => {
                    if (p.file) return await uploadFileToStorage(p.file, 'before');
                    return null;
                })
            );

            const finalUrls = uploadedUrls.filter((u): u is string => !!u);
            if (finalUrls.length === 0) throw new Error("Upload failed");

            await onUpdateStatus('working', { beforePhotos: finalUrls });
            setStatus('working');
            setShowBeforeUpload(false);
            setBeforePhotos([]); // Clear local state after success
        } catch (e) {
            toast.error("Gagal upload foto/update status");
        } finally {
            setIsUploading(false);
        }
    };

    const handleFinishWork = async () => {
        const validPhotos = afterPhotos.filter(Boolean);
        if (validPhotos.length < 2) {
            toast.error("Mohon upload minimal 2 foto bukti pekerjaan");
            return;
        }
        if (!signature) {
            toast.error("Mohon minta tanda tangan customer");
            return;
        }

        setIsUploading(true);
        try {
            const uploadedAfterUrls = await Promise.all(
                validPhotos.map(async (p) => {
                    if (p.file) return await uploadFileToStorage(p.file, 'after');
                    return null;
                })
            );
            const finalAfterUrls = uploadedAfterUrls.filter((u): u is string => !!u);

            const sigUrl = await uploadFileToStorage(signature.blob, 'signature');

            if (finalAfterUrls.length === 0 || !sigUrl) throw new Error("Upload failed");

            await onUpdateStatus('qc', { 
                afterPhotos: finalAfterUrls,
                signature: sigUrl,
                notes: note
            });
            setStatus('qc');
            // Clear local state
            setAfterPhotos([]);
            setSignature(null);
            setNote('');
        } catch (e) {
            toast.error("Gagal submit laporan");
        } finally {
            setIsUploading(false);
        }
    };

    const handleSaveEditedPhotos = async () => {
        const validPhotos = afterPhotos.filter(Boolean);
        if (validPhotos.length < 2) {
            toast.error("Minimal 2 foto bukti pekerjaan");
            return;
        }

        setIsUploading(true);
        try {
            const currentOrderPhotos = order.photos?.after || [];
            
            // 1. Upload New Files
            const processedPhotos = await Promise.all(
                validPhotos.map(async (p) => {
                    if (p.isExisting && p.url) {
                        return p.url;
                    } else if (p.file) {
                        return await uploadFileToStorage(p.file, 'after');
                    }
                    return null;
                })
            );
            
            const finalUrls = processedPhotos.filter((u): u is string => !!u);
            
            // 2. Identify Deleted Photos (to remove from storage)
            // Any URL in currentOrderPhotos that is NOT in finalUrls should be deleted
            const urlsToDelete = currentOrderPhotos.filter((url: string) => !finalUrls.includes(url));
            if (urlsToDelete.length > 0) {
                await deleteFilesFromStorage(urlsToDelete);
            }

            // 3. Update Order
            await onUpdateStatus('qc', { afterPhotos: finalUrls });
            
            setIsEditing(false);
            setAfterPhotos([]);
            toast.success("Foto berhasil diperbarui");
        } catch (e) {
            console.error(e);
            toast.error("Gagal menyimpan perubahan foto");
        } finally {
            setIsUploading(false);
        }
    };

    const handleReportIssue = async () => {
        if (!issueText.trim()) {
            toast.error("Mohon jelaskan kendala");
            return;
        }
        setIsLoading(true);
        try {
            const statusToSet = isReschedule ? 'pending' : 'working';
            const issueNote = `[KENDALA${isReschedule ? ' - TUNDA' : ''}]: ${issueText}`;
            await onUpdateStatus(statusToSet, { notes: issueNote });
            setIsIssueModalOpen(false);
            toast.info(isReschedule ? "Pekerjaan ditunda" : "Kendala dilaporkan");
        } finally {
            setIsLoading(false);
        }
    };

    // Reusable Action for simple status change
    const handleSimpleAction = async (nextStatus: string) => {
        setIsLoading(true);
        try {
            await onUpdateStatus(nextStatus);
            setStatus(nextStatus as any);
        } finally {
            setIsLoading(false);
        }
    };

    // Initialize Edit Mode
    const startEditing = () => {
        if (order.photos?.after && Array.isArray(order.photos.after)) {
            const existingPhotos = order.photos.after.map((url: string) => ({
                preview: url,
                url: url,
                isExisting: true
            }));
            setAfterPhotos(existingPhotos);
            setIsEditing(true);
        }
    };

    if (!order) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="absolute inset-0 bg-black/60 z-40 backdrop-blur-[2px]"
                        onClick={handleClose}
                    />
                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="technicianMobileDetailSheet absolute bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 rounded-t-[32px] shadow-2xl flex flex-col max-h-[90%] border-t border-slate-100 dark:border-slate-800"
                        onClick={(e) => e.stopPropagation()}
                    >
                         <div className="w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none z-30 bg-white dark:bg-slate-900 rounded-t-[32px]">
                             <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
                         </div>

                         <div className="px-6 pb-6 overflow-y-auto relative">
                             <div className="sticky top-0 bg-white dark:bg-slate-900 z-20 pb-4 pt-1 flex justify-between items-start border-b border-slate-50 dark:border-slate-800 mb-4">
                                 <div>
                                     <div className="flex items-center gap-1.5 mb-3">
                                         <Clock className="w-4 h-4 text-slate-400" />
                                         <span className="text-sm font-bold text-slate-600 font-mono tracking-tight">
                                             {order.serviceTime}
                                         </span>
                                     </div>
                                     <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 line-clamp-1 pr-4 mb-3">{order.customerName}</h2>
                                     
                                     <div className="space-y-2 mb-3">
                                         <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button 
                                                    className="flex items-center gap-2 text-sm text-slate-600 hover:text-green-600 transition-colors w-full text-left"
                                                >
                                                    <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" className="w-4 h-4" alt="WA" />
                                                    <span className="font-medium">{order.customerPhone || '-'}</span>
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="start" className="w-[280px] bg-white dark:bg-slate-800 z-50 shadow-xl border-slate-200 dark:border-slate-700">
                                                <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800">
                                                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pilih Template</h4>
                                                </div>
                                                <div className="max-h-[250px] overflow-y-auto py-1 custom-scrollbar">
                                                    {waTemplates.filter(t => t.category === 'Teknisi' || t.category === 'General' || !t.category).map(t => (
                                                        <DropdownMenuItem 
                                                            key={t.id} 
                                                            onClick={() => handleWhatsApp(t)} 
                                                            className="flex flex-col items-start px-3 py-2 cursor-pointer focus:bg-slate-50 dark:focus:bg-slate-700 mx-1 rounded my-0.5"
                                                        >
                                                            <span className="font-medium text-xs text-slate-900 dark:text-slate-200 mb-0.5">{t.title}</span>
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 w-full text-left">
                                                                {t.message.replace(/\[Nama\]/g, order.customerName || '')}
                                                            </span>
                                                        </DropdownMenuItem>
                                                    ))}
                                                </div>
                                                <div className="p-2 border-t border-slate-100 dark:border-slate-700">
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        className="w-full text-xs h-8 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700" 
                                                        onClick={() => handleWhatsApp()}
                                                    >
                                                        Chat Kosong (Tanpa Template)
                                                    </Button>
                                                </div>
                                            </DropdownMenuContent>
                                         </DropdownMenu>
                                         <div className="flex items-center gap-2 text-sm text-slate-600">
                                             <Car className="w-4 h-4 text-blue-600" />
                                             <span className="font-medium capitalize">{order.vehicleType || '-'}</span>
                                         </div>
                                     </div>

                                     <p className="text-sm text-slate-500 line-clamp-2">{order.address}</p>
                                 </div>
                                 <button
                                     type="button"
                                     onClick={handleClose}
                                     className={`${mobileIconPlainButton} -mr-2 flex-shrink-0`}
                                     aria-label="Tutup detail pekerjaan"
                                 >
                                     <X className="w-5 h-5 text-slate-500" />
                                 </button>
                             </div>

                             {/* Status Timeline */}
                             {!showBeforeUpload && !isEditing && (
                                 <div className="flex items-center justify-between mb-8 px-2 overflow-x-auto">
                                     {['pending', 'otw', 'working', 'qc', 'done'].map((step, idx) => {
                                         const timeline = ['pending', 'otw', 'working', 'qc', 'done'];
                                         const stepIdx = timeline.indexOf(step);
                                         const currentIdx = timeline.indexOf(status);
                                         const isCompleted = stepIdx <= currentIdx;
                                         
                                         let label = 'JADWAL';
                                         if (step === 'otw') label = 'OTW';
                                         if (step === 'working') label = 'KERJA';
                                         if (step === 'qc') label = 'QC';
                                         if (step === 'done') label = 'SELESAI';

                                         return (
                                             <div key={step} className="flex flex-col items-center relative z-10 min-w-[50px]">
                                                 <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors ${
                                                     isCompleted 
                                                        ? 'bg-blue-600 border-blue-600 text-white' 
                                                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-500'
                                                 }`}>
                                                     {step === 'pending' && <Clock className="w-3 h-3" />}
                                                     {step === 'otw' && <Navigation className="w-3 h-3" />}
                                                     {step === 'working' && <MapPin className="w-3 h-3" />}
                                                     {step === 'qc' && <CheckCircle2 className="w-3 h-3" />}
                                                     {step === 'done' && <CheckCircle2 className="w-3 h-3" />}
                                                 </div>
                                                 {idx !== 4 && (
                                                     <div className={`absolute top-4 left-1/2 w-full h-0.5 -z-10 ${
                                                         stepIdx < currentIdx ? 'bg-blue-600' : 'bg-slate-200'
                                                     }`} />
                                                 )}
                                                 <span className={`text-[9px] font-bold mt-1 uppercase ${
                                                     isCompleted ? 'text-blue-600' : 'text-slate-300'
                                                 }`}>
                                                     {label}
                                                 </span>
                                             </div>
                                         );
                                     })}
                                 </div>
                             )}

                             {/* Action Button */}
                             <div className="space-y-3">
                                 {status === 'pending' && (
                                     <Button 
                                         className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-200"
                                         onClick={() => {
                                             onConfirm({
                                                 title: "Mulai Perjalanan?",
                                                 description: "Status akan berubah menjadi 'DI PERJALANAN' dan Google Maps akan dibuka. Siap menuju tempat customer dan hati-hati di jalan.",
                                                 action: async () => {
                                                     // Open Maps FIRST to avoid iOS popup blocker issues caused by async delay
                                                     if (order.mapsUrl) {
                                                         window.open(order.mapsUrl, '_blank');
                                                     } else if (order.lat && order.lng && (order.lat !== -6.2088 || order.lng !== 106.8456)) {
                                                         window.open(`https://www.google.com/maps/dir/?api=1&destination=${order.lat},${order.lng}`, '_blank');
                                                     } else if (order.address) {
                                                         window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address)}`, '_blank');
                                                     } else {
                                                         toast.error("Lokasi tidak tersedia");
                                                     }

                                                     await handleSimpleAction('otw');
                                                 }
                                             });
                                         }}
                                         disabled={isLoading}
                                     >
                                         <Navigation className="w-4 h-4 mr-2" />
                                         {isLoading ? 'Menyimpan...' : 'OTW JALAN'}
                                     </Button>
                                 )}

                                 {status === 'otw' && !showBeforeUpload && (
                                     <Button 
                                         className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-200"
                                         onClick={() => setShowBeforeUpload(true)}
                                         disabled={isLoading}
                                     >
                                         <MapPin className="w-4 h-4 mr-2" />
                                         {isLoading ? 'Menyimpan...' : 'SAMPAI & MULAI KERJA'}
                                     </Button>
                                 )}

                                 {status === 'otw' && showBeforeUpload && (
                                     <div className="space-y-4 border border-slate-100 dark:border-slate-800 rounded-xl p-4 bg-slate-50 dark:bg-slate-800/50 animate-in fade-in slide-in-from-bottom-4">
                                         <div className="flex items-center justify-between">
                                             <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Upload Foto Sebelum Pengerjaan</h3>
                                             <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="h-6 text-[10px] text-slate-400 hover:text-slate-600"
                                                onClick={handleClose}
                                             >
                                                 Batal
                                             </Button>
                                         </div>
                                         <p className="text-xs text-slate-500">Ambil foto kondisi kendaraan/unit sebelum dikerjakan. Maksimal 2 foto.</p>
                                         
                                         <div className="grid grid-cols-2 gap-3">
                                             {[0, 1].map((index) => (
                                                 <div key={index} className="aspect-square relative group">
                                                     {beforePhotos[index] ? (
                                                         <>
                                                             <img src={beforePhotos[index].preview} alt={`Before ${index + 1}`} className="w-full h-full object-cover rounded-xl border border-slate-200" />
                                                             <button 
                                                                 className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full hover:bg-red-500 transition-colors"
                                                                 onClick={() => {
                                                                     const newPhotos = [...beforePhotos];
                                                                     newPhotos[index] = null as any; 
                                                                     setBeforePhotos(newPhotos.filter(Boolean)); 
                                                                 }}
                                                             >
                                                                 <Trash2 className="w-3 h-3" />
                                                             </button>
                                                         </>
                                                     ) : (
                                                         <label className="w-full h-full rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:bg-white hover:border-blue-400 transition-all bg-white/50">
                                                             <Camera className="w-6 h-6 text-slate-300 mb-2" />
                                                             <span className="text-[10px] font-bold text-slate-400">Foto {index + 1}</span>
                                                             <input 
                                                                 type="file" 
                                                                 accept="image/*" 
                                                                 className="hidden" 
                                                                 onChange={(e) => handleBeforeFileChange(e, index)} 
                                                             />
                                                         </label>
                                                     )}
                                                 </div>
                                             ))}
                                         </div>
                                         
                                         <Button 
                                            className="w-full h-11 font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-200" 
                                            onClick={handleStartWork}
                                            disabled={isLoading || isUploading || beforePhotos.filter(Boolean).length === 0}
                                         >
                                             {isUploading ? 'Mengupload...' : 'MULAI PENGERJAAN'}
                                         </Button>
                                     </div>
                                 )}

                                 {(status === 'working' || isEditing) && (
                                     <div className="space-y-4 border border-slate-100 rounded-xl p-4 bg-slate-50">
                                         <div className="flex justify-between items-center">
                                             <h3 className="font-bold text-sm text-slate-900">
                                                {isEditing ? 'Ubah Foto Bukti' : 'Penyelesaian Pekerjaan'}
                                             </h3>
                                             {!isEditing && (
                                                 <Button
                                                     variant="ghost"
                                                     size="sm"
                                                     className="h-6 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 px-2"
                                                     onClick={() => setIsIssueModalOpen(true)}
                                                 >
                                                     <AlertTriangle className="w-3 h-3 mr-1" />
                                                     Lapor Kendala
                                                 </Button>
                                             )}
                                             {isEditing && (
                                                 <Button
                                                     variant="ghost"
                                                     size="sm"
                                                     className="h-6 text-[10px] text-slate-400 hover:text-slate-600"
                                                     onClick={() => setIsEditing(false)}
                                                 >
                                                     Batal
                                                 </Button>
                                             )}
                                         </div>

                                         <div className="space-y-2">
                                             <label className="text-xs font-medium text-slate-700">Bukti Foto (Minimal 2)</label>
                                             <div className="grid grid-cols-2 gap-3">
                                                 {[0, 1].map((index) => (
                                                     <div key={index} className="aspect-square relative group">
                                                         {afterPhotos[index] ? (
                                                             <>
                                                                 <img src={afterPhotos[index].preview} alt={`After ${index + 1}`} className="w-full h-full object-cover rounded-xl border border-slate-200" />
                                                                 <button 
                                                                     className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full hover:bg-red-500 transition-colors"
                                                                     onClick={() => {
                                                                         const newPhotos = [...afterPhotos];
                                                                         newPhotos[index] = null as any;
                                                                         setAfterPhotos(newPhotos.filter(Boolean));
                                                                     }}
                                                                 >
                                                                     <Trash2 className="w-3 h-3" />
                                                                 </button>
                                                             </>
                                                         ) : (
                                                             <label className="w-full h-full rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all border-slate-300 hover:border-blue-400 hover:bg-white bg-white/50">
                                                                 <Camera className="w-6 h-6 text-slate-300 mb-2" />
                                                                 <span className="text-[10px] font-bold text-slate-400">Foto {index + 1}</span>
                                                                 <input 
                                                                     type="file" 
                                                                     accept="image/*" 
                                                                     className="hidden" 
                                                                     onChange={(e) => handleAfterFileChange(e, index)} 
                                                                 />
                                                             </label>
                                                         )}
                                                     </div>
                                                 ))}
                                             </div>
                                         </div>

                                         {!isEditing && (
                                            <>
                                                 <div className="space-y-2">
                                                     <label className="text-xs font-medium text-slate-700">Catatan Teknisi (Opsional)</label>
                                                     <textarea
                                                         className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-100 min-h-[80px]"
                                                         placeholder="Contoh: Pekerjaan selesai, AC dingin normal."
                                                         value={note}
                                                         onChange={(e) => setNote(e.target.value)}
                                                     />
                                                 </div>

                                                 <div className="space-y-2">
                                                     <label className="text-xs font-medium text-slate-700">Tanda Tangan Customer</label>
                                                     <div 
                                                         className="w-full h-24 rounded-xl border border-slate-200 bg-white flex items-center justify-center cursor-pointer hover:border-blue-300 transition-colors overflow-hidden relative"
                                                         onClick={() => setShowSignaturePad(true)}
                                                     >
                                                         {signature ? (
                                                             <img src={signature.preview} alt="Signature" className="w-full h-full object-contain p-2" />
                                                         ) : (
                                                             <div className="flex flex-col items-center text-slate-400">
                                                                 <PenTool className="w-5 h-5 mb-1" />
                                                                 <span className="text-[10px]">Ketuk untuk Tanda Tangan</span>
                                                             </div>
                                                         )}
                                                     </div>
                                                 </div>

                                                 <Button 
                                                     className="w-full h-11 font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-lg shadow-emerald-100" 
                                                     onClick={handleFinishWork}
                                                     disabled={isLoading || isUploading || afterPhotos.filter(Boolean).length < 2 || !signature}
                                                 >
                                                     {isUploading ? 'Mengupload & Menyimpan...' : 'SELESAI & AJUKAN QC'}
                                                 </Button>
                                            </>
                                         )}

                                         {isEditing && (
                                              <Button 
                                                 className="w-full h-11 font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-100 mt-2" 
                                                 onClick={handleSaveEditedPhotos}
                                                 disabled={isLoading || isUploading || afterPhotos.filter(Boolean).length < 2}
                                             >
                                                 {isUploading ? 'Menyimpan Perubahan...' : 'SIMPAN PERUBAHAN'}
                                             </Button>
                                         )}
                                     </div>
                                 )}

                                 {(status === 'qc' || status === 'done') && !isEditing && (
                                      <div className="space-y-4">
                                         <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 text-center">
                                             <div className="flex justify-center mb-2">
                                                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                                                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                                                </div>
                                             </div>
                                             <h3 className="font-bold text-emerald-700 text-lg mb-1">Pekerjaan Selesai</h3>
                                             <p className="text-xs text-emerald-600 mb-0">
                                                 Terima kasih atas kerja keras Anda!<br/>
                                                 <span className="opacity-70 text-[10px] mt-1 block">(Status: {status === 'qc' ? 'Menunggu QC' : 'Selesai'})</span>
                                             </p>
                                         </div>

                                         {status === 'qc' && (
                                             <Button 
                                                variant="outline"
                                                className="w-full h-10 border-slate-200 text-slate-600 font-medium"
                                                onClick={startEditing}
                                             >
                                                 <Edit2 className="w-4 h-4 mr-2" />
                                                 Edit Foto Bukti
                                             </Button>
                                         )}
                                      </div>
                                 )}
                             </div>
                             
                             <div className="h-8" />
                         </div>
                    </motion.div>

            {/* Signature Modal */}
            {showSignaturePad && (
                <div className="technicianMobilePhotoOverlay fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-900">Tanda Tangan</h3>
                            <button
                                type="button"
                                className={mobileIconPlainButton}
                                onClick={() => setShowSignaturePad(false)}
                                aria-label="Tutup tanda tangan"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="h-64 bg-white relative">
                            <SignatureCanvas 
                                ref={sigCanvas}
                                canvasProps={{ className: 'w-full h-full' }}
                                backgroundColor="white"
                            />
                            <div className="absolute bottom-2 left-2 text-[10px] text-slate-300 pointer-events-none">
                                Area Tanda Tangan
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-100 flex gap-3">
                            <Button 
                                variant="outline" 
                                className="flex-1"
                                onClick={() => sigCanvas.current?.clear()}
                            >
                                <Eraser className="w-4 h-4 mr-2" />
                                Hapus
                            </Button>
                            <Button 
                                className="flex-1 bg-blue-600 text-white"
                                onClick={saveSignature}
                            >
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                Simpan
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Issue Modal */}
            <AlertDialog open={isIssueModalOpen} onOpenChange={setIsIssueModalOpen}>
                <AlertDialogContent className="technicianMobileConfirmDialog bg-white dark:bg-slate-900 border-none shadow-xl max-w-[90%] rounded-2xl p-6 z-[70]">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-600 flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5" />
                            Lapor Kendala
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Jelaskan kendala yang terjadi di lapangan. Laporan ini akan diteruskan ke admin.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-4 space-y-4">
                        <textarea 
                            className="w-full h-24 p-3 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-red-100 focus:border-red-200 outline-none resize-none"
                            placeholder="Deskripsi kendala..."
                            value={issueText}
                            onChange={(e) => setIssueText(e.target.value)}
                        />
                        <div className="flex items-center gap-3 px-1">
                            <input 
                                type="checkbox" 
                                id="reschedule_check"
                                className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                                checked={isReschedule}
                                onChange={(e) => setIsReschedule(e.target.checked)}
                            />
                            <label htmlFor="reschedule_check" className="text-sm text-slate-700 font-medium cursor-pointer select-none">
                                Tunda Pekerjaan (Status kembali ke Pending)
                            </label>
                        </div>
                    </div>
                    <AlertDialogFooter className="flex gap-2">
                        <AlertDialogCancel className="mt-0 border-slate-200 text-slate-600 h-10 rounded-xl">Batal</AlertDialogCancel>
                        <AlertDialogAction variant="danger"
                            className="bg-red-600 hover:bg-red-700 text-white h-10 rounded-xl"
                            onClick={handleReportIssue}
                        >
                            Kirim Laporan
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Close Confirmation Modal */}
            <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
                <AlertDialogContent className="technicianMobileConfirmDialog bg-white dark:bg-slate-900 border-none shadow-xl max-w-[80%] rounded-2xl p-6 z-[70]">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-slate-900 font-bold">Batalkan Proses?</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-500">
                           Data yang Anda masukkan (foto/teks) akan hilang jika Anda keluar sekarang.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex flex-col sm:flex-row gap-2 mt-2">
                        <AlertDialogCancel className="w-full sm:w-auto border-slate-200 mt-0 h-10 rounded-xl" onClick={() => setShowCloseConfirm(false)}>
                            Kembali Kerja
                        </AlertDialogCancel>
                        <AlertDialogAction variant="danger"
                            className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white h-10 rounded-xl"
                            onClick={() => {
                                setShowCloseConfirm(false);
                                onClose();
                            }}
                        >
                            Keluar & Hapus
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
                </>
            )}
        </AnimatePresence>
    );
}

// Subcomponent for Legend Item
function LegendItem({ color, label }: { color: string, label: string }) {
    return (
        <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full shadow-sm ring-1 ring-white ${color}`} />
            <span className="text-[10px] font-medium text-slate-600">{label}</span>
        </div>
    );
}
