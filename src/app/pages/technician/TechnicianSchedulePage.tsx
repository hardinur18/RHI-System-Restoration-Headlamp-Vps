import React, { useState, useMemo } from 'react';
import { useMasterData } from '@/app/pages/master-data/context';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, isWeekend } from 'date-fns';
import { id } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '../../components/ui/avatar';
import { TechnicianSchedule } from '@/app/pages/master-data/context/MasterDataCtx';

import { Textarea } from '../../components/ui/textarea';
import { usePermissions } from '@/app/hooks/usePermissions';
import { Lock } from 'lucide-react';
import { isTechnicianRole } from '@/app/data/roleHelpers';
import { FilterRow } from '@/app/components/ui/control-layout';

export default function TechnicianSchedulePage() {
  const { users, branches, activeBranches, technicianSchedules, addSchedule, deleteSchedule } = useMasterData();
  const { hasPermission } = usePermissions();
  const canViewSchedule = hasPermission('technician_schedule.view');
  const canManageSchedule = hasPermission('technician_schedule.manage');
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  
  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ userId: string, date: Date, schedule?: TechnicianSchedule } | null>(null);
  const [reason, setReason] = useState('');
  const [leaveType, setLeaveType] = useState<'Libur' | 'Sakit' | 'Cuti' | 'Izin'>('Libur');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scheduleGridDragRef = React.useRef({
    active: false,
    dragging: false,
    pointerId: null as number | null,
    scrollLeft: 0,
    startX: 0,
  });
  const suppressScheduleCellClickRef = React.useRef(false);

  // Derived Data
  const daysInMonth = useMemo(() => {
    return eachDayOfInterval({
      start: startOfMonth(currentDate),
      end: endOfMonth(currentDate)
    });
  }, [currentDate]);

  const technicians = useMemo(() => {
    // Only Active Technicians
    let filtered = users.filter(u => isTechnicianRole(u.role) && u.status === 'active');
    
    if (selectedBranch !== 'all') {
      filtered = filtered.filter(u => u.branchId === selectedBranch);
    }
    return filtered;
  }, [users, selectedBranch]);

  const monthOffCount = useMemo(() => {
    const monthKeys = new Set(daysInMonth.map((day) => format(day, 'yyyy-MM-dd')));
    const visibleTechnicianIds = new Set(technicians.map((technician) => technician.id));
    return technicianSchedules.filter((schedule) =>
      monthKeys.has(schedule.date) && visibleTechnicianIds.has(schedule.userId)
    ).length;
  }, [daysInMonth, technicianSchedules, technicians]);

  const selectedBranchLabel = useMemo(() => {
    if (selectedBranch === 'all') return 'Semua cabang';
    return activeBranches.find((branch) => branch.id === selectedBranch)?.name || 'Cabang terpilih';
  }, [activeBranches, selectedBranch]);

  const getSchedule = (userId: string, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return technicianSchedules.find(s => s.userId === userId && s.date === dateStr);
  };

  const handleCellClick = (userId: string, date: Date) => {
    if (!canManageSchedule) return;

    const schedule = getSchedule(userId, date);
    setSelectedCell({ userId, date, schedule });
    setReason(schedule?.reason || '');
    setLeaveType(schedule?.type || 'Libur');
    setIsDialogOpen(true);
  };

  const resetScheduleGridDrag = (target: HTMLDivElement, pointerId?: number) => {
    if (pointerId !== undefined && target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    target.removeAttribute('data-dragging');
    scheduleGridDragRef.current.active = false;
    scheduleGridDragRef.current.dragging = false;
    scheduleGridDragRef.current.pointerId = null;
  };

  const handleScheduleGridPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;

    const scroller = event.currentTarget;
    if (scroller.scrollWidth <= scroller.clientWidth) return;

    suppressScheduleCellClickRef.current = false;
    scheduleGridDragRef.current = {
      active: true,
      dragging: false,
      pointerId: event.pointerId,
      scrollLeft: scroller.scrollLeft,
      startX: event.clientX,
    };
  };

  const handleScheduleGridPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = scheduleGridDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 8) {
      drag.dragging = true;
      suppressScheduleCellClickRef.current = true;
      if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      event.currentTarget.setAttribute('data-dragging', 'true');
      event.preventDefault();
      event.currentTarget.scrollLeft = drag.scrollLeft - deltaX;
    }
  };

  const handleScheduleGridPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = scheduleGridDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    if (drag.dragging) {
      suppressScheduleCellClickRef.current = true;
      window.setTimeout(() => {
        suppressScheduleCellClickRef.current = false;
      }, 0);
    }
    resetScheduleGridDrag(event.currentTarget, event.pointerId);
  };

  const handleSave = async () => {
    if (!canManageSchedule) return;
    if (!selectedCell) return;
    
    setIsSubmitting(true);
    const dateStr = format(selectedCell.date, 'yyyy-MM-dd');

    if (selectedCell.schedule) {
        // Delete existing (Toggle Off -> On)
        await deleteSchedule(selectedCell.userId, dateStr);
    } else {
        // Add new (Toggle On -> Off)
        await addSchedule({
            id: crypto.randomUUID(),
            userId: selectedCell.userId,
            date: dateStr,
            type: leaveType,
            reason: reason || leaveType, // Default to type if no reason
            createdAt: new Date().toISOString()
        });
    }
    
    setIsSubmitting(false);
    setIsDialogOpen(false);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const getLeaveShortLabel = (type?: string) => {
    switch (type) {
      case 'Sakit':
        return 'Skt';
      case 'Cuti':
        return 'Cti';
      case 'Izin':
        return 'Izn';
      default:
        return 'Off';
    }
  };

  if (!canViewSchedule) {
    return (
      <div className="flex h-[80vh] items-center justify-center flex-col gap-4 text-center p-8">
        <div className="bg-red-50 p-4 rounded-full text-red-600"><Lock className="w-12 h-12" /></div>
        <h1 className="text-2xl font-bold">Akses Dibatasi</h1>
        <p className="text-slate-500">Anda tidak memiliki izin untuk membuka ketersediaan teknisi.</p>
      </div>
    );
  }

  return (
    <div className="technicianSchedulePage">
      <div className="technicianScheduleShell">
        
        {/* Header */}
        <div className="technicianScheduleHeader">
          <div className="technicianScheduleTitleBlock">
            <div className="eyebrowLine">
              <CalendarIcon className="w-6 h-6 text-blue-600" />
              TEKNISI & LAPANGAN
            </div>
            <h1>
              Jadwal Ketersediaan Teknisi
            </h1>
            <p>
              Kelola hari libur dan ketersediaan teknisi per cabang.
            </p>
            {!canManageSchedule && (
              <p className="technicianScheduleReadonly">Mode lihat saja. Perubahan jadwal dikunci.</p>
            )}
          </div>
          
          <div className="technicianScheduleMonthNav">
             <Button variant="ghost" size="icon" className="technicianScheduleMonthButton" onClick={() => setCurrentDate(subMonths(currentDate, 1))}>
                <ChevronLeft className="w-4 h-4" />
             </Button>
             <span>
                {format(currentDate, 'MMMM yyyy', { locale: id })}
             </span>
             <Button variant="ghost" size="icon" className="technicianScheduleMonthButton" onClick={() => setCurrentDate(addMonths(currentDate, 1))}>
                <ChevronRight className="w-4 h-4" />
             </Button>
          </div>
        </div>

        {/* Toolbar & Legend */}
        <FilterRow className="technicianScheduleToolbar">
            <div className="technicianScheduleFilterControl">
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger className="technicianScheduleSelect">
                    <SelectValue placeholder="Pilih Cabang" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Cabang</SelectItem>
                    {activeBranches.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
            </div>

            <div className="technicianScheduleSummary">
              <span>{technicians.length} teknisi</span>
              <span>{monthOffCount} hari libur</span>
              <span>{selectedBranchLabel}</span>
            </div>
            
            <div className="technicianScheduleLegend">
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm bg-white border border-slate-200"></div>
                    <span>Masuk</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm bg-red-100 border border-red-200"></div>
                    <span>Libur (Off)</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm bg-slate-100 border border-slate-200"></div>
                    <span>Akhir Pekan</span>
                </div>
            </div>
        </FilterRow>

        {/* Scheduler Grid */}
        <div className="technicianScheduleGridCard">
            <div
              className="technicianScheduleScroller"
              onPointerDown={handleScheduleGridPointerDown}
              onPointerMove={handleScheduleGridPointerMove}
              onPointerUp={handleScheduleGridPointerEnd}
              onPointerCancel={handleScheduleGridPointerEnd}
            >
                <table className="technicianScheduleTable">
                    <thead>
                        <tr>
                            <th className="technicianScheduleStickyHeader">
                                Teknisi
                            </th>
                            {daysInMonth.map(day => (
                                <th key={day.toString()} className={`technicianScheduleDayHeader ${isSameDay(day, new Date()) ? 'is-today' : ''}`}>
                                    <div className="flex flex-col items-center gap-1">
                                        <span className="opacity-50 text-[10px]">{format(day, 'EEE', { locale: id })}</span>
                                        <span>{format(day, 'd')}</span>
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {technicians.length === 0 ? (
                            <tr>
                                <td colSpan={daysInMonth.length + 1} className="p-8 text-center text-slate-500 text-sm">
                                    Tidak ada teknisi ditemukan untuk cabang ini.
                                </td>
                            </tr>
                        ) : (
                            technicians.map(tech => (
                                <tr key={tech.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="technicianScheduleStickyCell">
                                        <div className="technicianSchedulePerson">
                                            <Avatar className="h-8 w-8 border border-slate-200">
                                                <AvatarImage src={tech.avatar || ''} />
                                                <AvatarFallback className="bg-slate-100 text-xs">{getInitials(tech.name)}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex flex-col">
                                                <span className="technicianSchedulePersonName">{tech.name}</span>
                                                <span className="technicianSchedulePersonBranch">
                                                    {branches.find(b => b.id === tech.branchId)?.name || 'Pusat'}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    {daysInMonth.map(day => {
                                        const schedule = getSchedule(tech.id, day);
                                        const isOff = !!schedule;
                                        const isWknd = isWeekend(day);
                                        
                                        return (
                                            <td 
                                                key={day.toString()} 
                                                className={`technicianScheduleDayCell ${canManageSchedule ? 'is-editable' : ''} ${isOff ? 'is-off' : ''} ${!isOff && isWknd ? 'is-weekend' : ''}`}
                                                onClick={(event) => {
                                                    if (suppressScheduleCellClickRef.current || scheduleGridDragRef.current.dragging) {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        suppressScheduleCellClickRef.current = false;
                                                        return;
                                                    }
                                                    handleCellClick(tech.id, day);
                                                }}
                                            >
                                                {isOff && (
                                                    <div className="technicianScheduleCellStatus animate-in fade-in zoom-in duration-200">
                                                        <div className="technicianScheduleStatusChip">
                                                            <span className="technicianScheduleStatusFull">{schedule.type || 'OFF'}</span>
                                                            <span className="technicianScheduleStatusShort">{getLeaveShortLabel(schedule.type)}</span>
                                                        </div>
                                                        {schedule.reason && (
                                                            <span className="technicianScheduleStatusReason">
                                                                {schedule.reason}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
      </div>

      {/* Action Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="technicianScheduleDialog masterDataFormDialogContent">
            <DialogHeader className="masterDataFormHeader">
                <DialogTitle>
                    {selectedCell?.schedule ? 'Batalkan Hari Libur?' : 'Set Jadwal Libur'}
                </DialogTitle>
                <DialogDescription>
                    {selectedCell && (
                        <span>
                            Teknisi: <b>{users.find(u => u.id === selectedCell.userId)?.name}</b><br/>
                            Tanggal: {format(selectedCell.date, 'EEEE, d MMMM yyyy', { locale: id })}
                        </span>
                    )}
                </DialogDescription>
            </DialogHeader>
            
            {!selectedCell?.schedule && (
                <div className="technicianScheduleDialogBody masterDataDialogBody">
                    <div className="space-y-2">
                        <Label>Tipe Absen</Label>
                        <Select value={leaveType} onValueChange={(val: any) => setLeaveType(val)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Pilih Tipe" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Libur">Libur</SelectItem>
                                <SelectItem value="Sakit">Sakit</SelectItem>
                                <SelectItem value="Cuti">Cuti</SelectItem>
                                <SelectItem value="Izin">Izin</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    
                    <div className="space-y-2">
                        <Label>Alasan / Keterangan</Label>
                        <Textarea 
                            placeholder="Contoh: Acara keluarga, sakit demam, dll..." 
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                        />
                    </div>
                </div>
            )}

            {selectedCell?.schedule && (
                 <div className="technicianScheduleCurrentStatus">
                    Status saat ini: <span className="font-semibold text-red-600">{selectedCell.schedule.type.toUpperCase()}</span>
                    <br/>
                    Keterangan: {selectedCell.schedule.reason || '-'}
                 </div>
            )}

            <DialogFooter className="technicianScheduleDialogFooter masterDataFormActions">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Batal</Button>
                <Button 
                    variant={selectedCell?.schedule ? "destructive" : "default"}
                    onClick={handleSave}
                    disabled={isSubmitting || !canManageSchedule}
                >
                    {isSubmitting ? 'Menyimpan...' : (selectedCell?.schedule ? 'Hapus Status Libur' : 'Simpan Jadwal Libur')}
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
