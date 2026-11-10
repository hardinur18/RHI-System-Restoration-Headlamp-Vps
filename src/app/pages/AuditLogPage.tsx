import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { 
  Search, Filter, Download, Calendar, ArrowLeft, History, 
  CheckCircle, XCircle, Info, Wallet, FileText, User as UserIcon, Lock
} from 'lucide-react';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { useNavigate } from 'react-router';
import { cn } from '../components/ui/utils';
import { usePermissions } from '../hooks/usePermissions';
import { FilterRow } from '@/app/components/ui/control-layout';

export const AuditLogPage = ({ onBack }: { onBack?: () => void }) => {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canViewAuditLogs = hasPermission('audit_logs.view');
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  // Initial Fetch
  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE - 1);

      if (filterAction !== 'all') {
        query = query.ilike('action', `%${filterAction}%`);
      }
      
      if (searchTerm) {
        query = query.or(`details.ilike.%${searchTerm}%,user_name.ilike.%${searchTerm}%,entity.ilike.%${searchTerm}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      setLogs(data || []);
    } catch (err) {
      console.error("Error fetching logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canViewAuditLogs) {
      fetchLogs();
    }
  }, [page, filterAction, searchTerm, canViewAuditLogs]);

  const getActionColor = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('CREATE')) return "bg-green-100 text-green-700 border-green-200";
    if (act.includes('UPDATE')) return "bg-blue-100 text-blue-700 border-blue-200";
    if (act.includes('DELETE')) return "bg-red-100 text-red-700 border-red-200";
    if (act.includes('PAYMENT')) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const getIcon = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes('CREATE')) return <CheckCircle className="h-4 w-4" />;
    if (act.includes('UPDATE')) return <Info className="h-4 w-4" />;
    if (act.includes('DELETE')) return <XCircle className="h-4 w-4" />;
    if (act.includes('PAYMENT')) return <Wallet className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  if (!canViewAuditLogs) {
    return (
      <div className="flex h-[80vh] items-center justify-center flex-col gap-4 text-center p-8">
        <div className="bg-red-50 p-4 rounded-full text-red-600"><Lock className="w-12 h-12" /></div>
        <h1 className="text-2xl font-bold">Akses Dibatasi</h1>
        <p className="text-slate-500">Anda tidak memiliki izin untuk melihat audit log.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Button variant="ghost" className="pl-0 hover:bg-transparent -ml-2 mb-2" onClick={onBack || (() => navigate(-1))}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Kembali
          </Button>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <History className="w-6 h-6 text-slate-500" />
            Riwayat Aktivitas
          </h1>
          <p className="text-slate-500 mt-1">
            Log aktivitas pengguna dalam sistem.
          </p>
        </div>
        <div className="flex gap-2">
            <Button variant="outline" onClick={fetchLogs}>
                Refresh
            </Button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
        <FilterRow className="mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Cari aktivitas, user, atau detail..." 
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="w-full md:w-[200px]">
             <Select value={filterAction} onValueChange={setFilterAction}>
                <SelectTrigger>
                    <Filter className="w-4 h-4 mr-2 text-slate-400" />
                    <SelectValue placeholder="Filter Aksi" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Semua Aksi</SelectItem>
                    <SelectItem value="create">Create</SelectItem>
                    <SelectItem value="update">Update</SelectItem>
                    <SelectItem value="delete">Delete</SelectItem>
                    <SelectItem value="payment">Payment</SelectItem>
                    <SelectItem value="login">Login</SelectItem>
                </SelectContent>
             </Select>
          </div>
        </FilterRow>

        <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
            <Table>
                <TableHeader className="bg-slate-50 dark:bg-slate-900">
                    <TableRow>
                        <TableHead className="w-[180px]">Waktu</TableHead>
                        <TableHead className="w-[200px]">User</TableHead>
                        <TableHead className="w-[150px]">Aksi</TableHead>
                        <TableHead className="w-[150px]">Entitas</TableHead>
                        <TableHead>Detail Aktivitas</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                        <TableRow>
                            <TableCell colSpan={5} className="h-24 text-center">Memuat data...</TableCell>
                        </TableRow>
                    ) : logs.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={5} className="h-32 text-center text-slate-500">
                                Tidak ada aktivitas ditemukan.
                            </TableCell>
                        </TableRow>
                    ) : (
                        logs.map((log) => (
                            <TableRow key={log.id} className="hover:bg-slate-50/50">
                                <TableCell className="font-mono text-xs text-slate-500">
                                    {format(new Date(log.created_at), 'dd MMM yyyy, HH:mm', { locale: idLocale })}
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                                            <UserIcon className="w-3.5 h-3.5" />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-medium text-sm">{log.user_name}</span>
                                            <span className="text-[10px] text-slate-400 uppercase">{log.user_role}</span>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className={cn("gap-1 font-medium", getActionColor(log.action))}>
                                        {getIcon(log.action)}
                                        {log.action}
                                    </Badge>
                                </TableCell>
                                <TableCell className="font-medium text-slate-700 dark:text-slate-300">
                                    {log.entity}
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-400 text-sm">
                                    {log.details}
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>

        <div className="flex justify-between items-center mt-4">
            <Button 
                variant="outline" 
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
            >
                Sebelumnya
            </Button>
            <span className="text-sm text-slate-500">
                Halaman {page}
            </span>
            <Button 
                variant="outline"
                disabled={logs.length < ITEMS_PER_PAGE} 
                onClick={() => setPage(p => p + 1)}
            >
                Selanjutnya
            </Button>
        </div>
      </div>
    </div>
  );
};
