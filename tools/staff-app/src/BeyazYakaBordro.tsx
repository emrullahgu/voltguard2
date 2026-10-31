import { useAuth } from './SimpleAuth';
import { canManagePayroll } from './PortalNavigation';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, 
  FileSpreadsheet, 
  Save, 
  PlusCircle, 
  Trash2, 
  Banknote, 
  Calendar,
  Download,
  Building,
  Mail,
  Phone,
  UserPlus,
  Edit,
  Calculator,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  X,
  Clock,
  Upload,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  LayoutGrid,
  List
} from 'lucide-react';
import { supabase } from './supabaseClient';
import { parseDecimal, localISODate, monthlyAdvanceAmount } from './operations.mjs';
import { buildPayrollSaveRequest, isPayrollConflict } from './payrollPersistence.mjs';
import ActivityLogger from './activityLogger';
import { createReportPDF, writeReportParagraph, reportFileName, reportMoney, reportDate, reportNumber } from './pdfReport';
import * as XLSX from 'xlsx';

// --- SABİTLER ---
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// --- TİP TANIMLAMALARI ---
type DayType = 'Normal' | 'Pazar' | 'Resmi Tatil' | 'Raporlu' | 'ızinli' | 'Gelmedi';

interface DailyLog {
  day: number;
  type: DayType;
  startTime: string;
  endTime: string;
  overtimeHours: number;
  description: string;
}

interface Expense {
  id: string;
  type: 'Avans' | 'Gider' | 'Prim';
  amount: number;
  description: string;
  date: string;
  installment_total?: number;
  installment_current?: number;
}

interface Employee {
  id: string;
  name: string;
  tc_no?: string;
  email?: string;
  phone?: string;
  position?: string;
  department?: string;
  start_date: string;
  monthly_salary: number;
  gross_salary?: number;
  sgk_base?: number;
  bank_name?: string;
  iban?: string;
  active: boolean;
  user_id?: string | null;
}

interface MonthlyPayroll {
  id?: string;
  updated_at?: string;
  created_at?: string;
  employee_id: string;
  month: number;
  year: number;
  base_salary: number;
  overtime_pay: number;
  bonus: number;
  meal_allowance: number;
  transport_allowance: number;
  other_earnings: number;
  advance_deduction: number;
  sgk_employee: number;
  unemployment_employee: number;
  income_tax: number;
  stamp_tax: number;
  other_deductions: number;
  net_payment: number;
  sgk_employer: number;
  unemployment_employer: number;
  total_employer_cost: number;
  worked_days: number;
  total_days: number;
  paid_leave_days: number;
  unpaid_leave_days: number;
  sick_leave_days: number;
  payment_date?: string;
  payment_method?: string;
  is_paid: boolean;
  notes?: string;
  logs?: Record<number, DailyLog>;  // Günlük kayıtlar
  expenses?: Expense[];  // Avans/Gider/Prim kayıtları
}

interface Advance {
  id?: string;
  employee_id: string;
  amount: number;
  advance_date: string;
  description?: string;
  installment_count: number;
  remaining_installments: number;
  monthly_deduction: number;
  is_fully_paid: boolean;
}

// --- YARDIMCI FONKSİYONLAR ---
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('tr-TR', { 
    style: 'currency', 
    currency: 'TRY', 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).format(amount);
};

const getDaysInMonth = (month: number, year: number) => {
  return new Date(year, month + 1, 0).getDate();
};

const getDayName = (day: number, month: number, year: number) => {
  const date = new Date(year, month, day);
  return date.toLocaleDateString('tr-TR', { weekday: 'long' });
};

const isWeekend = (day: number, month: number, year: number) => {
  const date = new Date(year, month, day);
  const dayIndex = date.getDay();
  return { isSaturday: dayIndex === 6, isSunday: dayIndex === 0 };
};

// UUID doırulama fonksiyonu
const isValidUUID = (str: string | null | undefined): boolean => {
  if (!str) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return /^s[a-f0-9]{24}$/i.test(str) || uuidRegex.test(str);
};

// --- ANA COMPONENT ---
const BeyazYakaBordro: React.FC = () => {
  const { currentUser } = useAuth();
  const canManage = canManagePayroll(currentUser);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [payrollData, setPayrollData] = useState<MonthlyPayroll | null>(null);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const summaryExportInFlight = useRef(false);
  const [exportingSummary, setExportingSummary] = useState(false);
  const expenseSaveInFlight = useRef(false);
  const expenseRequestRef = useRef<{ id: string; fingerprint: string } | null>(null);
  const [payrollDirty, setPayrollDirty] = useState(false);
  const [payrollConflict, setPayrollConflict] = useState(false);
  const payrollConflictRef = useRef(false);
  const payrollWriteInFlight = useRef(false);
  const payrollSnapshotRef = useRef<MonthlyPayroll | null>(null);
  const payrollDirtyRef = useRef(false);
  const payrollEditVersion = useRef(0);
  const dailyLogsRef = useRef<Record<number, DailyLog>>({});
  const dailyLogsDirtyRef = useRef(false);
  const payrollContextRef = useRef('');
  const [activeTab, setActiveTab] = useState<'summary' | 'detail'>('summary');
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const currentUserId = currentUser?.approved ? currentUser.id : null;
  const isAdmin = canManage;
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [logo, setLogo] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [dailyLogs, setDailyLogs] = useState<Record<number, DailyLog>>({});
  const [expensesList, setExpensesList] = useState<Expense[]>([]);
  payrollSnapshotRef.current = payrollData;
  payrollDirtyRef.current = payrollDirty;
  dailyLogsRef.current = dailyLogs;
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [employeeForm, setEmployeeForm] = useState({
    name: '',
    tc_no: '',
    email: '',
    phone: '',
    position: '',
    department: '',
    start_date: localISODate(),
    monthly_salary: '',
    gross_salary: '',
    sgk_base: '',
    bank_name: '',
    iban: ''
  });

  const [advanceForm, setAdvanceForm] = useState({
    amount: '',
    date: localISODate(),
    description: '',
    type: 'Avans' as 'Avans' | 'Gider' | 'Prim',
    installment_total: '1',
    installment_current: '1'
  });

  const daysInMonth = getDaysInMonth(currentMonth, currentYear);
  payrollContextRef.current = `${selectedEmployeeId}:${currentYear}:${currentMonth}`;

  const selectedEmployee = useMemo(() => 
    employees.find(e => e.id === selectedEmployeeId),
    [employees, selectedEmployeeId]
  );

  // Maaş bilgisini maskele
  const maskSalary = (employee: Employee): string => {
    if (isAdmin || employee.user_id === currentUserId) {
      return formatCurrency(employee.monthly_salary);
    }
    return '****';
  };

  // Detaylı bilgileri göster/maskele
  const canViewDetails = (employee: Employee): boolean => {
    return isAdmin || employee.user_id === currentUserId;
  };


  // Kullanıcı bilgileri yüklendikten sonra available users'ı yükle
  useEffect(() => {
    if (currentUserId !== null) {
      loadAvailableUsers();
    }
  }, [currentUserId, isAdmin]);

  // çalışanları yükle
  useEffect(() => {
    if (currentUserId !== null) {
      loadEmployees();
    }
  }, [currentUserId]);

  // Kayıtlı kullanıcıları yükle - Mevcut çalışanlardan benzersiz kullanıcıları al
  const loadAvailableUsers = async () => {
    try {
      if (isAdmin) {
        // Admin için: Sistemdeki tüm onaylı kullanıcıları users tablosundan çek
        const { data: usersData, error: usersError } = await supabase
          .from('users')
          .select('id, name, email, company, role')
          .eq('approved', true)
          .order('name');
        
        if (usersError) throw usersError;
        
        // Kullanıcıları uygun formata dönüştür
        const formattedUsers = usersData?.map(user => ({
          id: user.id,
          email: user.email || '',
          user_metadata: { 
            full_name: user.name,
            company: user.company,
            role: user.role
          }
        })) || [];
        
        setAvailableUsers(formattedUsers);
      } else {
        // Normal kullanıcı için: Sadece kendi bilgilerini göster
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setAvailableUsers([{
            id: user.id,
            email: user.email || '',
            user_metadata: { full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || '' }
          }]);
        } else {
          setAvailableUsers([]);
        }
      }
    } catch (error) {
      console.error('Kullanıcılar yüklenirken hata:', error);
      // Hata durumunda eski yöntemle dene (beyaz_yaka_employees'den)
      try {
        if (isAdmin) {
          const { data: employeesData, error: empError } = await supabase
            .from('beyaz_yaka_employees')
            .select('user_id, name, email')
            .not('user_id', 'is', null);
          
          if (empError) throw empError;
          
          const uniqueUsers = employeesData
            ?.filter((emp, index, self) => 
              emp.user_id && isValidUUID(emp.user_id) && self.findIndex(e => e.user_id === emp.user_id) === index
            )
            .map(emp => ({
              id: emp.user_id,
              email: emp.email || '',
              user_metadata: { full_name: emp.name }
            })) || [];
          
          setAvailableUsers(uniqueUsers);
        } else {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            setAvailableUsers([{
              id: user.id,
              email: user.email || '',
              user_metadata: { full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || '' }
            }]);
          } else {
            setAvailableUsers([]);
          }
        }
      } catch (fallbackError) {
        console.error('Fallback kullanıcı yükleme de başarısız:', fallbackError);
        setAvailableUsers([]);
      }
    }
  };

  // Kullanıcı seçildiçinde form alanlarını doldur
  const handleUserSelect = (userId: string) => {
    if (!canManage) return;
    setSelectedUserId(userId);
    if (editingEmployee) return; // Changing account ownership must not replace the employee's existing name/email.
    const user = availableUsers.find(u => u.id === userId);
    if (user) {
      setEmployeeForm(prev => ({
        ...prev,
        email: user.email || prev.email,
        name: user.user_metadata?.full_name || user.email?.split('@')[0] || prev.name
      }));
    }
  };

  // Seçili çalışan değitiçinde veri yükle
  useEffect(() => {
    if (selectedEmployeeId) {
      loadPayrollData();
    }
  }, [selectedEmployeeId, currentMonth, currentYear]);

  const loadEmployees = async () => {
    try {
      setLoading(true);
      
      
      const { data, error } = await supabase
        .from('beyaz_yaka_employees')
        .select('*')
        .eq('active', true)
        .order('name');

      if (error) { showMessage('error', 'Çalışan bilgileri yüklenemedi. Bağlantı ve bordro yetkilerinizi kontrol edin.'); throw error; }

      
      setEmployees(data || []);
      
      if (data && data.length > 0 && !selectedEmployeeId) {
        setSelectedEmployeeId(data[0].id);
      }
    } catch (error) {
      console.error('? çalışan yükleme hatası:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPayrollData = async () => {
    const requestedContext = `${selectedEmployeeId}:${currentYear}:${currentMonth}`;
    setPayrollData(null);setDailyLogs({});setExpensesList([]);
    payrollConflictRef.current=false;setPayrollConflict(false);
    dailyLogsDirtyRef.current=false;
    try {
      const employeeAdvances = await loadAdvances();
      const { data, error } = await supabase
        .from('beyaz_yaka_monthly_payroll')
        .select('*')
        .eq('employee_id', selectedEmployeeId)
        .eq('month', currentMonth)
        .eq('year', currentYear)
        .maybeSingle();
      
      if (error) throw error;
      if (payrollContextRef.current !== requestedContext) return;
      if (data) {
        setPayrollData(data);
        setPayrollDirty(false);
        setDailyLogs(data.logs || {});
        // Expenses bilgisini yükle
        setExpensesList(data.expenses || []);
      } else {
        // Yeni bordro oluştur
        const employee = employees.find(e => e.id === selectedEmployeeId);
        if (employee) {
          const newPayroll = createDefaultPayroll(employee, employeeAdvances);
          setPayrollData(newPayroll);
          setPayrollDirty(false);
          setDailyLogs({});
          setExpensesList([]);
        }
      }
    } catch (error) {
      console.error('Bordro verisi yüklenirken hata:', error);
      if (payrollContextRef.current !== requestedContext) return;
      setPayrollData(null);
      setDailyLogs({});
      setExpensesList([]);
      showMessage('error', 'Bordro yüklenemedi. Bağlantı ve yetkilerinizi kontrol edin.');
    }
  };

  const createDefaultPayroll = (employee: Employee, employeeAdvances: Advance[] = advances): MonthlyPayroll => {
    const baseAmount = parseDecimal(employee.gross_salary ?? employee.monthly_salary);
    
    // Avansları hesapla
    const monthlyAdvanceDeduction = employeeAdvances
      .filter(advance => advance.employee_id === employee.id)
      .reduce((sum, advance) => sum + monthlyAdvanceAmount(advance, currentYear, currentMonth), 0);

    return {
      employee_id: employee.id,
      month: currentMonth,
      year: currentYear,
      base_salary: baseAmount,
      overtime_pay: 0,
      bonus: 0,
      meal_allowance: 0,
      transport_allowance: 0,
      other_earnings: 0,
      advance_deduction: monthlyAdvanceDeduction,
      sgk_employee: 0,
      unemployment_employee: 0,
      income_tax: 0,
      stamp_tax: 0,
      other_deductions: 0,
      net_payment: baseAmount - monthlyAdvanceDeduction,
      sgk_employer: 0,
      unemployment_employer: 0,
      total_employer_cost: baseAmount,
      worked_days: 30,
      total_days: 30,
      paid_leave_days: 0,
      unpaid_leave_days: 0,
      sick_leave_days: 0,
      is_paid: false,
      notes: 'İç ödeme kaydı. Vergi ve SGK tutarları muhasebe bordrosuna göre manuel girilmelidir.'
    };
  };

  const loadAdvances = async () => {
    const requestedEmployee = selectedEmployeeId;
    try {
      const { data, error } = await supabase
        .from('beyaz_yaka_advances')
        .select('*')
        .eq('employee_id', selectedEmployeeId)
        .eq('is_fully_paid', false)
        .order('advance_date', { ascending: false });
      
      if (error) throw error;
      if (payrollContextRef.current.startsWith(requestedEmployee + ':')) setAdvances(data || []);
      return data || [];
    } catch (error) {
      console.error('Avanslar yüklenirken hata:', error);
      showMessage('error', 'Avanslar yüklenemedi; yeni bordro oluşturulmadı.');
      throw error;
    }
  };

  const saveEmployee = async () => {
    if (!canManage) return;
    if (!employeeForm.name.trim() || !(parseDecimal(employeeForm.monthly_salary, null) > 0)) {
      showMessage('error', 'Ad ve maaş bilgisi zorunludur');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Seçili kullanıcı varsa ve geıerli UUID ise onu kullan, yoksa mevcut kullanıcıyı (admin) kullan
      const assignedUserId = (selectedUserId && isValidUUID(selectedUserId)) ? selectedUserId : (isAdmin ? null : user?.id);
      
      const employeeData = {
        name: employeeForm.name,
        tc_no: employeeForm.tc_no || null,
        email: employeeForm.email || null,
        phone: employeeForm.phone || null,
        position: employeeForm.position || null,
        department: employeeForm.department || null,
        start_date: employeeForm.start_date,
        monthly_salary: parseDecimal(employeeForm.monthly_salary),
        gross_salary: employeeForm.gross_salary ? parseDecimal(employeeForm.gross_salary, null) : null,
        sgk_base: employeeForm.sgk_base ? parseDecimal(employeeForm.sgk_base, null) : null,
        bank_name: employeeForm.bank_name || null,
        iban: employeeForm.iban || null,
        user_id: assignedUserId
      };

      if (editingEmployee) {
        const { error } = await supabase
          .from('beyaz_yaka_employees')
          .update(employeeData)
          .eq('id', editingEmployee.id).select('id').single();
        
        if (error) throw error;
        showMessage('success', 'çalışan güncellendi');
      } else {
        const { error } = await supabase
          .from('beyaz_yaka_employees')
          .insert([employeeData]);
        
        if (error) throw error;
        showMessage('success', 'Yeni çalışan eklendi');
      }
      
      setShowEmployeeModal(false);
      setEditingEmployee(null);
      setSelectedUserId('');
      resetEmployeeForm();
      loadEmployees();
    } catch (error) {
      console.error('çalışan kaydedilirken hata:', error);
      showMessage('error', 'İşlem başarısız oldu');
    } finally {
      setLoading(false);
    }
  };

  const savePayroll = async () => {
    if (!canManage) return;
    const snapshot=payrollSnapshotRef.current;
    if (!snapshot) return false;
    if(payrollWriteInFlight.current){showMessage('error','Diğer bordro kaydının tamamlanmasını bekleyin.');return false;}
    if(payrollConflictRef.current){showMessage('error','Bordro değişmiş. Güncel dönemi yeniden yükleyip yerel değişikliklerinizi karşılaştırın.');return false;}
    const requestedContext = `${selectedEmployeeId}:${currentYear}:${currentMonth}`;
    if (snapshot.employee_id !== selectedEmployeeId || snapshot.month !== currentMonth || snapshot.year !== currentYear) { showMessage('error','Güncel dönem bordrosunun yüklenmesini bekleyin.');return false; }
    if(saveTimeoutRef.current){clearTimeout(saveTimeoutRef.current);saveTimeoutRef.current=null;}
    payrollWriteInFlight.current=true;
    const editVersion=payrollEditVersion.current;
    setLoading(true);
    try {
      if (Object.values(snapshot).some(value => typeof value === 'number' && !Number.isFinite(value))) throw new Error('Bordroda geçersiz sayı var.');
      const {data,error}=await supabase.rpc('app_beyaz_yaka_payroll_save',buildPayrollSaveRequest(snapshot,dailyLogsRef.current));
      if(error)throw error;
      if(!data?.id || !data.updated_at)throw new Error('Sunucu bordro sürümünü doğrulamadı. Güncel dönemi yeniden yükleyin.');
      if (payrollContextRef.current !== requestedContext) return true;
      if(payrollEditVersion.current===editVersion){payrollSnapshotRef.current=data;setPayrollData(data);setDailyLogs(data.logs||{});setPayrollDirty(false);dailyLogsDirtyRef.current=false;}
      else {setPayrollData(previous=>previous?{...previous,id:data.id,updated_at:data.updated_at,expenses:data.expenses}:data);setPayrollDirty(true);}
      setExpensesList(data.expenses||[]);
      setSaveStatus('saved');
      showMessage('success', payrollEditVersion.current===editVersion?'Bordro ve puantaj kaydedildi':'Gönderilen bordro kaydedildi; işlem sırasında yaptığınız yeni değişiklikleri ayrıca kaydedin.');
      return true;
    } catch (error) {
      console.error('Bordro kaydedilirken hata:', error);
      if(payrollContextRef.current===requestedContext){
        if(isPayrollConflict(error)){payrollConflictRef.current=true;setPayrollConflict(true);}
        setSaveStatus('error');showMessage('error',(error as any)?.message||'Bordro kaydedilemedi; yerel değişiklikleriniz korunuyor.');
      }
      return false;
    } finally {
      payrollWriteInFlight.current=false;
      setLoading(false);
    }
  };

  const saveAdvance = async () => {
    if (!canManage) return;
    const requestedContext = `${selectedEmployeeId}:${currentYear}:${currentMonth}`;
    if (expenseSaveInFlight.current) return;
    const amount = parseDecimal(advanceForm.amount, null);
    const installments = Number(advanceForm.installment_total);
    if (!selectedEmployeeId || !(amount > 0) || !Number.isInteger(installments) || installments < 1 || installments > 120) {
      showMessage('error', 'Geçerli tutar ve 1–120 arası tam sayı taksit adedi girin.'); return;
    }
    expenseSaveInFlight.current = true;
    setLoading(true);
    try {
      if (payrollDirtyRef.current || dailyLogsDirtyRef.current || payrollConflictRef.current || payrollWriteInFlight.current) throw new Error('Önce yerel bordro/puantaj değişikliklerini kaydedin; çakışma varsa güncel dönemi yeniden yükleyin.');
      if (!payrollSnapshotRef.current?.id && !await savePayroll()) throw new Error('Önce bordro kaydının başarıyla kaydedilmesi gerekir.');
      const payload = {
        p_employee_id: selectedEmployeeId, p_month: currentMonth, p_year: currentYear,
        p_type: advanceForm.type, p_amount: Math.round(amount * 100) / 100, p_date: advanceForm.date,
        p_installments: advanceForm.type === 'Avans' ? installments : 1, p_description: advanceForm.description || ''
      };
      const fingerprint = JSON.stringify(payload);
      if (expenseRequestRef.current?.fingerprint !== fingerprint) expenseRequestRef.current = { id: crypto.randomUUID(), fingerprint };
      const { data, error } = await supabase.rpc('app_beyaz_yaka_expense_save', { ...payload, p_request_id: expenseRequestRef.current.id });
      if (error) throw error;
      if (payrollContextRef.current !== requestedContext) { expenseRequestRef.current=null;return; }
      setPayrollData(data);
      payrollSnapshotRef.current=data;
      setDailyLogs(data.logs||{});
      setPayrollDirty(false);
      setExpensesList(data.expenses || []);
      expenseRequestRef.current = null;
      let refreshed=true;
      try { await loadAdvances(); } catch { refreshed=false; }
      setShowAdvanceModal(false);
      resetAdvanceForm();
      showMessage('success', refreshed ? 'Gider/avans ve bordro tek işlemde kaydedildi.' : 'Gider/avans kaydedildi; taksit listesi yenilenemedi. Kaydı tekrar eklemeyin, listeyi yeniden açın.');
    } catch (error) {
      console.error('Gider/avans kaydedilemedi:', error);
      showMessage('error', error instanceof Error ? error.message : 'Gider/avans kaydedilemedi. Verileriniz formda korunuyor; bağlantıyı kontrol ederek yeniden deneyin.');
    } finally { expenseSaveInFlight.current = false; setLoading(false); }
  };

  const deleteExpense = async (expenseId: string) => {
    if (!canManage) return;
    const requestedContext = `${selectedEmployeeId}:${currentYear}:${currentMonth}`;
    if (!confirm('Bu gider/avans kaydını ve bu ay bordroya uygulanan tutarı kaldırmak istiyor musunuz?')) return;
    let ownsExpenseLock=false;
    try {
      if (payrollDirtyRef.current || dailyLogsDirtyRef.current || payrollConflictRef.current || payrollWriteInFlight.current || expenseSaveInFlight.current) throw new Error('Önce yerel bordro/puantaj değişikliklerini kaydedin; çakışma varsa güncel dönemi yeniden yükleyin.');
      expenseSaveInFlight.current=true;ownsExpenseLock=true;
      const { data, error } = await supabase.rpc('app_beyaz_yaka_expense_delete', {
        p_employee_id: selectedEmployeeId, p_month: currentMonth, p_year: currentYear, p_expense_id: expenseId
      });
      if (error) throw error;
      if (payrollContextRef.current !== requestedContext) return;
      setPayrollData(data);
      payrollSnapshotRef.current=data;
      setDailyLogs(data.logs||{});
      setExpensesList(data.expenses || []);
      let refreshed=true;try{await loadAdvances();}catch{refreshed=false;}
      showMessage('success', refreshed ? 'Kayıt ve bu ay uygulanan tutar kaldırıldı.' : 'Kayıt kaldırıldı; taksit listesi yenilenemedi. Listeyi yeniden açın.');
    } catch (error) { console.error('Gider/avans silinemedi:', error); showMessage('error',(error as any)?.message||'Silme işlemi tamamlanamadı.'); }
    finally {if(ownsExpenseLock)expenseSaveInFlight.current=false;}
  };

  // Günlük kayıt yönetimi
  useEffect(() => {
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [selectedEmployeeId, currentMonth, currentYear]);

  const handleLogChange = (day: number, field: keyof DailyLog, value: any) => {
    if (!canManage) return;
    if(expenseSaveInFlight.current){showMessage('error','Gider/avans işleminin tamamlanmasını bekleyin.');return;}
    const updatedLogs = { ...dailyLogs, [day]: {
      ...dailyLogs[day], day, type: dailyLogs[day]?.type || 'Normal',
      startTime: dailyLogs[day]?.startTime || '', endTime: dailyLogs[day]?.endTime || '',
      overtimeHours: dailyLogs[day]?.overtimeHours || 0, description: dailyLogs[day]?.description || '', [field]: value
    } };
    setDailyLogs(updatedLogs);
    dailyLogsRef.current=updatedLogs;dailyLogsDirtyRef.current=true;payrollEditVersion.current++;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaveStatus('saving');
    if(!payrollConflictRef.current)saveTimeoutRef.current = setTimeout(() => saveDailyLog(updatedLogs), 1500);
    else {setSaveStatus('error');showMessage('error','Puantaj yerel olarak korunuyor. Güncel dönemi yeniden yükleyip karşılaştırmadan otomatik kayıt yapılmaz.');}
  };

  const saveDailyLog = async (logs: Record<number, DailyLog>) => {
    if (!canManage) return;
    const requestedContext = `${selectedEmployeeId}:${currentYear}:${currentMonth}`;
    if (payrollContextRef.current !== requestedContext) return;
    const snapshot=payrollSnapshotRef.current;
    if (!snapshot || !selectedEmployeeId || payrollConflictRef.current) { setSaveStatus('error'); return; }
    if(payrollWriteInFlight.current || expenseSaveInFlight.current){setSaveStatus('error');showMessage('error','Başka bir bordro işlemi sürüyor. Puantajınız korunuyor; işlem tamamlanınca Kaydet düğmesini kullanın.');return;}
    payrollWriteInFlight.current=true;
    const editVersion=payrollEditVersion.current;
    try {
      const {data,error}=await supabase.rpc('app_beyaz_yaka_payroll_save',buildPayrollSaveRequest(snapshot,logs,{logsOnly:Boolean(snapshot.id)}));
      if(error)throw error;
      if(!data?.id || !data.updated_at)throw new Error('Sunucu bordro sürümünü doğrulamadı.');
      if (payrollContextRef.current !== requestedContext) return;
      if(payrollDirtyRef.current || payrollEditVersion.current!==editVersion){setPayrollData(previous=>previous?{...previous,id:data.id,updated_at:data.updated_at,expenses:data.expenses,logs:data.logs}:data);}
      else {payrollSnapshotRef.current=data;setPayrollData(data);}
      setExpensesList(data.expenses||[]);
      if(payrollEditVersion.current===editVersion)dailyLogsDirtyRef.current=false;
      setSaveStatus(payrollEditVersion.current===editVersion?'saved':'error');
    } catch (error) {
      console.error('Günlük kayıt kaydedilemedi:', error);
      if (payrollContextRef.current !== requestedContext) return;
      if(isPayrollConflict(error)){payrollConflictRef.current=true;setPayrollConflict(true);}
      setSaveStatus('error');
      showMessage('error',(error as any)?.message||'Puantaj kaydedilemedi. Değişiklikler bu ekranda duruyor; bağlantıyı kontrol edip Kaydet düğmesini kullanın.');
    } finally {payrollWriteInFlight.current=false;}
  };

  const fillMonthDefaults = () => {
    if (!canManage) return;
    if(expenseSaveInFlight.current || payrollWriteInFlight.current || payrollConflictRef.current){showMessage('error','Önce devam eden kaydı tamamlayın; çakışma varsa güncel dönemi yeniden yükleyin.');return;}
    const newLogs: Record<number, DailyLog> = {};
    for (let i = 1; i <= daysInMonth; i++) {
      if (!dailyLogs[i] || !dailyLogs[i].type) {
        const { isSaturday, isSunday } = isWeekend(i, currentMonth, currentYear);
        newLogs[i] = {
          day: i,
          type: 'Normal',
          startTime: '08:00',
          endTime: isSunday || isSaturday ? '08:00' : '18:00',
          overtimeHours: 0,
          description: ''
        };
      }
    }
    const logs = { ...dailyLogs, ...newLogs };
    setDailyLogs(logs);
    dailyLogsRef.current=logs;dailyLogsDirtyRef.current=true;payrollEditVersion.current++;
    setSaveStatus('saving');
    void saveDailyLog(logs);
  };

  const deleteAdvance = async (advanceId: string) => {
    if (!canManage) return;
    if (!confirm('Bu avansı silmek istediçinizden emin misiniz?')) return;
    
    let ownsExpenseLock=false;
    try {
      if(payrollDirtyRef.current || dailyLogsDirtyRef.current || payrollConflictRef.current || payrollWriteInFlight.current || expenseSaveInFlight.current)throw new Error('Önce yerel bordro/puantaj değişikliklerini kaydedin; çakışma varsa güncel dönemi yeniden yükleyin.');
      expenseSaveInFlight.current=true;ownsExpenseLock=true;
      const { error } = await supabase.rpc('app_beyaz_yaka_advance_delete',{p_advance_id:advanceId});
      
      if (error) throw error;
      
      showMessage('success', 'Avans silindi');
      await loadPayrollData();
    } catch (error) {
      console.error('Avans silinirken hata:', error);
      showMessage('error',(error as any)?.message||'Avans silinemedi');
    } finally {if(ownsExpenseLock)expenseSaveInFlight.current=false;}
  };

  const deleteEmployee = async (empId: string, empName: string) => {
    if (!canManage) return;
    if (!confirm(`${empName} isimli çalışanı silmek istediçinizden emin misiniz?\n\nÇalışan pasif yapılır; geçmiş bordro kayıtları korunur.`)) {
      return;
    }

    try {
      setLoading(true);
      
      // çalışanı pasif yap (soft delete)
      const { error } = await supabase
        .from('beyaz_yaka_employees')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', empId);

      if (error) throw error;
      
      await loadEmployees();
      
      // Silinen çalışan seçiliyse, seçimi temizle
      if (selectedEmployeeId === empId) {
        setSelectedEmployeeId(employees.length > 1 ? employees[0].id : '');
      }
      
      alert(`? ${empName} başarıyla silindi.`);
      
    } catch (error) {
      console.error('çalışan silme hatası:', error);
      alert('çalışan silinirken bir hata oluştu!');
    } finally {
      setLoading(false);
    }
  };

  const updatePayrollField = (field: keyof MonthlyPayroll, value: any) => {
    if (!canManage) return;
    if(expenseSaveInFlight.current){showMessage('error','Gider/avans işleminin tamamlanmasını bekleyin.');return;}
    if (!payrollData) return;
    
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return;
    const updated = { ...payrollData, [field]: value };
    
    // Net Ödemeyi otomatik hesapla
    if (['base_salary', 'overtime_pay', 'bonus', 'meal_allowance', 'transport_allowance', 
         'other_earnings', 'advance_deduction', 'sgk_employee', 'unemployment_employee',
         'income_tax', 'stamp_tax', 'other_deductions'].includes(field)) {
      
      const totalEarnings = 
        Number(updated.base_salary) + 
        Number(updated.overtime_pay) + 
        Number(updated.bonus) +
        Number(updated.meal_allowance) + 
        Number(updated.transport_allowance) + 
        Number(updated.other_earnings);
      
      const totalDeductions = 
        Number(updated.advance_deduction) + 
        Number(updated.sgk_employee) + 
        Number(updated.unemployment_employee) +
        Number(updated.income_tax) + 
        Number(updated.stamp_tax) + 
        Number(updated.other_deductions);
      
      updated.net_payment = totalEarnings - totalDeductions;
      
      // İşveren maliyetini hesapla
      updated.total_employer_cost = totalEarnings + 
        Number(updated.sgk_employer) + 
        Number(updated.unemployment_employer);
    }
    
    setPayrollData(updated);
    payrollSnapshotRef.current=updated;payrollEditVersion.current++;
    setPayrollDirty(true);
  };

  const reloadCurrentPayroll = async () => {
    if(payrollWriteInFlight.current || expenseSaveInFlight.current){showMessage('error','Devam eden bordro işleminin tamamlanmasını bekleyin.');return;}
    if((payrollDirtyRef.current || dailyLogsDirtyRef.current || payrollConflictRef.current) && !confirm('Sunucudaki güncel dönemi yüklemek bu ekrandaki kaydedilmemiş değişiklikleri kaldırır. Değişikliklerinizi not edip yeniden yüklemek istiyor musunuz?'))return;
    if(saveTimeoutRef.current){clearTimeout(saveTimeoutRef.current);saveTimeoutRef.current=null;}
    await loadPayrollData();
  };

  const canLeavePayroll = () => {
    if (payrollWriteInFlight.current || expenseSaveInFlight.current) { showMessage('error','Devam eden bordro kaydının tamamlanmasını bekleyin.'); return false; }
    if ((payrollDirtyRef.current || dailyLogsDirtyRef.current || payrollConflictRef.current) && !confirm('Kaydedilmemiş bordro değişiklikleriniz var. Bu görünümden ayrılmak değişiklikleri kaldırır. Bilgilerinizi not edip devam etmek istiyor musunuz?')) return false;
    return true;
  };
  const chooseEmployee = (id: string) => { if (id === selectedEmployeeId || canLeavePayroll()) setSelectedEmployeeId(id); };
  useEffect(() => {
    const changing = (event: Event) => { if (!canLeavePayroll()) event.preventDefault(); };
    const unloading = (event: BeforeUnloadEvent) => { if (payrollDirtyRef.current || dailyLogsDirtyRef.current || payrollWriteInFlight.current || expenseSaveInFlight.current) { event.preventDefault(); event.returnValue=''; } };
    window.addEventListener('vg:before-module-change',changing);
    window.addEventListener('beforeunload',unloading);
    return () => { window.removeEventListener('vg:before-module-change',changing); window.removeEventListener('beforeunload',unloading); };
  }, []);

  const changeMonth = (direction: 'prev' | 'next') => {
    if (!canLeavePayroll()) return;
    if (direction === 'prev') {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(currentYear - 1);
      } else {
        setCurrentMonth(currentMonth - 1);
      }
    } else {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(currentYear + 1);
      } else {
        setCurrentMonth(currentMonth + 1);
      }
    }
  };

  const exportToPDF = async () => {
    if (!payrollData || !selectedEmployee) { alert('Önce personel ve dönem seçin.'); return; }
    try {
      const doc = await createReportPDF({ title: 'Beyaz Yaka Personel Ücret Hesap Özeti' });
      const money = (field: string) => reportMoney(Number((payrollData as any)[field] || 0));
      const sumFields = (fields: string[]) => fields.reduce((total, field) => total + Number((payrollData as any)[field] || 0), 0);
      doc.setFont(undefined, 'bold'); doc.setFontSize(17); doc.setTextColor(24, 57, 95);
      doc.text('PERSONEL ÜCRET HESAP ÖZETİ', 105, 21, { align: 'center' });
      doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(0);
      doc.text(`${MONTHS[currentMonth]} ${currentYear}`, 105, 29, { align: 'center' });
      doc.autoTable({ startY: 37, head: [['Personel bilgisi', 'Değer']], body: [
        ['Çalışan', selectedEmployee.name], ['TC kimlik no', selectedEmployee.tc_no || 'Belirtilmedi'],
        ['Pozisyon', selectedEmployee.position || 'Belirtilmedi'], ['Departman', selectedEmployee.department || 'Belirtilmedi'],
        ['Çalışma günü', `${payrollData.worked_days}/${payrollData.total_days}`]
      ], theme: 'grid', styles: {fontSize: 9, cellPadding: 2} });
      const tableData: any[] = [
        ['Temel ücret', money('base_salary')], ['Mesai ücreti', money('overtime_pay')], ['Prim', money('bonus')],
        ['Yemek yardımı', money('meal_allowance')], ['Ulaşım yardımı', money('transport_allowance')],
        ['Diğer kazançlar', money('other_earnings')],
        ['TOPLAM HAKEDİŞ', reportMoney(sumFields(['base_salary', 'overtime_pay', 'bonus', 'meal_allowance', 'transport_allowance', 'other_earnings']))],
        ['SGK çalışan payı', money('sgk_employee')], ['İşsizlik çalışan payı', money('unemployment_employee')],
        ['Gelir vergisi', money('income_tax')], ['Damga vergisi', money('stamp_tax')], ['Avans kesintisi', money('advance_deduction')],
        ['Diğer kesintiler', money('other_deductions')],
        ['TOPLAM KESİNTİ', reportMoney(sumFields(['sgk_employee', 'unemployment_employee', 'income_tax', 'stamp_tax', 'advance_deduction', 'other_deductions']))],
        ['NET ÖDEME', money('net_payment')], ['SGK işveren payı', money('sgk_employer')],
        ['İşsizlik işveren payı', money('unemployment_employer')], ['TOPLAM İŞVEREN MALİYETİ', money('total_employer_cost')]
      ];
      doc.autoTable({ startY: (doc as any).lastAutoTable.finalY + 7, head: [['Açıklama', 'Tutar']], body: tableData,
        columnStyles: { 1: { halign: 'right' } }, theme: 'striped', styles: {fontSize: 9, cellPadding: 2},
        didParseCell: (data: any) => {
          if (data.section === 'body' && /^(TOPLAM|NET ÖDEME)/.test(String(data.row.raw[0]))) {
            data.cell.styles.fillColor = [232, 238, 246]; data.cell.styles.fontStyle = 'bold';
          }
        }
      });
      if (advances.length) {
        doc.autoTable({ startY: (doc as any).lastAutoTable.finalY + 7, pageBreak: 'avoid', head: [['Avans planı tarihi', 'Açıklama', 'Bu dönem planlanan taksit']],
          body: advances.map(advance => [reportDate(advance.advance_date), advance.description || 'Avans',
            reportMoney(monthlyAdvanceAmount(advance,currentYear,currentMonth))]), columnStyles: { 2: { halign: 'right' } } });
      }
      doc.setFontSize(8); doc.setTextColor(85);
      let y = writeReportParagraph(doc, `Oluşturulma tarihi: ${reportDate()}. Kaydedilmiş dönem tutarları esas alınmıştır. Avans planı tutarları seçili dönem için hesaplanmıştır; kaydedilmiş kesinti ödeme özetindeki Avans kesintisi satırıdır. Vergi ve SGK tutarları onaylı resmi bordro ile doğrulanmalıdır.`,
        { y: (doc as any).lastAutoTable.finalY + 8, lineHeight: 4 });
      if (payrollData.notes) y = writeReportParagraph(doc, `Not: ${payrollData.notes}`, { y: y + 3, lineHeight: 4 });
      doc.save(reportFileName('Beyaz_Yaka_Bordro', `${selectedEmployee.name}_${MONTHS[currentMonth]}_${currentYear}`));
    } catch (error: any) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  const exportSummaryToExcel = async () => {
    if (summaryExportInFlight.current || loading || !employees.length) return;
    summaryExportInFlight.current = true; setExportingSummary(true);
    const exportMonth = currentMonth, exportYear = currentYear, exportEmployees = [...employees];
    try {
      const saved = new Map<string, MonthlyPayroll>();
      for (let start = 0; ; start += 1000) {
        const {data, error} = await supabase.from('beyaz_yaka_monthly_payroll').select('*')
          .eq('month', exportMonth).eq('year', exportYear).order('id').range(start, start + 999);
        if (error) throw error;
        for (const row of data || []) {
          if (saved.has(row.employee_id)) throw new Error('Aynı çalışan ve dönem için birden fazla bordro kaydı var. Kayıtları kontrol edin.');
          saved.set(row.employee_id, row);
        }
        if (!data || data.length < 1000) break;
      }
      const summaryData = exportEmployees.map(emp => {
        const payroll = saved.get(emp.id);
        return {
          'çalışan': emp.name,
          'Pozisyon': emp.position || '-',
          'Departman': emp.department || '-',
          'Dönem': `${MONTHS[exportMonth]} ${exportYear}`,
          'Kayıt durumu': payroll ? 'Kaydedilmiş dönem' : 'Dönem kaydı yok',
          'Temel Maaş': payroll?.base_salary ?? null,
          'Net Ödeme': payroll?.net_payment ?? null,
          'İşveren Maliyeti': payroll?.total_employer_cost ?? null,
          'İşe Başlama': reportDate(emp.start_date)
        };
      });
      const ws = XLSX.utils.json_to_sheet(summaryData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Beyaz Yaka Özet');
      XLSX.writeFile(wb, `beyaz_yaka_ozet_${MONTHS[exportMonth]}_${exportYear}.xlsx`);
    } catch (error: any) {
      showMessage('error', 'Excel oluşturulamadı: ' + (error?.message || 'Dönem kayıtları yüklenemedi. Yeniden deneyin.'));
    } finally { summaryExportInFlight.current = false; setExportingSummary(false); }
  };

  const resetEmployeeForm = () => {
    setSelectedUserId('');
    setEmployeeForm({
      name: '',
      tc_no: '',
      email: '',
      phone: '',
      position: '',
      department: '',
      start_date: localISODate(),
      monthly_salary: '',
      gross_salary: '',
      sgk_base: '',
      bank_name: '',
      iban: ''
    });
  };

  const resetAdvanceForm = () => {
    setAdvanceForm({
      amount: '',
      date: localISODate(),
      description: '',
      type: 'Avans',
      installment_total: '1',
      installment_current: '1'
    });
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // Özet hesaplamaları
  const summaryStats = useMemo(() => {
    const totalSalary = employees.reduce((sum, emp) => sum + parseDecimal(emp.monthly_salary), 0);
    const totalEmployees = employees.length;
    
    return {
      totalEmployees,
      totalSalary,
      averageSalary: totalEmployees > 0 ? totalSalary / totalEmployees : 0
    };
  }, [employees]);

  // --- RENDER ---
  return (
    <div data-payroll-access={canManage ? "manage" : "own"} className="min-h-screen bg-gray-50 p-6">
      {!canManage && <p className="portal-readonly-note">Yalnız size bağlı bordro kayıtlarını görüntülüyorsunuz. Kayıt ve ödeme değişikliklerini bordro yöneticiniz yapar.</p>}
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Building className="text-indigo-600" size={32} />
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Beyaz Yaka Bordro Sistemi</h1>
                <p className="text-gray-600">Maaşlı personel bordro yönetimi</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                onClick={() => setActiveTab('summary')}
                className={`px-4 py-2 rounded-lg font-medium ${
                  activeTab === 'summary' 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Users className="inline mr-2" size={18} />
                Özet
              </button>
              <button
                onClick={() => setActiveTab('detail')}
                className={`px-4 py-2 rounded-lg font-medium ${
                  activeTab === 'detail' 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                disabled={!selectedEmployeeId}
              >
                <Calculator className="inline mr-2" size={18} />
                Detay
              </button>
            </div>
          </div>
        </div>

        {/* Mesaj */}
        {message && (
          <div className={`mb-4 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* Özet Tab */}
        {activeTab === 'summary' && (
          <>
            {/* İstatistikler */}
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Toplam çalışan</p>
                    <p className="text-3xl font-bold text-indigo-600">{summaryStats.totalEmployees}</p>
                  </div>
                  <Users className="text-indigo-600" size={48} />
                </div>
              </div>
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Toplam Maaş</p>
                    <p className="text-2xl font-bold text-green-600">{formatCurrency(summaryStats.totalSalary)}</p>
                  </div>
                  <Banknote className="text-green-600" size={48} />
                </div>
              </div>
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Ortalama Maaş</p>
                    <p className="text-2xl font-bold text-blue-600">{formatCurrency(summaryStats.averageSalary)}</p>
                  </div>
                  <TrendingUp className="text-blue-600" size={48} />
                </div>
              </div>
            </div>

            {/* çalışan Listesi */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                <h2 className="text-2xl font-bold text-gray-800">çalışan Listesi</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={exportSummaryToExcel}
                    disabled={exportingSummary || loading || !employees.length}
                    aria-busy={exportingSummary}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2"
                  >
                    <Download size={18} />
                    {exportingSummary ? 'Excel hazırlanıyor…' : 'Excel indir'}
                  </button>
                  <button
                    onClick={() => {
                      setShowEmployeeModal(true);
                      setEditingEmployee(null);
                      resetEmployeeForm();
                    }}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2"
                   hidden={!canManage} >
                    <UserPlus size={20} />
                    Yeni çalışan
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left">Ad Soyad</th>
                      <th className="px-4 py-3 text-left">Pozisyon</th>
                      <th className="px-4 py-3 text-left">Departman</th>
                      <th className="px-4 py-3 text-right">Aylık Maaş</th>
                      <th className="px-4 py-3 text-left">İşe Başlama</th>
                      <th className="px-4 py-3 text-center">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{emp.name}</td>
                        <td className="px-4 py-3">{emp.position || '-'}</td>
                        <td className="px-4 py-3">{emp.department || '-'}</td>
                        <td className="px-4 py-3 text-right font-semibold">{maskSalary(emp)}</td>
                        <td className="px-4 py-3">{new Date(emp.start_date).toLocaleDateString('tr-TR')}</td>
                        <td className="px-4 py-3 text-center flex justify-center space-x-2">
                          <button 
                            onClick={() => {
                              setEditingEmployee(emp);
                              setSelectedUserId(emp.user_id || '');
                              setEmployeeForm({
                                name: emp.name,
                                tc_no: emp.tc_no || '',
                                email: emp.email || '',
                                phone: emp.phone || '',
                                position: emp.position || '',
                                department: emp.department || '',
                                start_date: emp.start_date,
                                monthly_salary: emp.monthly_salary.toString(),
                                gross_salary: emp.gross_salary?.toString() || '',
                                sgk_base: emp.sgk_base?.toString() || '',
                                bank_name: emp.bank_name || '',
                                iban: emp.iban || ''
                              });
                              setShowEmployeeModal(true);
                            }}
                            className="bg-yellow-100 text-yellow-700 p-2 rounded-full hover:bg-yellow-200 transition"
                            title="Bilgileri Düzenle"
                           hidden={!canManage} >
                            <Edit className="w-4 h-4"/>
                          </button>
                          <button 
                            onClick={() => deleteEmployee(emp.id, emp.name)}
                            className="bg-red-100 text-red-700 p-2 rounded-full hover:bg-red-200 transition"
                            title="çalışanı Sil"
                           hidden={!canManage} >
                            <Trash2 className="w-4 h-4"/>
                          </button>
                          <button 
                            onClick={() => {
                              if (!canLeavePayroll()) return;
                              setSelectedEmployeeId(emp.id);
                              setActiveTab('detail');
                            }}
                            className="bg-blue-100 text-blue-700 p-2 rounded-full hover:bg-blue-200 transition"
                            title="Bordro Detayı"
                          >
                            <FileSpreadsheet className="w-4 h-4"/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Detay Tab */}
        {activeTab === 'detail' && selectedEmployee && (
          <>
            {/* çalışan Seçimi ve Ay Navigasyonu */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">çalışan Seçiniz</label>
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => chooseEmployee(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500"
                  >
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ay Seçimi</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => changeMonth('prev')}
                      aria-label="Önceki ay"
                      className="p-2 border rounded-lg hover:bg-gray-100"
                    ><ChevronLeft size={18} /></button>
                    <div className="flex-1 text-center font-semibold">
                      {MONTHS[currentMonth]} {currentYear}
                    </div>
                    <button
                      onClick={() => changeMonth('next')}
                      aria-label="Sonraki ay"
                      className="p-2 border rounded-lg hover:bg-gray-100"
                    ><ChevronRight size={18} /></button>
                  </div>
                </div>
              </div>
            </div>

            {payrollData && (
              <>
                {!canViewDetails(selectedEmployee) ? (
                  <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-8 text-center">
                    <AlertCircle className="w-16 h-16 text-yellow-600 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-gray-800 mb-2">Yetkiniz Yok</h3>
                    <p className="text-gray-600">Bu çalışanın bordro bilgilerini görüntüleme yetkiniz bulunmamaktadır.</p>
                    <p className="text-sm text-gray-500 mt-2">Sadece kendi bordro bilgilerinizi görüntüleyebilirsiniz.</p>
                  </div>
                ) : (
                  <>
                {/* Bordro Formu */}
                <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                  <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                    <h2 className="text-2xl font-bold text-gray-800">Aylık Bordro - {selectedEmployee.name}</h2>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={reloadCurrentPayroll} className="border border-gray-400 text-gray-700 px-3 py-2 rounded-lg flex items-center gap-2">
                        <RefreshCw size={18} /> Güncel dönemi yükle
                      </button>
                      <button onClick={exportToPDF} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center gap-2">
                        <Download size={18} />
                        PDF
                      </button>
                      <button onClick={savePayroll} disabled={loading || payrollConflict} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50" hidden={!canManage} >
                        <Save size={18} />
                        Kaydet
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    {/* Hakedi Kalemleri */}
                    <div className="border rounded-lg p-4">
                      <h3 className="text-lg font-bold mb-4 text-green-700">Hakedi Kalemleri</h3>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium mb-1">Temel Maaş</label>
                          <input
                            type="number"
                            value={payrollData.base_salary}
                            onChange={(e) => updatePayrollField('base_salary', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Mesai ıcreti</label>
                          <input
                            type="number"
                            value={payrollData.overtime_pay}
                            onChange={(e) => updatePayrollField('overtime_pay', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Prim</label>
                          <input
                            type="number"
                            value={payrollData.bonus}
                            onChange={(e) => updatePayrollField('bonus', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Yemek Yardımı</label>
                          <input
                            type="number"
                            value={payrollData.meal_allowance}
                            onChange={(e) => updatePayrollField('meal_allowance', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Ulaşım Yardımı</label>
                          <input
                            type="number"
                            value={payrollData.transport_allowance}
                            onChange={(e) => updatePayrollField('transport_allowance', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Diğer Kazançlar</label>
                          <input
                            type="number"
                            value={payrollData.other_earnings}
                            onChange={(e) => updatePayrollField('other_earnings', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                      </div>
                    </div>

                    <p className="col-span-full bg-amber-50 border border-amber-200 p-3 rounded text-sm text-amber-900">
                      Bu bölüm iç ödeme ve puantaj kaydıdır. Vergi/SGK için kümülatif matrah, istisna ve teşvikler otomatik hesaplanmaz; tutarları muhasebenin doğruladığı bordrodan girin. Net maaşı taban olarak kullandıysanız vergi kesintisini tekrar düşmeyin; brüt bordro hazırlarken taban tutarı ve bütün kesintileri birlikte girin. Sıfır başlangıç değerleri vergi muafiyeti anlamına gelmez.
                    </p>
                    {/* Kesinti Kalemleri */}
                    <div className="border rounded-lg p-4">
                      <h3 className="text-lg font-bold mb-4 text-red-700">Kesinti Kalemleri</h3>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium mb-1">SGK İşçi Payı</label>
                          <input
                            type="number"
                            value={payrollData.sgk_employee}
                            onChange={(e) => updatePayrollField('sgk_employee', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">İşsizlik İşçi Payı</label>
                          <input
                            type="number"
                            value={payrollData.unemployment_employee}
                            onChange={(e) => updatePayrollField('unemployment_employee', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Gelir Vergisi</label>
                          <input
                            type="number"
                            value={payrollData.income_tax}
                            onChange={(e) => updatePayrollField('income_tax', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Damga Vergisi</label>
                          <input
                            type="number"
                            value={payrollData.stamp_tax}
                            onChange={(e) => updatePayrollField('stamp_tax', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Avans Kesintisi</label>
                          <input
                            type="number"
                            value={payrollData.advance_deduction}
                            onChange={(e) => updatePayrollField('advance_deduction', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Diğer Kesintiler</label>
                          <input
                            type="number"
                            value={payrollData.other_deductions}
                            onChange={(e) => updatePayrollField('other_deductions', Number(e.target.value))}
                            className="w-full border rounded px-3 py-2"
                           disabled={!canManage} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Özet */}
                  <div className="mt-6 bg-indigo-50 border-2 border-indigo-200 rounded-lg p-6">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-sm text-gray-600">Net Ödeme</p>
                        <p className="text-3xl font-bold text-indigo-600">{formatCurrency(payrollData.net_payment)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">İşveren Maliyeti</p>
                        <p className="text-3xl font-bold text-orange-600">{formatCurrency(payrollData.total_employer_cost)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Çalışılan Gün</p>
                        <input
                          type="number"
                          value={payrollData.worked_days}
                          onChange={(e) => updatePayrollField('worked_days', Number(e.target.value))}
                          className="text-2xl font-bold w-20 border rounded px-2 py-1"
                         disabled={!canManage} />
                        <span className="text-2xl font-bold"> / {payrollData.total_days}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {payrollDirty && <p role="status" className="bg-amber-50 text-amber-900 p-3 mb-3 rounded">Maaş/kesinti değişiklikleri henüz kaydedilmedi. Yeni gider/avans eklemeden önce Kaydet düğmesini kullanın.</p>}
                {saveStatus === 'error' && <p role="alert" className="bg-red-50 text-red-800 p-3 rounded">{payrollConflict?'Bordro başka bir işlemde değişti. Yerel değişiklikleriniz korunuyor; Güncel dönemi yükle düğmesiyle sunucu kaydını açıp karşılaştırın.':'Puantaj kaydedilemedi. Yerel değişiklikleriniz korunuyor; Kaydet düğmesiyle yeniden deneyin.'}</p>}
                {/* Avans/Gider/Prim Kayıtları */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800">Avans / Gider / Prim Kayıtları</h3>
                    <button
                      onClick={() => {
                        setShowAdvanceModal(true);
                        resetAdvanceForm();
                      }}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 flex items-center gap-2"
                     hidden={!canManage} >
                      <PlusCircle size={18} />
                      Yeni Kayıt Ekle
                    </button>
                  </div>
                  {expensesList.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-4 py-2 text-left">Tip</th>
                            <th className="px-4 py-2 text-left">Tarih</th>
                            <th className="px-4 py-2 text-right">Tutar</th>
                            <th className="px-4 py-2 text-center">Taksit</th>
                            <th className="px-4 py-2 text-left">Aıklama</th>
                            <th className="px-4 py-2 text-center">İşlem</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expensesList.map((exp) => (
                            <tr key={exp.id} className="border-b">
                              <td className="px-4 py-2">
                                <span className={`px-2 py-1 rounded text-sm font-medium ${
                                  exp.type === 'Prim' ? 'bg-green-100 text-green-800' :
                                  exp.type === 'Avans' ? 'bg-blue-100 text-blue-800' :
                                  'bg-red-100 text-red-800'
                                }`}>
                                  {exp.type}
                                </span>
                              </td>
                              <td className="px-4 py-2">{new Date(exp.date).toLocaleDateString('tr-TR')}</td>
                              <td className="px-4 py-2 text-right font-semibold">{formatCurrency(exp.amount)}</td>
                              <td className="px-4 py-2 text-center">
                                {exp.installment_total > 1 ? `${exp.installment_current} / ${exp.installment_total}` : '-'}
                              </td>
                              <td className="px-4 py-2">{exp.description || '-'}</td>
                              <td className="px-4 py-2 text-center">
                                <button
                                  onClick={() => deleteExpense(exp.id)}
                                  className="text-red-600 hover:text-red-800"
                                  title="Sil"
                                 hidden={!canManage} >
                                  <Trash2 size={18} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-center text-gray-500 py-4">Kayıt bulunmuyor</p>
                  )}
                </div>

                {/* Taksit Planları */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800">Taksit Planları</h3>
                  </div>
                  {advances.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-4 py-2 text-left">Tarih</th>
                            <th className="px-4 py-2 text-right">Tutar</th>
                            <th className="px-4 py-2 text-center">Taksit</th>
                            <th className="px-4 py-2 text-right">Seçili Ay Kesintisi</th>
                            <th className="px-4 py-2 text-left">Aıklama</th>
                            <th className="px-4 py-2 text-center">İşlem</th>
                          </tr>
                        </thead>
                        <tbody>
                          {advances.map((adv) => (
                            <tr key={adv.id} className="border-b">
                              <td className="px-4 py-2">{new Date(adv.advance_date).toLocaleDateString('tr-TR')}</td>
                              <td className="px-4 py-2 text-right font-semibold">{formatCurrency(adv.amount)}</td>
                              <td className="px-4 py-2 text-center">
                                {adv.installment_count - (adv.remaining_installments || 0)} / {adv.installment_count}
                              </td>
                              <td className="px-4 py-2 text-right">{formatCurrency(monthlyAdvanceAmount(adv, currentYear, currentMonth))}</td>
                              <td className="px-4 py-2">{adv.description || '-'}</td>
                              <td className="px-4 py-2 text-center">
                                <button
                                  onClick={() => { if (!canLeavePayroll()) return; const date = new Date(adv.advance_date + 'T12:00:00'); setCurrentYear(date.getFullYear()); setCurrentMonth(date.getMonth()); }}
                                  className="text-red-600 hover:text-red-800"
                                >
                                  <Calendar size={18} /> Kaydın dönemine git
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-center text-gray-500 py-4">Avans kaydı bulunmuyor</p>
                  )}
                </div>
                </>
              )}
            </>
            )}
          </>
        )}

        {/* çalışan Ekleme/Düzenleme Modalı */}
        {canManage && showEmployeeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">
                  {editingEmployee ? 'çalışan Düzenle' : 'Yeni çalışan Ekle'}
                </h3>
                <button onClick={() => setShowEmployeeModal(false)} className="text-gray-500 hover:text-gray-700" hidden={!canManage} >
                  <X size={24} />
                </button>
              </div>
              
              {/* Kullanıcı Seçimi - Sadece yeni ekleme sırasında */}
              {canManage && (
                <div className="mb-4 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                  <label className="block text-sm font-medium mb-2 text-indigo-900">
                    Çalışan hesabı (opsiyonel)
                  </label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => handleUserSelect(e.target.value)}
                    className="w-full border-2 border-indigo-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    <option value="">Hesap eşleştirilmedi</option>
                    {selectedUserId && !availableUsers.some(user => user.id === selectedUserId) && <option value={selectedUserId}>Mevcut kapalı çalışan hesabı</option>}
                    {availableUsers.map(user => (
                      <option key={user.id} value={user.id}>
                        {user.user_metadata?.full_name || user.email} 
                        {user.user_metadata?.company ? `(${user.user_metadata.company})` : ''}
                        {user.user_metadata?.role ? ` - ${user.user_metadata.role}` : ''}
                        {user.email ? ` <${user.email}>` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-indigo-600 mt-2">
                    ℹ️ Kullanıcı seçtiğinizde email ve ad alanları otomatik doldurulur
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Ad Soyad *</label>
                  <input
                    type="text"
                    value={employeeForm.name}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">TC Kimlik No</label>
                  <input
                    type="text"
                    value={employeeForm.tc_no}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, tc_no: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">E-posta</label>
                  <input
                    type="email"
                    value={employeeForm.email}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Telefon</label>
                  <input
                    type="text"
                    value={employeeForm.phone}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Pozisyon</label>
                  <input
                    type="text"
                    value={employeeForm.position}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, position: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Departman</label>
                  <input
                    type="text"
                    value={employeeForm.department}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, department: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">İşe Başlama Tarihi *</label>
                  <input
                    type="date"
                    value={employeeForm.start_date}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, start_date: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Aylık Net Maaş *</label>
                  <input
                    type="number"
                    value={employeeForm.monthly_salary}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, monthly_salary: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Brüt Maaş</label>
                  <input
                    type="number"
                    value={employeeForm.gross_salary}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, gross_salary: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">SGK Matrahı</label>
                  <input
                    type="number"
                    value={employeeForm.sgk_base}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, sgk_base: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Banka Adı</label>
                  <input
                    type="text"
                    value={employeeForm.bank_name}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, bank_name: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">IBAN</label>
                  <input
                    type="text"
                    value={employeeForm.iban}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, iban: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowEmployeeModal(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-100"
                 hidden={!canManage} >
                  ıptal
                </button>
                <button
                  onClick={saveEmployee}
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                 hidden={!canManage} >
                  {loading ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Avans/Gider/Prim Modalı */}
        {canManage && showAdvanceModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Yeni Kayıt Ekle</h3>
                <button onClick={() => setShowAdvanceModal(false)} className="text-gray-500 hover:text-gray-700" hidden={!canManage} >
                  <X size={24} />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Tip *</label>
                  <select
                    value={advanceForm.type}
                    onChange={(e) => setAdvanceForm({ ...advanceForm, type: e.target.value as 'Avans' | 'Gider' | 'Prim' })}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="Avans">Avans (Kesinti)</option>
                    <option value="Gider">Gider (Kesinti)</option>
                    <option value="Prim">Prim (Ekleme)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Tutar *</label>
                  <input
                    type="number"
                    value={advanceForm.amount}
                    onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Tarih *</label>
                  <input
                    type="date"
                    value={advanceForm.date}
                    onChange={(e) => setAdvanceForm({ ...advanceForm, date: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
                {advanceForm.type === 'Avans' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">Toplam Taksit Sayısı</label>
                      <input
                        type="number"
                        min="1"
                        value={advanceForm.installment_total}
                        onChange={(e) => setAdvanceForm({ ...advanceForm, installment_total: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Şu Anki Taksit</label>
                      <input
                        type="number"
                        min="1"
                        value={advanceForm.installment_current}
                        onChange={(e) => setAdvanceForm({ ...advanceForm, installment_current: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Aıklama</label>
                  <textarea
                    value={advanceForm.description}
                    onChange={(e) => setAdvanceForm({ ...advanceForm, description: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    rows={3}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowAdvanceModal(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-100"
                 hidden={!canManage} >
                  ıptal
                </button>
                <button
                  onClick={saveAdvance}
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                 hidden={!canManage} >
                  {loading ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BeyazYakaBordro;

