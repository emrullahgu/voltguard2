import { privateStorage as localStorage } from './privateStorage';
import { useAuth } from './SimpleAuth';
import { canManagePayroll } from './PortalNavigation';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Calendar, 
  Clock, 
  Calculator, 
  Users, 
  FileSpreadsheet, 
  Save, 
  ChevronLeft, 
  ChevronRight,
  PlusCircle,
  Trash2,
  Banknote,
  AlertCircle,
  X,
  UserPlus,
  LayoutGrid,
  List,
  ArrowRightCircle,
  Pencil,
  RefreshCw,
  Download,
  Upload,
  UploadCloud,
  FileDown,
  FileText,
  CheckCircle,
  Shield,
  History
} from 'lucide-react';
import { supabase, adminSupabase } from './supabaseClient';
import ActivityLogger from './activityLogger';
import { createReportPDF, fitReportImage, reportFileName, reportMoney, reportNumber } from './pdfReport';
import * as XLSX from 'xlsx';
import { parseDecimal, localISODate, monthlyAdvanceAmount } from './operations.mjs';
import { buildMonthlyPayrollData, isPayrollConflict } from './payrollPersistence.mjs';

// --- SABİTLER ---
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// --- TİP TANIMLAMALARI ---

type DayType = 'Normal' | 'Pazar' | 'Resmi Tatil' | 'Raporlu' | 'İzinli' | 'Gelmedi';
type TabType = 'detail' | 'summary';

interface DailyLog {
  day: number;
  type: DayType;
  startTime: string;
  endTime: string;
  overtimeHours: number;
  description: string;
  lastModifiedBy?: string;  // 🛡️ KİM değiştirdi
  lastModifiedAt?: string;
  updatedAt?: string;  // 🛡️ NE ZAMAN değiştirdi
  createdAt?: string;       // 🛡️ NE ZAMAN oluşturuldu
}

interface Expense {
  id: string;
  type: 'Avans' | 'Gider' | 'Prim';
  amount: number;
  description: string;
  date: string;
  installment_total?: number;  // Toplam taksit sayısı
  installment_current?: number; // Şu anki taksit numarası
}

interface Employee {
  id: string;
  user_id?: string | null;
  name: string;
  tc_no?: string;
  agreedSalary: number;
  officialSalary: number;
}

interface MonthlyData {
  month: number;
  year: number;
  logs: Record<number, DailyLog>;
  expenses: Expense[];
}

const DEFAULT_START_TIME = "08:00";
const DEFAULT_END_TIME_WEEKDAY = "18:00";
const DEFAULT_END_TIME_SATURDAY = "13:00";

// --- YARDIMCI FONKSİYONLAR ---

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
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

// --- HESAPLAMA MOTORU (BASİTLEŞTİRİLMİŞ MANTIK) ---
const calculateEmployeeStats = (employee: Employee, data: MonthlyData | undefined, daysInMonth: number, currentMonth: number, currentYear: number) => {
    let totalWorkDays = 0;
    let totalSundayDays = 0;
    let totalOvertimeHours = 0;
    let totalSundayPay = 0;
    let totalAdvances = 0;
    let totalExpenses = 0;
    let totalBonuses = 0;
    let totalAbsentDays = 0; // Yalnızca açıkça Gelmedi olarak kaydedilmiş günler
    let totalMissingDays = 0;

    if (!data) {
        return {
            dailyRate: employee.agreedSalary / daysInMonth,
            hourlyRate: (employee.agreedSalary / daysInMonth) / 8,
            totalWorkDays: 0,
            totalSundayDays: 0,
            totalOvertimeHours: 0,
            overtimePay: 0,
            totalSundayPay: 0,
            totalAbsentDays: 0,
            totalMissingDays: daysInMonth,
            absentDeduction: 0,
            totalAdvances: 0,
            totalExpenses: 0,
            totalBonuses: 0,
            totalExtras: 0,
            grossTotal: 0,
            netPayable: 0,
            officialPay: employee.officialSalary,
            remainingHandPay: 0
        };
    }

    // HESAPLAMA MANTIĞI
    // Günlük Ücret = Anlaşılan Net Maaş / 30 (sabit)
    // Mesai Saatlik Ücret = Anlaşılan Net Maaş / 30 / 8 (HER ZAMAN 30 güne göre, sabit)
    // Pazar/Tatil = Normal gün + 1 günlük ek fark (sabit 30 güne göre: 90,000/30 = 3,000 TL)
    // Gelmedi = Anlaşılan Maaş'tan KESİNTİ (90,000/30 = 3,000 TL/gün)
    // Fazla Mesai = Saatlik Ücret (30 güne göre) × 1.5
    // BÖYLECE: 
    //   - 30 gün tam çalışırsa = 90,000 TL
    //   - 2 gün gelmedi = 90,000 - 6,000 = 84,000 TL
    //   - Pazar çalışma: 90,000 + 3,000 TL (ek fark)
    //   - Mesai: 5 saat × 375 TL × 1.5 = 2,812.50 TL
    
    const dailyRate = employee.agreedSalary / daysInMonth; // Normal günler için (değişken)
    const dailyRateFixed = employee.agreedSalary / 30; // Pazar/Tatil farkı ve kesinti için sabit (90,000/30 = 3,000 TL)
    const hourlyRateForOvertime = (employee.agreedSalary / 30) / 8; // Mesai için sabit (90,000/30/8 = 375 TL)
    const hourlyRate = dailyRate / 8; // Gösterim için

    // PUANTAJ VERİLERİNİ TOPLA
    for (let i = 1; i <= daysInMonth; i++) {
        const log = data.logs[i];
        if (log) {
            if (log.type === 'Normal') {
                totalWorkDays += 1;
            } else if (log.type === 'Pazar' || log.type === 'Resmi Tatil') {
                // Pazar/Tatil = Normal gün sayılır + 1 günlük EK fark (sabit 30 güne göre)
                totalWorkDays += 1; // Normal gün olarak say
                totalSundayDays += 1;
                totalSundayPay += dailyRateFixed; // Ek fark: 90,000/30 = 3,000 TL
            } else if (log.type === 'İzinli' || log.type === 'Raporlu') {
                // İzinli ve Raporlu günler çalışılan güne sayılmaz, kesinti de yapılmaz
            } else if (log.type === 'Gelmedi') {
                // Gelmedi: Maaştan kesinti yapılır (Anlaşılan Maaş / 30)
                totalAbsentDays += 1;
            }
            // Boş günler (gelmedi) için de kesinti yapılacak

            if (log.overtimeHours > 0) {
                totalOvertimeHours += parseDecimal(log.overtimeHours);
            }
        } else {
            // Kaydı olmayan gün devamsızlık sayılmaz; puantaj tamamlanmalıdır.
            totalMissingDays += 1;
        }
    }

    // GİDER/AVANS/PRİM TOPLA
    data.expenses.forEach(exp => {
        if (exp.type === 'Avans') {
            // Taksitli avans ise: Veriliş tarihinden itibaren kaç taksit geçmiş?
            const installmentTotal = exp.installment_total || 1;
            const expDate = new Date(exp.date);
            const expMonth = expDate.getMonth();
            const expYear = expDate.getFullYear();
            
            // Avansın verildiği aydan şimdiye kaç ay geçti?
            const monthsFromStart = (currentYear - expYear) * 12 + (currentMonth - expMonth);
            
            // Kaçıncı taksitteyiz? (1'den başlar)
            const currentInstallmentNumber = monthsFromStart + 1;
            
            // Bu ay için taksit kesilecek mi?
            if (currentInstallmentNumber > 0 && currentInstallmentNumber <= installmentTotal) {
                // Aylık taksit tutarı
                const monthlyInstallment = monthlyAdvanceAmount(exp, currentYear, currentMonth);
                totalAdvances += monthlyInstallment;
                
            }
        }
        else if (exp.type === 'Gider') totalExpenses += parseDecimal(exp.amount);
        else if (exp.type === 'Prim') totalBonuses += parseDecimal(exp.amount);
    });

    // TOPLAM HESAPLAMALAR
    const totalExtras = totalExpenses + totalBonuses;
    const overtimePay = totalOvertimeHours * hourlyRateForOvertime * 1.5; // Mesai: Sabit saatlik × 1.5
    const absentDeduction = totalAbsentDays * dailyRateFixed; // Gelmediği günler için kesinti: 2 gün × 3,000 = 6,000 TL
    const grossTotal = employee.agreedSalary + totalSundayPay + overtimePay + totalExtras - absentDeduction; // Anlaşılan Maaş - Gelmedi + Ekstralar
    const netPayable = grossTotal - totalAdvances;
    
    // ÖDENECEK ÖDENECEK = NET ELE GEÇEN (officialSalary sadece gösterim için)
    const remainingHandPay = netPayable - employee.officialSalary;

    return {
        dailyRate: employee.agreedSalary / 30,  // Mesai hesabı için gösterim (sabit 30 güne göre)
        hourlyRate: hourlyRateForOvertime,  // Mesai saatlik ücreti (sabit, 375 TL)
        totalWorkDays,
        totalSundayDays,
        totalOvertimeHours,
        overtimePay,
        totalSundayPay,
        totalAbsentDays,
        totalMissingDays,
        absentDeduction,
        totalAdvances,
        totalExpenses,
        totalBonuses,
        totalExtras,
        grossTotal,
        netPayable,
        officialPay: employee.officialSalary,
        remainingHandPay
    };
};

// --- ANA BİLEŞEN ---

export default function BordroTakip() {
  const { currentUser } = useAuth();
  const canManage = canManagePayroll(currentUser);
  const dailyVersions = useRef<Record<string, string | null>>({});
  const dailyQueues = useRef<Record<string, Promise<void>>>({});
  const dailyConflicts = useRef<Set<string>>(new Set());
  const dailyFailures = useRef<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [currentDate, setCurrentDate] = useState(() => {
    // Her zaman güncel ayın 1'ine ayarla
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }); 
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logo, setLogo] = useState<string | null>(() => {
    // Logo'yu localStorage'dan yükle, yoksa default logo
    const savedLogo = localStorage.getItem('bordro_logo');
    return /^data:image\/(?:png|jpe?g|webp);base64,/i.test(savedLogo || '') ? savedLogo : null;
  });
  
  const [availableStaff, setAvailableStaff] = useState<any[]>([]);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  useEffect(() => {
    if (!canManage) return;
    let stopped = false;
    supabase.from('users').select('id,name,email,role,approved').eq('approved', true).order('name').then(({data,error}) => { if (stopped) return; if(error) { alert('Çalışan hesapları yüklenemedi: ' + error.message); return; } setAvailableStaff(data || []); });
    return () => { stopped = true; };
  }, [canManage]);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [employeeForm, setEmployeeForm] = useState({ name: '', tcNo: '', agreedSalary: '', officialSalary: '', userId: '' });

  const [appData, setAppData] = useState<Record<string, Record<string, MonthlyData>>>({});
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pendingSaves, setPendingSaves] = useState<Set<string>>(new Set());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const advanceSaveInFlight=useRef(false);
  const advanceRequestRef=useRef<{id:string;fingerprint:string}|null>(null);
  
  // 🛡️ EK KORUMA KATMANLARI
  const [lastBackupTime, setLastBackupTime] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const backupIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // 🛡️ KENDİLİĞİNDEN SİLME KORUMALARI (YENİ!)
  const [changeHistory, setChangeHistory] = useState<any[]>([]);
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random()}`);
  const [lastDbCheck, setLastDbCheck] = useState<Date | null>(null);
  const dbCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [dataSnapshot, setDataSnapshot] = useState<any>(null);
  
  // Avans Modal
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({ 
    amount: '', 
    date: localISODate(), 
    type: 'Avans' as 'Avans' | 'Gider' | 'Prim',
    installmentTotal: '1', // Toplam taksit sayısı
    installmentCurrent: '1' // Şu anki taksit numarası
  });
  
  // Geçmiş bordro görüntüleme
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyYear, setHistoryYear] = useState(currentDate.getFullYear());
  const [historyMonth, setHistoryMonth] = useState(currentDate.getMonth());
  const [historicalData, setHistoricalData] = useState<any[]>([]);

  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  const daysInMonth = getDaysInMonth(currentMonth, currentYear);
  const monthKey = `${currentYear}-${currentMonth}`;

  // --- 🛡️ EK KORUMA FONKSİYONLARI ---

  // KATMAN 8: LocalStorage Yedekleme (Çift Güvenlik)
  const saveToLocalStorage = (data: any, key: string) => {
    try {
      const backupData = {
        data,
        timestamp: new Date().toISOString(),
        employeeId: selectedEmployeeId,
        month: currentMonth,
        year: currentYear
      };
      localStorage.setItem(`bordro_backup_${key}`, JSON.stringify(backupData));
      
    } catch (error) {
      console.error('❌ LocalStorage yedekleme hatası:', error);
    }
  };

  const loadFromLocalStorage = (key: string) => {
    try {
      const stored = localStorage.getItem(`bordro_backup_${key}`);
      if (stored) {
        const backupData = JSON.parse(stored);
        
        return backupData.data;
      }
    } catch (error) {
      console.error('❌ LocalStorage yükleme hatası:', error);
    }
    return null;
  };

  // KATMAN 9: Otomatik Periyodik Yedekleme (Her 30 saniyede)
  const createAutoBackup = () => {
    try {
      const backupData = {
        appData,
        employees,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('bordro_auto_backup', JSON.stringify(backupData));
      setLastBackupTime(new Date());
      
    } catch (error) {
      console.error('❌ Otomatik yedekleme hatası:', error);
    }
  };

  // KATMAN 10: Kurtarma Modu (Recovery)
  const restoreFromBackup = () => {
    if (!canManage) return;
    try {
      const stored = localStorage.getItem('bordro_auto_backup');
      if (stored) {
        const backupData = JSON.parse(stored);
        const backupDate = new Date(backupData.timestamp);
        
        if (window.confirm(`🔄 YEDEKTEN GERİ YÜKLEME\n\nYedek Tarihi: ${backupDate.toLocaleString('tr-TR')}\n\n⚠️ Mevcut veriler yedeğin üzerine yazılacak.\nDevam etmek istiyor musunuz?`)) {
          setAppData(backupData.appData || {});
          setEmployees(backupData.employees || []);
          alert('✅ Veriler yedeğten geri yüklendi!\n\n📊 Kontrol edin ve gerekirse veritabanına kaydedin.');
          
        }
      } else {
        alert('❌ Yedek bulunamadı!\n\nHenüz otomatik yedekleme yapılmamış.');
      }
    } catch (error) {
      console.error('❌ Geri yükleme hatası:', error);
      alert('❌ Geri yükleme başarısız!\n\nHata: ' + (error as any)?.message);
    }
  };

  // KATMAN 11: Silme İçin Güvenlik Kodu
  const verifyDeleteCode = (itemType: string): boolean => {
    const deleteCode = prompt(`🔐 GÜVENLİK KODU GEREKLİ\n\n${itemType} silmek için güvenlik kodunu girin:\n\n"SIL" yazıp ENTER'a basın\n\n(Büyük/küçük harf duyarlı)`);
    
    if (deleteCode === null) {
      
      return false;
    }
    
    if (deleteCode !== 'SIL') {
      alert('❌ HATALI GÜVENLİK KODU!\n\nİşlem iptal edildi.\n\nDoğru kod: "SIL" (törnak işaretleri olmadan)');
      
      return false;
    }
    
    
    return true;
  };

  // 🛡️ KATMAN 13: Değişiklik Geçmişi Kaydet
  const logChange = (action: string, details: any) => {
    const changeLog = {
      timestamp: new Date().toISOString(),
      sessionId: sessionId,
      action: action,
      details: details,
      user: 'current_user', // Buraya kullanıcı bilgisi eklenebilir
      employeeId: selectedEmployeeId,
      month: currentMonth,
      year: currentYear
    };
    
    setChangeHistory(prev => [...prev.slice(-99), changeLog]); // Son 100 değişiklik
    
    // LocalStorage'a da yaz
    try {
      const allHistory = JSON.parse(localStorage.getItem('bordro_change_history') || '[]');
      allHistory.push(changeLog);
      localStorage.setItem('bordro_change_history', JSON.stringify(allHistory.slice(-500))); // Son 500
      
    } catch (error) {
      console.error('❌ Değişiklik geçmişi yazma hatası:', error);
    }
  };

  // 🛡️ KATMAN 14: Veritabanı Değişiklik Kontrolü (Her 10 saniyede)
  const checkDatabaseChanges = async () => {
    if (!selectedEmployeeId) return;
    
    try {
      
      
      const { data, error } = await supabase
        .from('bordro_daily_logs')
        .select('*')
        .eq('employee_id', selectedEmployeeId)
        .eq('month', currentMonth)
        .eq('year', currentYear);

      if (error) throw error;

      const currentLogs = appData[selectedEmployeeId]?.[monthKey]?.logs || {};
      const currentLogCount = Object.keys(currentLogs).length;
      const dbLogCount = data?.length || 0;

      // 🚨 UYARI: Veritabanında kayıt azalmış!
      if (dbLogCount < currentLogCount) {
        console.error('🚨 DİKKAT: Veritabanında kayıt azaldı!', {
          onceki: currentLogCount,
          simdi: dbLogCount,
          fark: currentLogCount - dbLogCount
        });
        
        const missingDays = Object.keys(currentLogs).filter(day => 
          !data?.find(log => log.day === parseInt(day))
        );
        
        alert(`🚨 UYARI: KENDİLİĞİNDEN SİLME TESPİT EDİLDİ!\n\n` +
          `Veritabanında ${currentLogCount - dbLogCount} kayıt eksik!\n\n` +
          `Eksik günler: ${missingDays.join(', ')}\n\n` +
          `❌ Bu kayıtlar BAŞKA BİR OTURUMDAN veya OTOMATIK bir işlemle silinmiş olabilir!\n\n` +
          `✅ Yerel kopyalarınız korundu.\n` +
          `🔄 Geri yüklemek için "Kurtarma Modu" butonunu kullanın.`);
        
        logChange('EXTERNAL_DELETE_DETECTED', {
          missingDays,
          previousCount: currentLogCount,
          currentCount: dbLogCount
        });
        
        // Otomatik geri yükleme öner
        if (confirm('🔄 Eksik kayıtları şimdi OTOMATIK olarak geri yüklemek ister misiniz?')) {
          await restoreMissingLogs(missingDays);
        }
      }
      
      setLastDbCheck(new Date());
      
    } catch (error) {
      console.error('❌ Veritabanı kontrol hatası:', error);
    }
  };

  // 🛡️ KATMAN 15: Eksik Kayıtları Geri Yükle
  const restoreMissingLogs = async (missingDays: string[]) => {
    if (!canManage) return;
    const logs = appData[selectedEmployeeId]?.[monthKey]?.logs || {};
    let restoredCount = 0;
    for (const dayText of missingDays) {
      const day = Number(dayText), log = logs[day];
      if (!log) continue;
      const key = selectedEmployeeId + ':' + currentYear + ':' + currentMonth + ':' + day;
      dailyVersions.current[key] = null;
      dailyConflicts.current.delete(key);
      await saveDailyLog(day, log);
      if (dailyVersions.current[key]) restoredCount++;
    }
    alert(restoredCount + ' eksik puantaj kaydı sunucu sürümü doğrulanarak geri yüklendi.');
    logChange('RESTORED_LOGS', { restoredDays: missingDays, count: restoredCount });
  };

  // 🛡️ KATMAN 16: Anlık Veri Snapshot (Anlık görüntü)
  const createDataSnapshot = () => {
    const snapshot = {
      timestamp: new Date().toISOString(),
      sessionId,
      data: JSON.parse(JSON.stringify(appData)),
      employees: JSON.parse(JSON.stringify(employees))
    };
    setDataSnapshot(snapshot);
    localStorage.setItem('bordro_last_snapshot', JSON.stringify(snapshot));
    
  };

  // 🛡️ KATMAN 17: Değişiklik Geçmişini Görüntüle
  const showChangeHistory = () => {
    const allHistory = JSON.parse(localStorage.getItem('bordro_change_history') || '[]');
    const recent = allHistory.slice(-20).reverse();
    
    let message = '📋 SON 20 DEĞİŞİKLİK GEÇMİŞİ:\n\n';
    
    recent.forEach((change: any, index: number) => {
      const date = new Date(change.timestamp);
      message += `${index + 1}. ${date.toLocaleString('tr-TR')}\n`;
      message += `   📌 ${change.action}\n`;
      if (change.action === 'EXTERNAL_DELETE_DETECTED') {
        message += `   ❌ Silinen günler: ${change.details.missingDays?.join(', ')}\n`;
      }
      message += '\n';
    });
    
    alert(message || 'Henüz değişiklik kaydı yok.');
  };

  // --- SUPABASE CRUD FONKSİYONLARI ---

  // Personelleri Yükle
  const loadEmployees = async () => {
    try {
      setLoading(true);
      
      
      const { data, error } = await supabase
        .from('bordro_employees')
        .select('*')
        .eq('active', true)
        .order('name');

      if (error) {
        console.error('❌ Supabase hatası:', error);
        
        alert('Personel bilgileri yüklenemedi. Bağlantı ve bordro yetkilerinizi kontrol edin; sorun sürerse şirket yöneticinize bildirin.');
        throw error;
      }

      

      const formattedEmployees = data.map(emp => ({
        id: emp.id,
        name: emp.name,
        tc_no: emp.tc_no,
        user_id: emp.user_id || null,
        agreedSalary: parseDecimal(emp.agreed_salary),
        officialSalary: parseDecimal(emp.official_salary)
      }));

      setEmployees(formattedEmployees);
      
      if (formattedEmployees.length > 0 && !selectedEmployeeId) {
        setSelectedEmployeeId(formattedEmployees[0].id);
      }
    } catch (error) {
      console.error('❌ Personel yükleme hatası:', error);
    } finally {
      setLoading(false);
    }
  };



  // Aylık Verileri Yükle
  const loadMonthlyData = async (employeeId: string, discardDraft = false) => {
    try {
      
      
      // Puantaj Kayıtları (sadece bu ay)
      const { data: logsData, error: logsError } = await supabase
        .from('bordro_daily_logs')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('month', currentMonth)
        .eq('year', currentYear);

      if (logsError) throw logsError;

      // Giderler (TÜM ZAMANLARIN - geçmiş taksitleri almak için)
      // Avanslar için: Veriliş tarihinden itibaren devam edenleri alacağız
      const { data: expensesData, error: expensesError } = await supabase
        .from('bordro_expenses')
        .select('*')
        .eq('employee_id', employeeId)
        .order('date', { ascending: false });

      if (expensesError) throw expensesError;

      // State'e Dönüştür
      if (discardDraft) { const period = `${employeeId}:${currentYear}:${currentMonth}:`; for (const key of Object.keys(dailyVersions.current)) if (key.startsWith(period)) delete dailyVersions.current[key]; }
      const logs: Record<number, DailyLog> = {};
      (logsData || []).forEach(log => {
        const key = `${employeeId}:${currentYear}:${currentMonth}:${log.day}`;
        if (discardDraft || (!dailyFailures.current.has(key) && !dailyQueues.current[key])) {
          dailyVersions.current[key] = log.updated_at || null;
          if (discardDraft) { dailyConflicts.current.delete(key); dailyFailures.current.delete(key); }
        }
        logs[log.day] = {
          day: log.day,
          type: log.type,
          startTime: log.start_time || '',
          endTime: log.end_time || '',
          overtimeHours: parseFloat(log.overtime_hours) || 0,
          description: log.description || '',
          updatedAt: log.updated_at || undefined
        };
      });

      // Giderleri filtrele - sadece bu ay için geçerli olanları al
      const expenses: Expense[] = [];
      (expensesData || []).forEach(exp => {
        const expDate = new Date(exp.date);
        const expMonth = expDate.getMonth();
        const expYear = expDate.getFullYear();
        
        // Eğer TAKSİTLİ kayıt ise (Avans, Prim, Kesinti vs. herhangi biri olabilir)
        const installmentTotal = exp.installment_total || 1;
        if (installmentTotal > 1) {
          // Taksitli kayıt - bu ay için geçerli mi kontrol et
          const monthsFromStart = (currentYear - expYear) * 12 + (currentMonth - expMonth);
          const currentInstallmentNumber = monthsFromStart + 1;
          
          
          
          // Bu ay için taksit devam ediyor mu?
          if (currentInstallmentNumber > 0 && currentInstallmentNumber <= installmentTotal) {
            expenses.push({
              id: exp.id,
              type: exp.type,
              amount: parseFloat(exp.amount),
              description: exp.description || '',
              date: exp.date,
              installment_total: installmentTotal,
              installment_current: currentInstallmentNumber // Şu anki taksit numarası
            });
          }
        } 
        // Tek seferlik kayıtlar - sadece bu aya ait olanları al
        else if (expMonth === currentMonth && expYear === currentYear) {
          expenses.push({
            id: exp.id,
            type: exp.type,
            amount: parseFloat(exp.amount),
            description: exp.description || '',
            date: exp.date,
            installment_total: installmentTotal,
            installment_current: exp.installment_current || 1
          });
        }
      });

      

      // 🔒 GÜVENLİK: Mevcut state verilerini ASLA silme, sadece veritabanından gelenleri ekle
      setAppData(prev => {
        const existingLogs = prev[employeeId]?.[monthKey]?.logs || {};
        
        // Veritabanından gelen verilerle mevcut verileri birleştir (veritabanı öncelikli)
        const mergedLogs = discardDraft ? { ...logs } : { ...existingLogs, ...logs };
        for (const [day, draft] of Object.entries(existingLogs)) { const key = `${employeeId}:${currentYear}:${currentMonth}:${day}`; if (!discardDraft && (dailyFailures.current.has(key) || dailyQueues.current[key])) mergedLogs[Number(day)] = draft; }
        
        
        
        return {
          ...prev,
          [employeeId]: {
            ...prev[employeeId],
            [monthKey]: { 
              month: currentMonth, 
              year: currentYear, 
              logs: mergedLogs, 
              expenses: expenses // ✅ VERİTABANI HER ZAMAN DOĞRUDUR - boş bile olsa veritabanını kullan
            }
          }
        };
      });
      return true;

    } catch (error) {
      console.error('❌ Aylık veri yükleme hatası:', error);
      return false;
    }
  };

  // Personel Kaydet/Güncelle
  const saveEmployee = async () => {
    if (!canManage) return;
    if (!employeeForm.name || !employeeForm.agreedSalary || !employeeForm.officialSalary) {
      alert("⚠️ Lütfen tüm zorunlu alanları doldurunuz:\n• Personel Adı\n• Ödenecek Maaş\n• Kayıtlı Maaş");
      return;
    }

    try {
      setLoading(true);
      
      
      const employeeData = {
        name: employeeForm.name,
        user_id: employeeForm.userId || null,
        tc_no: employeeForm.tcNo || null,
        agreed_salary: parseDecimal(employeeForm.agreedSalary),
        official_salary: parseDecimal(employeeForm.officialSalary),
        updated_at: new Date().toISOString()
      };

      if (editingEmployeeId) {
        // GÜNCELLEME
        
        const { error } = await supabase
          .from('bordro_employees')
          .update(employeeData)
          .eq('id', editingEmployeeId);

        if (error) {
          console.error('❌ Güncelleme hatası:', error);
          throw error;
        }
        
        await ActivityLogger.bordroEmployeeUpdate(employeeForm.name);
      } else {
        // YENİ EKLEME
        
        const { data, error } = await supabase
          .from('bordro_employees')
          .insert([{ ...employeeData, active: true }])
          .select();

        if (error) {
          console.error('❌ Ekleme hatası:', error);
          
          alert('Personel kaydedilemedi. ' + error.message + ' Bilgilerinizi kontrol edip yeniden deneyin.');
          throw error;
        }
        
        
        if (data && data[0]) {
          setSelectedEmployeeId(data[0].id);
        }
        await ActivityLogger.bordroEmployeeCreate(employeeForm.name);
      }

      await loadEmployees();
      setShowEmployeeModal(false);
      setEmployeeForm({ name: '', tcNo: '', agreedSalary: '', officialSalary: '', userId: '' });
      setEditingEmployeeId(null);
      
      alert('✅ Personel başarıyla kaydedildi!');
      
    } catch (error) {
      console.error('❌ Personel kayıt hatası:', error);
      // Hata mesajı zaten yukarıda gösterildi
    } finally {
      setLoading(false);
    }
  };

  // 🔒 Personel Sil (Soft Delete - Veriler korunur)
  const deleteEmployee = async (empId: string, empName: string) => {
    if (!canManage) return;
    // UYARI: Gerçekte silmiyoruz, sadece "active=false" yapıyoruz
    const warningMessage = `⚠️ DİKKAT: ${empName} isimli personeli silmek üzeresiniz!\n\n` +
      `🔒 GÜVENLİK BİLGİSİ:\n` +
      `• Personel "pasif" yapılacak (gerçekten silinmeyecek)\n` +
      `• Tüm puantaj kayıtları VERİTABANINDA KORUNACAK\n` +
      `• Gerekirse tekrar aktif hale getirilebilir\n\n` +
      `📋 Personel sadece listeden gizlenecektir.\n\n` +
      `Devam etmek istiyor musunuz?`;
    
    if (!confirm(warningMessage)) {
      
      return;
    }

    // 🛡️ KATMAN 11: Güvenlik Kodu Kontrolü
    if (!verifyDeleteCode(`${empName} personeli`)) {
      return;
    }

    // İkinci onay
    if (!confirm(`⚠️ SON ONAY\n\n${empName} personelini pasif yapmak istediğinize emin misiniz?\n\n(Puantaj kayıtları korunacak)`)) {
      
      return;
    }

    try {
      setLoading(true);
      
      
      // Personeli pasif yap (soft delete - veriler korunur)
      const { error } = await supabase
        .from('bordro_employees')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', empId);

      if (error) throw error;
      
      await ActivityLogger.bordroEmployeeDelete(empName);
      await loadEmployees();
      
      // Silinen personel seçiliyse, seçimi temizle
      if (selectedEmployeeId === empId) {
        setSelectedEmployeeId(employees.length > 1 ? employees[0].id : '');
      }
      
      alert(`✅ ${empName} listeden kaldırıldı.\n\n🔒 Not: Tüm puantaj kayıtları veritabanında güvenle saklanmaktadır.\n\n💡 Gerekirse personeli tekrar aktif yapabilirsiniz.`);
      
    } catch (error) {
      console.error('❌ Personel silme hatası:', error);
      alert('❌ İşlem başarısız!\n\nHata: ' + (error as any)?.message);
    } finally {
      setLoading(false);
    }
  };

  // Puantaj Kaydı Kaydet
  const saveDailyLog = (day: number, log: DailyLog): Promise<void> => {
    if (!canManage || !log.type) return Promise.resolve();
    const employeeId = selectedEmployeeId, month = currentMonth, year = currentYear;
    const periodKey = year + '-' + month;
    const key = employeeId + ':' + year + ':' + month + ':' + day;
    const pendingKey = key;
    const payload = { type: log.type, start_time: log.startTime || '', end_time: log.endTime || '', overtime_hours: log.overtimeHours || 0, description: log.description || '' };
    setSaveStatus('saving');
    let saved = false;
    const job = (dailyQueues.current[key] || Promise.resolve()).then(async () => {
      if (dailyConflicts.current.has(key)) throw new Error('Bu gün başka bir oturumda değişti. Kaydedilmemiş bilgilerinizi not edip güncel dönemi yeniden yükleyin.');
      const { data, error } = await supabase.rpc('app_bordro_daily_log_save', {
        p_employee_id: employeeId, p_day: day, p_month: month, p_year: year,
        p_log: payload, p_expected_updated_at: dailyVersions.current[key] ?? null
      });
      if (error) { if (isPayrollConflict(error) || /conflict|çakış|stale/i.test([error.code,error.message].join(' '))) dailyConflicts.current.add(key); throw error; }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.updated_at) throw new Error('Sunucu puantaj sürümünü doğrulamadı.');
      dailyVersions.current[key] = row.updated_at;
      saved = true;
      dailyFailures.current.delete(key);
      setAppData(previous => {
        const period = previous[employeeId]?.[periodKey];
        if (!period?.logs[day]) return previous;
        return { ...previous, [employeeId]: { ...previous[employeeId], [periodKey]: { ...period, logs: { ...period.logs, [day]: { ...period.logs[day], updatedAt: row.updated_at } } } } };
      });
      saveToLocalStorage(log, 'log_' + employeeId + '_' + day + '_' + periodKey);
      logChange('SAVE_DAILY_LOG', { day, type: log.type });
    }).catch(error => {
      dailyFailures.current.add(key);
      setSaveStatus('error'); setHasUnsavedChanges(true);
      alert('Puantaj kaydedilemedi. Girdiğiniz bilgiler bu ekranda korunuyor. ' + (error?.message || 'Bağlantıyı kontrol edin.'));
    });
    dailyQueues.current[key] = job;
    return job.then(() => {
      if (!saved || dailyQueues.current[key] !== job || dailyConflicts.current.has(key)) return;
      delete dailyQueues.current[key];
      setPendingSaves(previous => { const next = new Set(previous); next.delete(pendingKey); if (!next.size) setHasUnsavedChanges(false); return next; });
      setSaveStatus(dailyFailures.current.size ? 'error' : 'saved');
    });
  };

  // Gider Kaydet
  const saveExpense = async (expense: Expense) => {
    if (!canManage) return;
    try {
      const expenseData = {
        id: expense.id,
        employee_id: selectedEmployeeId,
        month: currentMonth,
        year: currentYear,
        type: expense.type,
        amount: expense.amount,
        description: expense.description,
        date: expense.date,
        installment_total: expense.installment_total || 1,
        installment_current: expense.installment_current || 1
      };

      const { error } = await supabase
        .from('bordro_expenses')
        .upsert(expenseData);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Gider kayıt hatası:', error);
      alert('Gider kaydedilemedi. Formdaki bilgiler korunuyor.');
      return false;
    }
  };

  // 🔒 Gider/Avans Sil (Çift onaylı güvenli silme)
  const deleteExpenseFromDB = async (id: string) => {
    if (!canManage) return;
    try {
      
      
      // 🔐 Yetkili client kullan (RLS/policy tarafında izinli işlem)
      const { error } = await adminSupabase
        .from('bordro_expenses')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('❌ DELETE ERROR:', error);
        throw new Error(`Silme hatası: ${error.message}`);
      }
      
      
      
    } catch (error) {
      console.error('❌ Gider silme hatası:', error);
      alert('❌ Veritabanından silme başarısız!\n\nHata: ' + (error as any)?.message);
      throw error;
    }
  };

  // 🚫 PUANTAJ SİLME TAMAMEN DEVRE DIŞI!
  // Bu fonksiyon artık ASLA çağrılmayacak
  const deleteDailyLog = async (day: number) => {
    if (!canManage) return;
    console.error('🚫 SİLME İŞLEMİ ENGELLENDİ! Bu fonksiyon güvenlik nedeniyle devre dışı bırakılmıştır.');
    alert('🚫 KAYIT SİLİNEMEZ!\n\n🔒 Güvenlik politikası gereği puantaj kayıtları silinemez.\n\n💡 Çözüm: Çalışmadığı günleri "Gelmedi", "İzinli" veya "Raporlu" olarak işaretleyin.');
    return; // Hiçbir şey yapma
    
    /* SİLME KODU DEVRE DIŞI
    try {
      console.log('🗑️ Puantaj siliniyor:', { employee: selectedEmployeeId, day, month: currentMonth, year: currentYear });
      
      const { error } = await supabase
        .from('bordro_daily_logs')
        .delete()
        .eq('employee_id', selectedEmployeeId)
        .eq('day', day)
        .eq('month', currentMonth)
        .eq('year', currentYear);

      if (error) throw error;
      console.log('✅ Puantaj veritabanından silindi:', day);
      
    } catch (error) {
      console.error('❌ Puantaj silme hatası:', error);
      alert('⚠️ Kayıt silinirken hata oluştu!\n\nHata: ' + (error as any)?.message);
    }
    */
  };

  // --- AYLIK BORDRO KAYDET ---
  const saveMonthlyPayroll = async () => {
    if (!canManage) return;
    // Bekleyen kayıtları kontrol et
    if (pendingSaves.size > 0) {
      alert('⚠️ Lütfen bekleyin! Kaydedilmemiş değişiklikler var. Tüm değişiklikler kaydedildikten sonra tekrar deneyin.');
      return;
    }

    if (!confirm(`${currentYear} yılı ${MONTHS[currentMonth]} ayı bordrosunu kaydetmek istediğinize emin misiniz?\n\n✅ Tüm puantaj verileri, mesai saatleri ve notlar veritabanında güvenle saklanmıştır.\n✅ Bu işlem sadece aylık özet raporu oluşturur.\n✅ Verileriniz kaybolmaz, istediğiniz zaman tekrar görüntüleyebilirsiniz.`)) {
      return;
    }

    try {
      setLoading(true);
      
      // Önce tüm güncel verilerin kaydedildiğinden emin ol
      
      
      // Read persisted source rows; closing a summary must never rewrite employee logs.
      const readAll = async (query: (from: number, to: number) => any) => {
        const result: any[]=[];
        for(let from=0;from<500000;from+=1000){const {data,error}=await query(from,from+999);if(error)throw error;result.push(...(data||[]));if((data||[]).length<1000)return result;}
        throw new Error('Özet için kayıt sınırı aşıldı. Şirket yöneticinize bildirin.');
      };
      const [employeeRows,logRows,expenseRows]=await Promise.all([
        readAll((from,to)=>supabase.from('bordro_employees').select('*').eq('active',true).order('id').range(from,to)),
        readAll((from,to)=>supabase.from('bordro_daily_logs').select('*').eq('month',currentMonth).eq('year',currentYear).order('id').range(from,to)),
        readAll((from,to)=>supabase.from('bordro_expenses').select('*').order('id').range(from,to))
      ]);
      const sourceEmployees=employeeRows.map(row=>({id:row.id,name:row.name,agreedSalary:parseDecimal(row.agreed_salary),officialSalary:parseDecimal(row.official_salary)}));
      const summaries=[];
      for (const emp of sourceEmployees) {
        const empData = buildMonthlyPayrollData(emp.id,logRows,expenseRows,currentMonth,currentYear);
        const stats = calculateEmployeeStats(emp, empData, daysInMonth, currentMonth, currentYear);

        const payrollData = {
          employee_id: emp.id,
          month: currentMonth,
          year: currentYear,
          employee_name: emp.name,
          agreed_salary: emp.agreedSalary,
          official_salary: emp.officialSalary,
          days_worked: stats.totalWorkDays,
          sunday_days: stats.totalSundayDays,
          overtime_hours: stats.totalOvertimeHours,
          advances: stats.totalAdvances,
          expenses: stats.totalExpenses,
          bonuses: stats.totalBonuses,
          net_payable: stats.netPayable,
          hand_pay: stats.remainingHandPay
        };

        summaries.push(payrollData);
      }
      if(!summaries.length)throw new Error('Özetlenecek aktif personel bulunamadı.');
      const {error}=await supabase.from('monthly_payroll_summary').upsert(summaries,{onConflict:'employee_id,month,year'});
      if(error)throw error;
      await ActivityLogger.bordroMonthlySave(currentMonth+1,currentYear,sourceEmployees.length);
      alert(`✅ ${MONTHS[currentMonth]} ${currentYear} bordro özeti sunucudaki güncel kayıtlardan oluşturuldu.\n\n${sourceEmployees.length} personel özetlendi. Asıl puantaj ve gider kayıtları değiştirilmedi. Geçmiş Bordrolar'dan görüntüleyebilirsiniz; dönem kayıtları düzenlenirse özeti yeniden oluşturun.`);
    } catch (error) {
      console.error('Bordro kaydetme hatası:', error);
      alert('❌ Bordro kaydedilirken bir hata oluştu!\n\nHata: ' + (error as any)?.message);
    } finally {
      setLoading(false);
    }
  };

  // --- GEÇMİŞ BORDROLARI YÜKLE ---
  const loadHistoricalPayroll = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('monthly_payroll_summary')
        .select('*')
        .eq('month', historyMonth)
        .eq('year', historyYear)
        .order('employee_name');

      if (error) throw error;
      
      setHistoricalData(data || []);
      setShowHistoryModal(true);
    } catch (error) {
      console.error('Geçmiş bordro yükleme hatası:', error);
      alert('❌ Geçmiş bordro yüklenirken bir hata oluştu!');
    } finally {
      setLoading(false);
    }
  };

  // --- İLK YÜKLEME ---
  useEffect(() => {
    loadEmployees();
  }, []);

  // 🛡️ KATMAN 9: Otomatik Periyodik Yedekleme (Her 30 saniyede)
  useEffect(() => {
    // İlk yedekleme
    createAutoBackup();
    
    // Periyodik yedekleme
    backupIntervalRef.current = setInterval(() => {
      createAutoBackup();
    }, 30000); // 30 saniye

    return () => {
      if (backupIntervalRef.current) {
        clearInterval(backupIntervalRef.current);
      }
    };
  }, [appData, employees]);

  // 🛡️ KATMAN 10: Sayfa Kapatma Uyarısı (Kaydedilmemiş değişiklik varsa)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingSaves.size > 0 || hasUnsavedChanges) {
        const message = '⚠️ Kaydedilmemiş değişiklikleriniz var! Sayfayı kapatmak istediğinizden emin misiniz?';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    const changingModule = (event: Event) => { if (pendingSaves.size > 0 || hasUnsavedChanges) { event.preventDefault(); alert('Kaydedilmemiş puantaj değişiklikleriniz var. Bilgilerinizi kaydedin veya güncel dönemi yeniden yükleyerek karşılaştırın; sonra modül değiştirebilirsiniz.'); } };
    window.addEventListener('vg:before-module-change', changingModule);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('vg:before-module-change', changingModule);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [pendingSaves, hasUnsavedChanges]);

  // 🛡️ KATMAN 14: Veritabanı Değişiklik Kontrolü (Her 10 saniyede)
  useEffect(() => {
    // İlk kontrol
    if (selectedEmployeeId) {
      if (canManage) checkDatabaseChanges();
    }
    
    // Periyodik kontrol
    dbCheckIntervalRef.current = setInterval(() => {
      if (selectedEmployeeId) {
        checkDatabaseChanges();
      }
    }, 10000); // 10 saniye

    return () => {
      if (dbCheckIntervalRef.current) {
        clearInterval(dbCheckIntervalRef.current);
      }
    };
  }, [selectedEmployeeId, monthKey, appData]);

  // 🛡️ KATMAN 16: Her değişiklikte snapshot oluştur
  useEffect(() => {
    if (Object.keys(appData).length > 0) {
      createDataSnapshot();
    }
  }, [appData]);

  // Personel listesi yüklendiğinde, tüm personeller için aylık verileri yükle
  useEffect(() => {
    if (employees.length > 0) {
      
      // Sırayla yükle (yarış koşulunu önle)
      const loadAllData = async () => {
        for (const emp of employees) {
          await loadMonthlyData(emp.id);
        }
      };
      loadAllData();
    }
  }, [employees.length, monthKey]);

  // Personel veya Ay Değiştiğinde Verileri Yükle
  useEffect(() => {
    if (selectedEmployeeId) {
      // Veri yoksa veya yüklenmediyse yükle
      const hasData = appData[selectedEmployeeId]?.[monthKey];
      if (!hasData) {
        
        loadMonthlyData(selectedEmployeeId);
      }
    }
  }, [selectedEmployeeId, monthKey]);

  // Veri İlklendirme - SADECE VERİTABANINDA VERİ YOKSA
  useEffect(() => {
    if (employees.length > 0 && !employees.find(e => e.id === selectedEmployeeId)) {
        setSelectedEmployeeId(employees[0].id);
    }
    
    // 🔒 GÜVENLİK: SADECE veritabanından yükleme tamamlandıktan SONRA
    // ve logs TAMAMEN boşsa otomatik doldur
    if (canManage && selectedEmployeeId && appData[selectedEmployeeId]?.[monthKey]) {
      const currentLogs = appData[selectedEmployeeId][monthKey].logs;
      const hasAnyLogs = Object.keys(currentLogs).length > 0;
      
      // Eğer hiç kayıt yoksa, kullanıcıya sor ve otomatik doldur
      if (!hasAnyLogs && !loading) {
        
        setTimeout(() => {
          const autoFill = window.confirm(`📋 ${selectedEmployee.name} için ${MONTHS[currentMonth]} ${currentYear} ayında hiç puantaj kaydı yok.\n\n🤖 Tüm günleri otomatik olarak doldurulsun mu?\n\n✅ Evet: Normal mesai ile doldurur\n❌ Hayır: Manuel giriş yaparsınız`);
          if (autoFill) {
            fillMonthDefaults();
          }
        }, 800);
      } else if (hasAnyLogs) {
        
      }
    }
  }, [selectedEmployeeId, monthKey, appData[selectedEmployeeId]?.[monthKey]?.logs, loading]);

  const currentData = appData[selectedEmployeeId]?.[monthKey] || { month: currentMonth, year: currentYear, logs: {}, expenses: [] };
  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId) || { id: '0', name: '', agreedSalary: 0, officialSalary: 0 };

  const currentStats = useMemo(() => 
    calculateEmployeeStats(selectedEmployee, currentData, daysInMonth, currentMonth, currentYear), 
  [selectedEmployee, currentData, daysInMonth, currentMonth, currentYear]);

  // --- HANDLERS ---

  const handleLogChange = (day: number, field: keyof DailyLog, value: any) => {
    if (!canManage) return;
    
    
    // 🛡️ Kaydedilmemiş değişiklik bayrağını kaldır
    setHasUnsavedChanges(true);
    
    setAppData(prev => {
      const newData = { ...prev };
      if(!newData[selectedEmployeeId]) newData[selectedEmployeeId] = {};
      if(!newData[selectedEmployeeId][monthKey]) {
        newData[selectedEmployeeId][monthKey] = { month: currentMonth, year: currentYear, logs: {}, expenses: [] };
      }

      // Mevcut logs'u al veya yeni oluştur
      const currentLogs = { ...newData[selectedEmployeeId][monthKey].logs };
      
      if (!currentLogs[day]) {
        const { isSaturday, isSunday } = isWeekend(day, currentMonth, currentYear);
        currentLogs[day] = {
          day,
          type: isSunday ? 'Pazar' : 'Normal',
          startTime: DEFAULT_START_TIME,
          endTime: isSaturday ? DEFAULT_END_TIME_SATURDAY : DEFAULT_END_TIME_WEEKDAY,
          overtimeHours: 0,
          description: ''
        };
      } else {
        // Mevcut log'u clone et
        currentLogs[day] = { ...currentLogs[day] };
      }

      // Alan güncelle
      (currentLogs[day] as any)[field] = value;

      // Otomatik Mesai Hesaplama
      if (field === 'endTime' || field === 'startTime' || field === 'type') {
        const log = currentLogs[day];
        const { isSaturday, isSunday } = isWeekend(day, currentMonth, currentYear);
        
        const endHour = parseInt(log.endTime.split(':')[0]);
        let autoOvertime = 0;

        if (log.type === 'Normal') {
            if (isSaturday && endHour > 13) autoOvertime = endHour - 13;
            else if (!isSaturday && !isSunday && endHour > 18) autoOvertime = endHour - 18;
        }
        currentLogs[day].overtimeHours = autoOvertime > 0 ? autoOvertime : 0;
      }

      
      
      // 🚫 SİLME İŞLEMİ TAMAMEN DEVRE DIŞI!
      // Kullanıcı type'ı boş yapmaya çalışırsa, "İzinli" olarak işaretle
      if (field === 'type' && (!value || value === '')) {
        alert('⚠️ KAYIT SİLİNEMEZ!\n\n📋 Bir günü silmek yerine "Gelmedi", "İzinli" veya "Raporlu" olarak işaretleyebilirsiniz.\n\n🔒 Tüm kayıtlar güvenlik nedeniyle korunmaktadır.');
        
        // Değişikliği iptal et, önceki değeri koru
        
        return prev; // HİÇBİR DEĞİŞİKLİK YAPMA
      }
      
      // ⚠️ UYARI: "İzinli" veya "Raporlu" günler hesaplamaya dahil edilmez
      // ama kayıt korunur ve veritabanında saklanır
      
      // IMMUTABILITY: Yeni nested object oluştur
      newData[selectedEmployeeId] = {
        ...newData[selectedEmployeeId],
        [monthKey]: {
          ...newData[selectedEmployeeId][monthKey],
          logs: currentLogs
        }
      };
      
      // Pending kayıt listesine ekle
      setPendingSaves(prev => new Set(prev).add(`${selectedEmployeeId}:${currentYear}:${currentMonth}:${day}`));
        
      // Hızlı kaydetme - timeout olmadan anında kaydet
      saveDailyLog(day, currentLogs[day]);

      return newData;
    });
  };

  const addExpense = (type: 'Avans' | 'Gider' | 'Prim') => {
    if (!canManage) return;
    setAdvanceForm({ 
      amount: '', 
      date: localISODate(), 
      type,
      installmentTotal: '1',
      installmentCurrent: '1'
    });
    setShowAdvanceModal(true);
  };

  const handleAdvanceSubmit = async () => {
    if (!canManage) return;
    if(advanceSaveInFlight.current)return;
    if (!(parseDecimal(advanceForm.amount, null) > 0)) {
      alert('⚠️ Lütfen geçerli bir tutar giriniz!');
      return;
    }

    const totalAmount = parseDecimal(advanceForm.amount);
    const installmentTotal = advanceForm.type==='Avans'?Number(advanceForm.installmentTotal || 1):1;

    if (!Number.isInteger(installmentTotal) || installmentTotal < 1 || installmentTotal > 24) {
      alert('⚠️ Taksit sayısı 1-24 arasında olmalıdır!');
      return;
    }
    
    // ÖNEMLI: TOPLAM tutarı kaydet, her ay hesaplama sırasında bölünecek
    const fingerprint=JSON.stringify({employee:selectedEmployeeId,month:currentMonth,year:currentYear,type:advanceForm.type,amount:totalAmount,date:advanceForm.date,installmentTotal});
    if(advanceRequestRef.current?.fingerprint!==fingerprint)advanceRequestRef.current={id:crypto.randomUUID(),fingerprint};
    const newExpense: Expense = {
      id: advanceRequestRef.current.id,
      type: advanceForm.type,
      amount: totalAmount, // TOPLAM TUTAR (bölünmeden)
      description: advanceForm.type === 'Avans' && installmentTotal > 1 
        ? `Taksitli Avans - ${installmentTotal} ay (kuruşlar aylara tam dağıtılır)`
        : `${advanceForm.type}`,
      date: advanceForm.date,
      installment_total: installmentTotal,
      installment_current: 1 // Her zaman 1'den başlar
    };

    // ✅ ÖNCE VERİTABANINA KAYDET (başarısız olursa state'e dokunma)
    advanceSaveInFlight.current=true;
    let saved=false;try{saved=await saveExpense(newExpense);}finally{advanceSaveInFlight.current=false;}
    if(!saved)return;
    advanceRequestRef.current=null;

    // ✅ BAŞARILI OLDUYSA State güncellemesi - IMMUTABILITY KORUNARAK
    setAppData(prev => {
       const newData = {...prev};
       
       // Eğer personel verisi yoksa oluştur
       if(!newData[selectedEmployeeId]) {
         newData[selectedEmployeeId] = {};
       }
       
       // Eğer ay verisi yoksa oluştur
       if(!newData[selectedEmployeeId][monthKey]) {
         newData[selectedEmployeeId][monthKey] = { month: currentMonth, year: currentYear, logs: {}, expenses: [] };
       }
       
       // IMMUTABILITY: Yeni nested object ve array oluştur
       newData[selectedEmployeeId] = {
         ...newData[selectedEmployeeId],
         [monthKey]: {
           ...newData[selectedEmployeeId][monthKey],
           expenses: [...newData[selectedEmployeeId][monthKey].expenses, newExpense]
         }
       };
       
       return newData;
    });
    
    // Modal'ı kapat ve formu sıfırla
    setShowAdvanceModal(false);
    setAdvanceForm({ 
      amount: '', 
      date: localISODate(), 
      type: 'Avans',
      installmentTotal: '1',
      installmentCurrent: '1'
    });
    
    if (advanceForm.type === 'Avans' && installmentTotal > 1) {
      const monthlyAmount = monthlyAdvanceAmount(newExpense,currentYear,currentMonth);
      alert(
        `✅ Taksitli Avans Başarıyla Eklendi!\n\n` +
        `💰 Toplam Tutar: ${formatCurrency(totalAmount)}\n` +
        `📊 Seçili Ay Taksiti: ${formatCurrency(monthlyAmount)}\n` +
        `📅 Taksit Süresi: ${installmentTotal} ay\n` +
        `📆 Başlangıç: ${new Date(advanceForm.date).toLocaleDateString('tr-TR')}\n\n` +
        `🔄 Taksitler avans tarihinden itibaren uygulanır; kuruş farkları ilk aylara dağıtılarak toplam tutar korunur.`
      );
    } else {
      alert(`✅ ${advanceForm.type} başarıyla eklendi!\n\n💰 Tutar: ${formatCurrency(totalAmount)}`);
    }
  };

  const deleteExpense = async (id: string) => {
    if (!canManage) return;
    // 🔒 GÜVENLİK: Gerçekten silmek yerine onay iste
    const expense = currentData.expenses.find(e => e.id === id);
    if (!expense) return;
    
    // 📋 DEBUG: Silinecek kayıt detayları
    
    
    // ⚠️ TAKSİTLİ KAYIT KONTROLÜ (Avans, Prim, Kesinti - HERŞEY)
    const isTaksitli = (expense.installment_total || 1) > 1;
    const currentTaksit = expense.installment_current || 1;
    const totalTaksit = expense.installment_total || 1;
    const installmentAmount = monthlyAdvanceAmount(expense, currentYear, currentMonth);
    
    
    
    if (isTaksitli) {
      const taksitMessage = `
🚨 TAKSİTLİ KAYIT SİLME UYARISI

Bu kayıt taksitli bir ${expense.type} kaydıdır:
━━━━━━━━━━━━━━━━━━━━━
💰 Toplam Tutar: ${formatCurrency(expense.amount)}
📊 Taksit Planı: ${totalTaksit} ay
🔢 Şu anki ay: ${currentTaksit}/${totalTaksit} (bu dönem ${formatCurrency(installmentAmount)})
📝 Açıklama: ${expense.description || '-'}
━━━━━━━━━━━━━━━━━━━━━

⚠️ ÖNEMLİ: Bu kaydı sildiğinizde TÜM TAKSİT PLANI silinecek!
Yani ${totalTaksit} aylık tüm taksitler iptal olacak.

Kalan ${totalTaksit - currentTaksit} aylık taksitler de kesilmeyecek.

TÜM TAKSİT PLANINI silmek istiyor musunuz?
      `.trim();
      
      if (!window.confirm(taksitMessage)) {
        
        return;
      }
    }
    
    const confirmMessage = `⚠️ Bu kaydı silmek istediğinizden EMİN misiniz?\n\n` +
      `Tür: ${expense.type}\n` +
      `Tutar: ${isTaksitli ? `Bu dönem ${formatCurrency(installmentAmount)} (${totalTaksit} ay, Toplam: ${formatCurrency(expense.amount)})` : formatCurrency(expense.amount)}\n` +
      `Açıklama: ${expense.description}\n\n` +
      (isTaksitli ? `⚠️ TÜM TAKSİT PLANI SİLİNECEK!\n\n` : '') +
      `🔒 Bu işlem GERİ ALINAMAZ!\n\n` +
      `💡 Emin değilseniz İPTAL edin!`;
    
    if (!window.confirm(confirmMessage)) {
      
      return;
    }
    
    // 🛡️ KATMAN 11: Güvenlik Kodu Kontrolü
    if (!verifyDeleteCode(`${expense.type} kaydı (${formatCurrency(expense.amount)})`)) {
      return;
    }
    
    // İkinci onay (ekstra güvenlik)
    const finalConfirm = isTaksitli
      ? `⚠️ SON ONAY\n\nGerçekten ${totalTaksit} aylık taksit planının TAMAMINI silmek istediğinize emin misiniz?\n\nToplam: ${formatCurrency(expense.amount)}\n\nBu işlem GERİ ALINAMAZ!`
      : `⚠️ SON ONAY\n\nGerçekten ${formatCurrency(expense.amount)} tutarındaki ${expense.type} kaydını silmek istediğinize emin misiniz?\n\nBu işlem GERİ ALINAMAZ!`;
    
    if (!window.confirm(finalConfirm)) {
      
      return;
    }
    
    try {
      
      
      
      // ✅ ÖNCE VERİTABANINDAN SİL (başarısız olursa state'e dokunma)
      await deleteExpenseFromDB(id);
      
      
      // ✅ BAŞARILI OLDUYSA State güncellemesi - IMMUTABILITY KORUNARAK
      setAppData(prev => {
          const newData = {...prev};
          
          // IMMUTABILITY: Yeni nested object ve filtered array oluştur
          newData[selectedEmployeeId] = {
            ...newData[selectedEmployeeId],
            [monthKey]: {
              ...newData[selectedEmployeeId][monthKey],
              expenses: newData[selectedEmployeeId][monthKey].expenses.filter(e => e.id !== id)
            }
          };
          
          return newData;
      });
      
      alert('✅ Kayıt silindi.\n\n⚠️ Not: Veritabanından tamamen silindi, geri getirişlemez!');
    } catch (error) {
      console.error('❌ Silme hatası:', error);
      alert('❌ Silme işlemi başarısız oldu!\n\nHata: ' + (error as any)?.message);
    }
  };

  const fillMonthDefaults = () => {
    if (!canManage) return;
    // 🔒 GÜVENLİK: SADECE boş günleri doldur, mevcut kayıtlara ASLA dokunma
    
    let filledCount = 0;
    let skippedCount = 0;
    
    for (let i = 1; i <= daysInMonth; i++) {
      const existingLog = currentData.logs[i];
      
      // Eğer gün zaten doluysa ATLA
      if (existingLog && existingLog.type) {
        
        skippedCount++;
        continue;
      }
      
      // Sadece boş günleri doldur
      const { isSaturday, isSunday } = isWeekend(i, currentMonth, currentYear);
      
      // Pazar günü Normal olarak işaretle ama mesai saati 0
      if (isSunday) {
        handleLogChange(i, 'type', 'Normal');
        handleLogChange(i, 'startTime', '08:00');
        handleLogChange(i, 'endTime', '08:00'); // Mesai saati 0
      }
      // Cumartesi günü Normal olarak işaretle ama mesai saati 0
      else if (isSaturday) {
        handleLogChange(i, 'type', 'Normal');
        handleLogChange(i, 'startTime', '08:00');
        handleLogChange(i, 'endTime', '08:00'); // Mesai saati 0
      }
      // Hafta içi normal mesai
      else {
        handleLogChange(i, 'type', 'Normal');
        handleLogChange(i, 'startTime', '08:00');
        handleLogChange(i, 'endTime', '18:00');
      }
      filledCount++;
    }
    
    
    alert(`✅ ${filledCount} boş gün otomatik dolduruldu.\n🔒 ${skippedCount} mevcut kayıt korundu.`);
  };

  const openAddModal = () => {
    if (!canManage) return;
    setEmployeeForm({ name: '', tcNo: '', agreedSalary: '', officialSalary: '', userId: '' });
    setEditingEmployeeId(null);
    setShowEmployeeModal(true);
  };

  const openEditModal = (emp: Employee) => {
    if (!canManage) return;
    setEmployeeForm({ 
        name: emp.name,
        tcNo: emp.tc_no || '',
        userId: emp.user_id || '',
        agreedSalary: emp.agreedSalary.toString(), 
        officialSalary: emp.officialSalary.toString() 
    });
    setEditingEmployeeId(emp.id);
    setShowEmployeeModal(true);
  };

  const goToDetail = (empId: string) => {
      setSelectedEmployeeId(empId);
      setActiveTab('detail');
  };

  // --- EXCEL & PDF EXPORT FONKSİYONLARI ---

  // Excel Export - Tüm Personel
  const exportToExcel = async () => {
    try {
      const exportData = employees.map(emp => {
        const empData = appData[emp.id]?.[monthKey];
        const stats = calculateEmployeeStats(emp, empData, daysInMonth, currentMonth, currentYear);
        
        return {
          'Personel': emp.name,
          'TC No': emp.tc_no || '',
          'Anlaşılan Maaş': emp.agreedSalary,
          'Resmi Maaş': emp.officialSalary,
          'Günlük Mesai Ücret (30 güne göre)': stats.dailyRate.toFixed(2),
          'Saatlik Mesai Ücret (x1.5)': (stats.hourlyRate * 1.5).toFixed(2),
          'Çalışılan Gün': stats.totalWorkDays,
          'Mesai Saati': stats.totalOvertimeHours,
          'Mesai Ücreti': stats.overtimePay.toFixed(2),
          'Pazar Farkı': stats.totalSundayPay.toFixed(2),
          'Ekstra Ödemeler': stats.totalExtras.toFixed(2),
          'Brüt Hakediş': stats.grossTotal.toFixed(2),
          'Avanslar': stats.totalAdvances.toFixed(2),
          'Net Hakediş': stats.netPayable.toFixed(2),
          'Resmi Maaş (Ödenecek)': stats.officialPay.toFixed(2),
          'Ek Ödeme': (stats.netPayable - stats.officialPay).toFixed(2),
          'TOPLAM ÖDENECEK': stats.netPayable.toFixed(2)
        };
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `${currentYear}-${currentMonth + 1}`);
      
      // Kolon genişlikleri
      ws['!cols'] = [
        { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, 
        { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
        { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }
      ];

      XLSX.writeFile(wb, `Bordro_${currentYear}_${currentMonth + 1}.xlsx`);
      await ActivityLogger.bordroExportExcel(currentMonth + 1, currentYear);
      alert('✅ Excel dosyası başarıyla indirildi!');
    } catch (error) {
      console.error('Excel export hatası:', error);
      alert('❌ Excel oluşturulurken hata oluştu!');
    }
  };

  // PDF Export - Tek Personel Bordrosu
  const exportSinglePDF = async (employee: Employee) => {
    try {
      const empData = appData[employee.id]?.[monthKey];
      const stats = calculateEmployeeStats(employee, empData, daysInMonth, currentMonth, currentYear);
      
      const doc = await createReportPDF({ title: 'Personel Bordro Raporu' });
      
      // Logo (eğer varsa)
      let startY = 20;
      if (logo) {
        try {
          // Otomatik format tespiti
          const format = logo.startsWith('data:image/png') ? 'PNG' : 
                        logo.startsWith('data:image/jpeg') || logo.startsWith('data:image/jpg') ? 'JPEG' :
                        logo.startsWith('data:image/svg') ? 'PNG' : 'PNG';
          
          // Logo boyutunu optimize et - aspect ratio korunsun
          const logoWidth = 40;
          const logoHeight = 40;
          fitReportImage(doc, logo, 15, 10, 40, 30);
          startY = 55;
          
        } catch (e) {
          console.error('Logo eklenemedi:', e);
        }
      }
      
      // Header - Türkçe karakter desteği için Unicode kullan
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(30, 58, 138);
      const title = 'VOLTGUARD';
      doc.text(title, 105, startY, { align: 'center' });
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text('PERSONEL BORDROSU', 105, startY + 8, { align: 'center' });
      
      // Çizgi
      doc.setDrawColor(30, 58, 138);
      doc.setLineWidth(0.5);
      doc.line(20, startY + 12, 190, startY + 12);
      
      // Personel Bilgileri
      doc.setFontSize(10);
      doc.setTextColor(0);
      const employeeName = employee.name;
      doc.text(`Personel: ${employeeName}`, 20, startY + 22);
      
      const monthNames = MONTHS;
      doc.text(`Dönem: ${monthNames[currentMonth]} ${currentYear}`, 20, startY + 28);
      
      // Avans detayları için body oluştur
      const bordroBody: any[] = [
        ['Anlaşılan Net Maaş', reportMoney(employee.agreedSalary)],
        ['Mesai Ücreti (x1.5)', reportMoney(stats.overtimePay)],
        ['Pazar/Tatil Farkı', reportMoney(stats.totalSundayPay)],
        ['Devamsızlık Kesintisi', '- ' + reportMoney(stats.absentDeduction)],
        ['Ek Ödemeler (Prim/Gider)', reportMoney(stats.totalExtras)],
        ['', ''],
        ['BRÜT HAKEDİŞ', reportMoney(stats.grossTotal)],
        ['Kesinti (Avanslar)', '- ' + reportMoney(stats.totalAdvances)]
      ];
      
      // Avans detaylarını ekle
      if (empData && empData.expenses) {
        const avanslar = empData.expenses.filter((e: Expense) => e.type === 'Avans');
        avanslar.forEach((avans: Expense) => {
          const dateStr = new Date(avans.date).toLocaleDateString('tr-TR').replace(/İ/g, 'I').replace(/ı/g, 'i');
          const monthlyAmount = monthlyAdvanceAmount(avans,currentYear,currentMonth);
          const installmentInfo = (avans.installment_total || 1) > 1 
            ? ` (${avans.installment_current}/${avans.installment_total} taksit - Toplam: ${avans.amount.toFixed(2)} TL)` 
            : '';
          bordroBody.push([`  - Avans ${dateStr}${installmentInfo}`, '- ' + reportMoney(monthlyAmount)]);
        });
      }
      
      bordroBody.push(
        ['', ''],
        ['NET HAKEDİŞ', reportMoney(stats.netPayable)],
        ['', ''],
        ['Resmi Maaş', reportMoney(stats.officialPay)],
        ['Ek Ödeme', reportMoney((stats.netPayable - stats.officialPay))],
        ['', ''],
        ['TOPLAM ÖDENECEK', reportMoney(stats.netPayable)]
      );
      
      // Bordro Tablosu
      (doc as any).autoTable({
        startY: startY + 35,
        head: [['AÇIKLAMA', 'TUTAR']],
        body: bordroBody,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 9, cellPadding: 3, font: 'helvetica' },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 100 },
          1: { halign: 'right', cellWidth: 70 }
        },
        didParseCell: function(data: any) {
          // Avans detay satırlarını daha küçük fontla göster
          if (data.cell.text[0] && data.cell.text[0].startsWith('  - Avans')) {
            data.cell.styles.fontSize = 8;
            data.cell.styles.textColor = [220, 38, 38];
          }
          // Ana başlıkları vurgula (BRÜT HAKEDİŞ, NET HAKEDİŞ, TOPLAM ÖDENECEK)
          if (data.cell.text[0] && (
            data.cell.text[0].includes('BRÜT HAKEDİŞ') || 
            data.cell.text[0].includes('NET HAKEDİŞ') || 
            data.cell.text[0].includes('TOPLAM ÖDENECEK')
          )) {
            data.cell.styles.fillColor = [239, 246, 255];
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fontSize = 10;
          }
        }
      });

      // Puantaj Detayları
      if (empData && Object.keys(empData.logs || {}).length > 0) {
        let finalY = (doc as any).lastAutoTable.finalY + 10;
        if (finalY > 260) { doc.addPage(); finalY = 22; }
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(30, 58, 138);
        doc.text('PUANTAJ DETAYLARI', 20, finalY);
        
        const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
        const puantajData = Object.values(empData.logs).map((log: any) => {
          const date = new Date(currentYear, currentMonth, log.day);
          const dayName = dayNames[date.getDay()];
          const typeClean = log.type;
          const descClean = log.description || '';
          
          return [
            log.day,
            dayName,
            typeClean,
            log.startTime || '-',
            log.endTime || '-',
            log.overtimeHours || 0,
            descClean
          ];
        });

        (doc as any).autoTable({
          startY: finalY + 5,
          head: [['Gün', 'Gün adı', 'Durum', 'Giriş', 'Çıkış', 'Mesai', 'Açıklama']],
          body: puantajData,
          theme: 'striped',
          headStyles: { fillColor: [30, 58, 138], fontSize: 8, fontStyle: 'bold' },
          styles: { fontSize: 7, cellPadding: 2, font: 'helvetica' },
          columnStyles: {
            0: { cellWidth: 15, halign: 'center' },
            1: { cellWidth: 25 },
            2: { cellWidth: 30 },
            3: { cellWidth: 20, halign: 'center' },
            4: { cellWidth: 20, halign: 'center' },
            5: { cellWidth: 20, halign: 'center' },
            6: { cellWidth: 40 }
          }
        });
        
        finalY = (doc as any).lastAutoTable.finalY + 10;
      } else {
        let finalY = (doc as any).lastAutoTable.finalY + 10;
        if (finalY > 260) { doc.addPage(); finalY = 22; }
      }

      // Gelmediği Günler (Absent Days)
      if (empData) {
        const absentDays = [];
        for (let i = 1; i <= daysInMonth; i++) {
          if (!empData.logs?.[i]) {
            const date = new Date(currentYear, currentMonth, i);
            const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
            absentDays.push([i, dayNames[date.getDay()], `${i}/${currentMonth + 1}/${currentYear}`]);
          }
        }
        
        if (absentDays.length > 0) {
          let currentY = (doc as any).lastAutoTable.finalY + 10;
          if (currentY > 260) { doc.addPage(); currentY = 22; }
          
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(220, 38, 38);
          doc.text('KAYDI OLMAYAN GÜNLER', 20, currentY);
          
          (doc as any).autoTable({
            startY: currentY + 5,
            head: [['Gün', 'Gün adı', 'Tarih']],
            body: absentDays,
            theme: 'grid',
            headStyles: { fillColor: [220, 38, 38], fontSize: 8, fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 2, font: 'helvetica' },
            columnStyles: {
              0: { cellWidth: 30, halign: 'center' },
              1: { cellWidth: 50 },
              2: { cellWidth: 60, halign: 'center' }
            }
          });
        }
      }

      // Avans/Gider/Prim Detayları
      if (empData && empData.expenses?.length > 0) {
        let currentY = (doc as any).lastAutoTable.finalY + 10;
          if (currentY > 260) { doc.addPage(); currentY = 22; }
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(30, 58, 138);
        doc.text('AVANS / GİDER / PRİM DETAYLARI', 20, currentY);
        
        const expenseData = empData.expenses.map((exp: Expense) => {
          const typeClean = exp.type;
          const installmentInfo = exp.type === 'Avans' && (exp.installment_total || 1) > 1 
            ? ` (${exp.installment_current}/${exp.installment_total} taksit)` 
            : '';
          const descClean = exp.description || '';
          const dateFormatted = new Date(exp.date).toLocaleDateString('tr-TR');
          
          return [
            dateFormatted,
            typeClean + installmentInfo,
            reportMoney(exp.amount),
            descClean
          ];
        });

        (doc as any).autoTable({
          startY: currentY + 5,
          head: [['Tarih', 'Tip', 'Tutar', 'Açıklama']],
          body: expenseData,
          theme: 'striped',
          headStyles: { fillColor: [30, 58, 138], fontSize: 8, fontStyle: 'bold' },
          styles: { fontSize: 8, cellPadding: 2, font: 'helvetica' },
          columnStyles: {
            0: { cellWidth: 30, halign: 'center' },
            1: { cellWidth: 30, halign: 'center' },
            2: { cellWidth: 30, halign: 'right' },
            3: { cellWidth: 80 }
          },
          didParseCell: function(data: any) {
            if (data.column.index === 1) {
              const cellText = data.cell.text[0];
              if (cellText === 'Avans') {
                data.cell.styles.textColor = [220, 38, 38];
                data.cell.styles.fontStyle = 'bold';
              } else if (cellText === 'Gider') {
                data.cell.styles.textColor = [249, 115, 22];
                data.cell.styles.fontStyle = 'bold';
              } else if (cellText === 'Prim') {
                data.cell.styles.textColor = [34, 197, 94];
                data.cell.styles.fontStyle = 'bold';
              }
            }
          }
        });
      }

      const cleanName = employee.name.replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
      doc.save(reportFileName('Bordro', `${employee.name}_${currentYear}_${currentMonth + 1}`));
      await ActivityLogger.bordroExportPDF(employee.name);
      alert('✅ PDF başarıyla indirildi!');
    } catch (error) {
      console.error('PDF export hatası:', error);
      alert('❌ PDF oluşturulurken hata oluştu!');
    }
  };

  // PDF Export - Toplu Bordro (Tüm Personel)
  const exportAllPDF = async () => {
    try {
      const doc = await createReportPDF({ title: 'Personel Bordro Raporu' });
      
      // Logo
      let startY = 20;
      if (logo) {
        try {
          const format = logo.startsWith('data:image/png') ? 'PNG' : 
                        logo.startsWith('data:image/jpeg') || logo.startsWith('data:image/jpg') ? 'JPEG' :
                        logo.startsWith('data:image/svg') ? 'PNG' : 'PNG';
          
          // Logo boyutunu optimize et - aspect ratio korunsun
          const logoWidth = 40;
          const logoHeight = 40;
          fitReportImage(doc, logo, 15, 10, 40, 30);
          startY = 55;
          
        } catch (e) {
          console.error('Logo eklenemedi:', e);
        }
      }
      
      // Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(30, 58, 138);
      doc.text('VOLTGUARD', 105, startY, { align: 'center' });
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text('TOPLU BORDRO İCMALİ', 105, startY + 8, { align: 'center' });
      
      const monthNames = MONTHS;
      doc.text(`${monthNames[currentMonth]} ${currentYear}`, 105, startY + 15, { align: 'center' });
      
      // Çizgi
      doc.setDrawColor(30, 58, 138);
      doc.setLineWidth(0.5);
      doc.line(20, startY + 18, 190, startY + 18);
      
      // Özet Tablo Verisi
      const tableData = employees.map(emp => {
        const empData = appData[emp.id]?.[monthKey];
        const stats = calculateEmployeeStats(emp, empData, daysInMonth, currentMonth, currentYear);
        const cleanName = emp.name;
        
        return [
          cleanName,
          stats.totalWorkDays,
          stats.totalOvertimeHours,
          reportMoney(stats.grossTotal),
          reportMoney(stats.totalAdvances),
          reportMoney(stats.netPayable),
          reportMoney(stats.officialPay),
          reportMoney((stats.netPayable - stats.officialPay))
        ];
      });

      // Toplamlar: ekranda ve tabloda görünen kuruş tutarlarını topla.
      const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
      const totals = employees.reduce((acc, emp) => {
        const empData = appData[emp.id]?.[monthKey];
        const stats = calculateEmployeeStats(emp, empData, daysInMonth, currentMonth, currentYear);
        return {
          workDays: acc.workDays + stats.totalWorkDays,
          overtime: acc.overtime + stats.totalOvertimeHours,
          gross: acc.gross + cents(stats.grossTotal),
          advances: acc.advances + cents(stats.totalAdvances),
          net: acc.net + cents(stats.netPayable),
          official: acc.official + cents(stats.officialPay),
          hand: acc.hand + cents((stats.netPayable - stats.officialPay))
        };
      }, { workDays: 0, overtime: 0, gross: 0, advances: 0, net: 0, official: 0, hand: 0 });

      tableData.push([
        'TOPLAM',
        totals.workDays.toString(),
        totals.overtime > 0 ? `${totals.overtime} s` : '',
        reportMoney(totals.gross),
        reportMoney(totals.advances),
        reportMoney(totals.net),
        reportMoney(totals.official),
        reportMoney(totals.hand)
      ]);

      (doc as any).autoTable({
        startY: startY + 25,
        head: [['Personel', 'Gün', 'Mesai', 'Brüt', 'Avans', 'Net', 'Resmi', 'Ek Ödeme']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 8, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2, font: 'helvetica' },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 15, halign: 'center' },
          2: { cellWidth: 15, halign: 'center' },
          3: { cellWidth: 25, halign: 'right' },
          4: { cellWidth: 25, halign: 'right' },
          5: { cellWidth: 25, halign: 'right' },
          6: { cellWidth: 25, halign: 'right' },
          7: { cellWidth: 25, halign: 'right', fillColor: [254, 242, 242] }
        },
        didParseCell: function(data: any) {
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fillColor = [30, 58, 138];
            data.cell.styles.textColor = 255;
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });

      doc.save(reportFileName('Bordro_Toplu', `${currentYear}_${currentMonth + 1}`));
      await ActivityLogger.bordroExportAllPDF(currentMonth + 1, currentYear);
      alert('✅ Toplu bordro PDF\'i başarıyla indirildi!');
    } catch (error) {
      console.error('PDF export hatası:', error);
      alert('❌ PDF oluşturulurken hata oluştu!');
    }
  };

  // Excel Import - Bordro Verilerini İçe Aktar
  const importFromExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canManage) return;
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        alert('Excel dosyası boş!');
        return;
      }

      let importedCount = 0;
      let updatedCount = 0;
      const employeeIndex=new Map<string,Employee[]>();
      for(const employee of employees){const key=employee.name.trim().toLocaleLowerCase('tr-TR');employeeIndex.set(key,[...(employeeIndex.get(key)||[]),employee]);}
      const prepared=jsonData.map((row:any,index)=>{
        // Accept the application's own title-case export as well as older uppercase templates.
        const cells:any=Object.fromEntries(Object.entries(row).map(([key,value])=>[key.trim().toLocaleUpperCase('tr-TR').replace(/\s+/g,' '),value]));
        const name=String(cells['İSİM']??cells['ISIM']??cells['AD SOYAD']??cells['PERSONEL']??'').trim();
        if(!name)return null;
        const matches=employeeIndex.get(name.toLocaleLowerCase('tr-TR'))||[];
        if(matches.length>1)throw new Error(`${index+2}. satır: Aynı isimde birden fazla personel var. Şirket kaydında isimleri ayırt edip yeniden aktarın.`);
        const agreed=parseDecimal(cells['ANLAŞILAN MAAŞ']??cells['NET MAAŞ'],null),official=parseDecimal(cells['RESMİ MAAŞ']??cells['SGK MAAŞ'],null);
        if((!matches.length&&(agreed===null||official===null)) || agreed!==null&&agreed<0 || official!==null&&official<0)throw new Error(`${index+2}. satır: Yeni personel için gerçek net ve muhasebe maaş tutarları gereklidir; tutarlar negatif olamaz.`);
        return {name,tc:String(cells['TC KİMLİK NO']??cells['TC KIMLIK NO']??cells['TC']??cells['TC NO']??'').trim(),agreed,official};
      }).filter(Boolean);
      if(!prepared.length)throw new Error('İSİM / AD SOYAD / PERSONEL sütununda aktarılacak personel bulunamadı.');
      if(!confirm(`${prepared.length} personel satırı gerçek maaş bilgileriyle aktarılacak.\n\nGÜN / ÇALIŞILAN GÜN toplamından tarih, çalışma saati veya devamsızlık kaydı oluşturulmaz. Puantajı gerçek gün kayıtlarıyla doldurun. Devam edilsin mi?`))return;

      // Her satırı işle
      for (const row of prepared) {
        // Personel ismi çıkar (TC Kimlik No veya diğer kolonlardan)
        const employeeName = row!.name;
        const tcNo = row!.tc;
        const agreedSalary = row!.agreed;
        const officialSalary = row!.official;
        
        if (!employeeName) continue;

        // Personeli kontrol et veya ekle
        const nameKey=employeeName.toLocaleLowerCase('tr-TR');
        let employee = employeeIndex.get(nameKey)?.[0];
        
        if (!employee) {
          // Yeni personel ekle
          const { data: newEmp, error } = await supabase
            .from('bordro_employees')
            .insert([{
              name: employeeName,
              tc_no: tcNo || null,
              agreed_salary: agreedSalary,
              official_salary: officialSalary,
              active: true
            }])
            .select()
            .single();

          if (error) throw error;
          employee = {
            id: newEmp.id,
            name: newEmp.name,
            tc_no: newEmp.tc_no,
            agreedSalary: newEmp.agreed_salary,
            officialSalary: newEmp.official_salary
          };
          importedCount++;
          employeeIndex.set(nameKey,[employee]);
        } else if(agreedSalary!==null || officialSalary!==null){
          const update:any={};if(agreedSalary!==null)update.agreed_salary=agreedSalary;if(officialSalary!==null)update.official_salary=officialSalary;
          const {error}=await supabase.from('bordro_employees').update(update).eq('id',employee.id).select('id').single();
          if(error)throw error;updatedCount++;
        }
      }

      await loadEmployees();
      if (selectedEmployeeId) {
        await loadMonthlyData(selectedEmployeeId);
      }

      alert(`✅ Excel personel aktarımı tamamlandı.\n${importedCount} yeni personel eklendi; ${updatedCount} personelin belirtilen maaş tutarları güncellendi.\nPuantaj kayıtları değiştirilmedi.`);
      
      // Input'u temizle
      event.target.value = '';
    } catch (error) {
      console.error('Excel import hatası:', error);
      alert('Excel aktarımı tamamlanamadı: '+(error as any)?.message+'. Personel listesini yeniden yükleyip sunucudaki kayıtları kontrol edin; puantaj kayıtları değiştirilmedi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-payroll-access={canManage ? "manage" : "own"} className="min-h-screen bg-gray-50 text-gray-800 font-sans relative flex flex-col">
      {!canManage && <p className="portal-readonly-note">Yalnız size bağlı bordro kayıtlarını görüntülüyorsunuz. Kayıt ve ödeme değişikliklerini bordro yöneticiniz yapar.</p>}
      
      {/* YÜKLEME GÖSTERGESİ */}
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-lg shadow-xl flex items-center space-x-3">
            <RefreshCw className="w-5 h-5 animate-spin text-blue-600"/>
            <span className="font-medium">Yükleniyor...</span>
          </div>
        </div>
      )}

      {/* 🛡️ YEDEKLEME DURUMU GÖSTERGESİ */}
      {lastBackupTime && (
        <div className="fixed bottom-4 left-4 z-40">
          <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 shadow-sm text-xs">
            <div className="flex items-center space-x-2">
              <CheckCircle className="w-4 h-4 text-green-600"/>
              <span className="text-green-700">
                Son Yedek: {lastBackupTime.toLocaleTimeString('tr-TR')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 🛡️ KURTARMA BUTONU */}
      <button
        onClick={restoreFromBackup}
        className="fixed bottom-16 left-4 z-40 bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-full shadow-lg transition-all"
        title="Yedeğen Geri Yükle"
       hidden={!canManage} >
        <Upload className="w-5 h-5"/>
      </button>

      {/* KAYIT DURUMU GÖSTERGESİ */}
      {saveStatus !== 'idle' && (
        <div className="fixed top-20 right-4 z-50 animate-fade-in">
          <div className={`px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2 ${
            saveStatus === 'saved' ? 'bg-green-500 text-white' : 
            saveStatus === 'error' ? 'bg-red-500 text-white' : 
            'bg-blue-500 text-white'
          }`}>
            {saveStatus === 'saved' && <><Save className="w-4 h-4"/> <span>Kaydedildi</span></>}
            {saveStatus === 'error' && <><AlertCircle className="w-4 h-4"/> <span>Hata!</span></>}
            {saveStatus === 'saving' && <><RefreshCw className="w-4 h-4 animate-spin"/> <span>Kaydediliyor...</span></>}
          </div>
        </div>
      )}
      
      {/* MODAL: Personel Ekle/Düzenle */}
      {canManage && showEmployeeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 w-96">
                  <div className="flex justify-between items-center mb-4 border-b pb-2">
                      <h3 className="font-bold text-lg text-blue-900">
                          {editingEmployeeId ? 'Personel Bilgilerini Düzenle' : 'Yeni Personel Ekle'}
                      </h3>
                      <button onClick={() => setShowEmployeeModal(false)} className="text-gray-400 hover:text-red-500" hidden={!canManage} ><X className="w-5 h-5"/></button>
                  </div>
                  <div className="space-y-3">
                      <label className="block text-sm font-medium">Çalışan hesabı
                        <select className="w-full p-2 border rounded mt-1" value={employeeForm.userId} onChange={event => setEmployeeForm({...employeeForm, userId:event.target.value})}>
                          <option value="">Hesap eşleştirilmedi</option>
                          {employeeForm.userId && !availableStaff.some(user => user.id === employeeForm.userId) && <option value={employeeForm.userId}>Mevcut kapalı çalışan hesabı</option>}
                          {availableStaff.map(user => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}
                        </select>
                      </label>
                      <p className="text-xs text-gray-500">Seçilen çalışan kendi bordrosunu görebilir. Hesap eşleştirmesi yapılmazsa bu kaydı yalnız bordro yöneticileri görür.</p>
                      <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">Ad Soyad</label>
                          <input 
                            type="text" 
                            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
                            placeholder="Örn: Ahmet Yılmaz" 
                            value={employeeForm.name} 
                            onChange={(e) => setEmployeeForm({...employeeForm, name: e.target.value})} 
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1">TC Kimlik No</label>
                          <input 
                            type="text" 
                            maxLength={11}
                            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
                            placeholder="Örn: 12345678901" 
                            value={employeeForm.tcNo} 
                            onChange={(e) => {
                              const value = e.target.value.replace(/\D/g, '');
                              setEmployeeForm({...employeeForm, tcNo: value});
                            }} 
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-green-700 mb-1">
                            <span className="text-lg">💵</span> Anlaşılan Net Maaş (ÖDENECEK)
                          </label>
                          <input 
                            type="number" 
                            className="w-full p-2 border-2 border-green-500 rounded focus:ring-2 focus:ring-green-500 font-bold" 
                            placeholder="Örn: 90000" 
                            value={employeeForm.agreedSalary} 
                            onChange={(e) => setEmployeeForm({...employeeForm, agreedSalary: e.target.value})} 
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-gray-400 mb-1">
                            <span className="text-sm">📝</span> Muhasebe bordrosundaki maaş tutarı
                          </label>
                          <input 
                            type="number" 
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-gray-400 bg-gray-50 text-gray-600" 
                            placeholder="Örn: 17002" 
                            value={employeeForm.officialSalary} 
                            onChange={(e) => setEmployeeForm({...employeeForm, officialSalary: e.target.value})} 
                          />
                      </div>
                      <button onClick={saveEmployee} className="w-full bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700 transition mt-2" hidden={!canManage} >
                          {editingEmployeeId ? 'GÜNCELLE' : 'KAYDET'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL: Avans/Gider/Prim Ekle */}
      {canManage && showAdvanceModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 w-96">
                  <div className="flex justify-between items-center mb-4 border-b pb-2">
                      <h3 className="font-bold text-lg" style={{color: advanceForm.type === 'Avans' ? '#dc2626' : advanceForm.type === 'Gider' ? '#ea580c' : '#16a34a'}}>
                          🔹 {advanceForm.type} Ekle
                      </h3>
                      <button onClick={() => {
                        setShowAdvanceModal(false);
                        setAdvanceForm({ 
                          amount: '', 
                          date: localISODate(), 
                          type: 'Avans',
                          installmentTotal: '1',
                          installmentCurrent: '1'
                        });
                      }} className="text-gray-400 hover:text-red-500" hidden={!canManage} ><X className="w-5 h-5"/></button>
                  </div>
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-gray-600 mb-2">
                            📅 Tarih <span className="text-red-600">*</span>
                          </label>
                          <input 
                            type="date" 
                            className="w-full p-3 border-2 border-blue-400 rounded focus:ring-2 focus:ring-blue-500 font-semibold" 
                            value={advanceForm.date} 
                            onChange={(e) => setAdvanceForm({...advanceForm, date: e.target.value})} 
                          />
                          <div className="text-xs text-gray-500 mt-1">
                            Seçilen: {new Date(advanceForm.date).toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                          </div>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-gray-600 mb-2">
                            💰 Tutar (TL) <span className="text-red-600">*</span>
                          </label>
                          <input 
                            type="number" 
                            step="0.01"
                            min="0"
                            className="w-full p-3 border-2 border-green-500 rounded focus:ring-2 focus:ring-green-500 font-bold text-lg" 
                            placeholder="0.00" 
                            value={advanceForm.amount} 
                            onChange={(e) => setAdvanceForm({...advanceForm, amount: e.target.value})} 
                          />
                      </div>
                      
                      {advanceForm.type === 'Avans' && (
                        <div className="bg-yellow-50 p-3 rounded border border-yellow-300">
                          <label className="block text-xs font-bold text-gray-700 mb-2">
                            📊 Taksit Bilgileri
                          </label>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Kaç Ay Taksit?</label>
                            <input 
                              type="number" 
                              min="1"
                              max="24"
                              className="w-full p-2 border-2 border-yellow-400 rounded focus:ring-2 focus:ring-yellow-500 font-bold" 
                              value={advanceForm.installmentTotal} 
                              onChange={(e) => setAdvanceForm({
                                ...advanceForm, 
                                installmentTotal: e.target.value
                              })} 
                            />
                          </div>
                          <div className="text-xs text-gray-600 mt-2 bg-white p-2 rounded border border-yellow-200">
                            💡 <strong>Nasıl Çalışır:</strong><br/>
                            • <strong>Toplam avans tutarını</strong> girin (örn: 10,000 TL)<br/>
                            • Taksit sayısını seçin (örn: 5 ay)<br/>
                            • Seçili ay taksiti <strong>{formatCurrency(monthlyAdvanceAmount({amount:parseDecimal(advanceForm.amount),date:advanceForm.date,installment_total:Number(advanceForm.installmentTotal)||1},currentYear,currentMonth))}</strong>; kuruş farkları ilk aylara dağıtılır<br/>
                            • Bu aydan başlayarak <strong>{advanceForm.installmentTotal} ay</strong> boyunca devam edecek<br/>
                            • ✅ Geçmiş avanslar otomatik takip edilir!
                          </div>
                        </div>
                      )}
                      
                      <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <p className="text-sm text-gray-600">
                          <strong>Personel:</strong> {selectedEmployee.name}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          <strong>Ay/Yıl:</strong> {MONTHS[currentMonth]} {currentYear}
                        </p>
                      </div>
                      <div className="flex space-x-2">
                        <button 
                          onClick={handleAdvanceSubmit}
                          className="flex-1 bg-green-600 text-white py-3 rounded font-bold hover:bg-green-700 transition shadow"
                         hidden={!canManage} >
                          ✅ KAYDET
                        </button>
                        <button 
                          onClick={() => {
                            setShowAdvanceModal(false);
                            setAdvanceForm({ 
                              amount: '', 
                              date: localISODate(), 
                              type: 'Avans',
                              installmentTotal: '1',
                              installmentCurrent: '1'
                            });
                          }}
                          className="flex-1 bg-gray-400 text-white py-3 rounded font-bold hover:bg-gray-500 transition shadow"
                         hidden={!canManage} >
                          ❌ İPTAL
                        </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* HEADER */}
      <header className="bg-blue-900 text-white p-4 shadow-lg sticky top-0 z-40">
        <div className="container mx-auto flex flex-col md:flex-row justify-between items-center space-y-3 md:space-y-0">
          <div className="flex items-center space-x-3">
            <Calculator className="w-8 h-8 text-yellow-400" />
            <div>
              <h1 className="text-xl font-bold tracking-wide">VoltGuard</h1>
              <p className="text-xs text-blue-200">Personel Hakediş & Puantaj Otomasyonu</p>
            </div>
          </div>
          
          {/* TAB MENÜSÜ */}
          <div className="flex bg-blue-800 p-1 rounded-lg">
             <button 
                onClick={() => setActiveTab('summary')}
                className={`flex items-center px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'summary' ? 'bg-white text-blue-900 shadow' : 'text-blue-200 hover:text-white'}`}
             >
                <LayoutGrid className="w-4 h-4 mr-2"/>
                GENEL BAKIŞ
             </button>
             <button 
                onClick={() => setActiveTab('detail')}
                className={`flex items-center px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'detail' ? 'bg-white text-blue-900 shadow' : 'text-blue-200 hover:text-white'}`}
             >
                <List className="w-4 h-4 mr-2"/>
                PERSONEL DETAY
             </button>
          </div>

          <div className="flex items-center space-x-2">
            {/* Excel Import */}
            <div className="relative">
              <input 
                type="file" 
                accept=".xlsx,.xls"
                id="excel-import"
                className="hidden"
                onChange={importFromExcel}
              />
              <label 
                htmlFor="excel-import"
                hidden={!canManage}
                className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded text-sm font-semibold flex items-center space-x-1 cursor-pointer"
                title="Excel'den Bordro İçe Aktar"
              >
                <UploadCloud className="w-4 h-4"/>
                <span>Excel İçe Aktar</span>
              </label>
            </div>

            {/* Geçmiş Bordrolar */}
            <button
              onClick={() => setShowHistoryModal(true)}
              className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded text-sm font-semibold flex items-center space-x-1"
              title="Geçmiş Bordroları Görüntüle"
            >
              <FileText className="w-4 h-4"/>
              <span>Geçmiş Bordrolar</span>
            </button>

            {/* Aylık Bordroyu Kaydet */}
            <button
              onClick={saveMonthlyPayroll}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded text-sm font-semibold flex items-center space-x-1 disabled:opacity-50"
              title="Bu ayın bordrosunu kaydet"
             hidden={!canManage} >
              <Save className="w-4 h-4"/>
              <span>Ayı Kapat & Kaydet</span>
            </button>
            
            <div className="relative">
              <input 
                type="file" 
                accept="image/png,image/jpeg,image/webp"
                id="logo-upload"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { alert('Lütfen PNG, JPEG veya WebP biçiminde logo seçin.'); e.target.value=''; return; }
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const logoData = event.target?.result as string;
                      setLogo(logoData);
                      // localStorage'a kaydet
                      localStorage.setItem('bordro_logo', logoData);
                      alert('✅ Logo yüklendi! PDF\'lerde görünecek.');
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
              <label 
                htmlFor="logo-upload"
                className="bg-blue-800 hover:bg-blue-700 p-2 rounded cursor-pointer inline-flex items-center"
                title="Logo Yükle (PDF için)"
              >
                <Upload className="w-4 h-4"/>
              </label>
              {logo && (
                <button
                  onClick={() => {
                    if (confirm('Logo\'yu silmek istediğinize emin misiniz?')) {
                      setLogo(null);
                      localStorage.removeItem('bordro_logo');
                      alert('✅ Logo silindi.');
                    }
                  }}
                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                  title="Logo Sil"
                >
                  <X className="w-3 h-3"/>
                </button>
              )}
            </div>
            
            <button 
              onClick={async () => {
                if (pendingSaves.size && !confirm('Güncel dönemi yüklemek kaydedilmemiş puantaj değişikliklerini kaldırabilir. Bilgilerinizi not edip yeniden yüklemek istiyor musunuz?')) return;
                await Promise.all(Object.values(dailyQueues.current));
                const period = ':' + currentYear + ':' + currentMonth + ':';
                await loadEmployees();
                const loaded = []; for (const employee of employees) loaded.push(await loadMonthlyData(employee.id, true));
                if (loaded.some(success => !success)) { alert('Güncel dönem tam yüklenemedi. Kaydedilmemiş işaretleri korunuyor; bağlantıyı kontrol edip tekrar deneyin.'); return; }
                for (const key of Object.keys(dailyQueues.current)) if (key.includes(period)) delete dailyQueues.current[key];
                for (const key of [...dailyFailures.current]) if (key.includes(period)) dailyFailures.current.delete(key);
                for (const key of [...dailyConflicts.current]) if (key.includes(period)) dailyConflicts.current.delete(key);
                setPendingSaves(previous => { const next = new Set([...previous].filter(key => !key.includes(period))); setHasUnsavedChanges(next.size > 0); return next; });
              }}
              className="bg-blue-800 hover:bg-blue-700 p-2 rounded"
              title="Yenile"
            >
              <RefreshCw className="w-4 h-4"/>
            </button>
            
            <div className="flex items-center bg-blue-800 rounded px-3 py-1">
              <button onClick={() => setCurrentDate(new Date(currentYear, currentMonth - 1, 1))} className="p-1 hover:text-yellow-400"><ChevronLeft/></button>
              <span className="mx-2 font-mono font-bold w-32 text-center">
                {new Date(currentYear, currentMonth).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }).toUpperCase()}
              </span>
              <button onClick={() => setCurrentDate(new Date(currentYear, currentMonth + 1, 1))} className="p-1 hover:text-yellow-400"><ChevronRight/></button>
            </div>
          </div>
        </div>
      </header>

      {/* Kaydedilmemiş Değişiklik Uyarısı */}
      {pendingSaves.size > 0 && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mx-4 mt-4 mb-2 rounded">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <AlertCircle className="w-5 h-5 text-yellow-600 mr-3" />
              <div>
                <p className="text-yellow-800 font-semibold">
                  {pendingSaves.size} değişiklik kaydedilmeyi bekliyor...
                </p>
                <p className="text-yellow-700 text-sm">
                  Değişiklikler 2 saniye sonra otomatik olarak kaydedilecek. Lütfen bekleyin.
                </p>
              </div>
            </div>
            {saveStatus !== 'idle' && (
              <div className={`px-3 py-2 rounded text-sm font-semibold flex items-center space-x-2 ${
                saveStatus === 'saving' ? 'bg-yellow-100 text-yellow-700 border border-yellow-300' :
                saveStatus === 'saved' ? 'bg-green-100 text-green-700 border border-green-300' :
                'bg-red-100 text-red-700 border border-red-300'
              }`}>
                {saveStatus === 'saving' && (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Kaydediliyor...</span>
                  </>
                )}
                {saveStatus === 'saved' && (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>✅ Kaydedildi</span>
                  </>
                )}
                {saveStatus === 'error' && (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    <span>❌ Hata!</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      <main className="container mx-auto p-4 flex-1">
        
        {/* VIEW 1: ÖZET TABLO */}
        {activeTab === 'summary' && (
            <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
                <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                    <h2 className="font-bold text-gray-700 flex items-center text-lg">
                        <LayoutGrid className="w-5 h-5 mr-2 text-blue-600"/>
                        MAAŞ İCMAL TABLOSU ({currentYear}-{currentMonth + 1})
                    </h2>
                    <div className="flex space-x-2">
                        <button 
                            onClick={exportToExcel}
                            className="bg-green-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-green-700 flex items-center shadow"
                            title="Excel'e Aktar"
                        >
                            <FileSpreadsheet className="w-4 h-4 mr-2"/> EXCEL
                        </button>
                        <button 
                            onClick={exportAllPDF}
                            className="bg-red-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-red-700 flex items-center shadow"
                            title="Toplu Bordro PDF"
                        >
                            <FileDown className="w-4 h-4 mr-2"/> TOPLU PDF
                        </button>
                        <button 
                            onClick={openAddModal}
                            className="bg-green-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-green-700 flex items-center shadow"
                         hidden={!canManage} >
                            <UserPlus className="w-4 h-4 mr-2"/> YENİ PERSONEL
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-blue-50 text-blue-900 uppercase text-xs font-bold">
                            <tr>
                                <th className="p-4 border-b">PERSONEL</th>
                                <th className="p-4 border-b text-center">TC NO</th>
                                <th className="p-4 border-b text-right text-green-700">💵 ANLAŞILAN NET MAAŞ</th>
                                <th className="p-4 border-b text-center">GÜN</th>
                                <th className="p-4 border-b text-center">MESAİ (S)</th>
                                <th className="p-4 border-b text-right text-green-700">HAKEDİŞ TOP.</th>
                                <th className="p-4 border-b text-right text-red-600">AVANS</th>
                                <th className="p-4 border-b text-right font-black text-red-600 bg-red-50">💰 RESMİ MAAŞ</th>
                                <th className="p-4 border-b text-right font-black text-green-600 bg-green-50">💵 EK ÖDEME</th>
                                <th className="p-4 border-b text-right font-black text-blue-600 bg-blue-50">💰 TOPLAM</th>
                                <th className="p-4 border-b text-center">İŞLEM</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {employees.map(emp => {
                                const empData = appData[emp.id]?.[monthKey];
                                const stats = calculateEmployeeStats(emp, empData, daysInMonth, currentMonth, currentYear);
                                
                                return (
                                    <tr key={emp.id} className="hover:bg-blue-50 transition-colors group">
                                        <td className="p-4 font-bold text-gray-700">{emp.name}</td>
                                        <td className="p-4 text-center text-gray-500 text-xs font-mono">{emp.tc_no || '-'}</td>
                                        <td className="p-4 text-right font-mono text-gray-500">{formatCurrency(emp.agreedSalary)}</td>
                                        <td className="p-4 text-center">
                                            <span className="bg-gray-100 px-2 py-1 rounded text-xs font-bold">{stats.totalWorkDays}</span>
                                        </td>
                                        <td className="p-4 text-center">
                                            {stats.totalOvertimeHours > 0 ? (
                                                <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold">{stats.totalOvertimeHours} s</span>
                                            ) : '-'}
                                        </td>
                                        <td className="p-4 text-right text-green-700 font-semibold">{formatCurrency(stats.grossTotal)}</td>
                                        <td className="p-4 text-right text-red-600">{stats.totalAdvances > 0 ? formatCurrency(stats.totalAdvances) : '-'}</td>
                                        <td className="p-4 text-right font-black text-red-600 bg-red-50 border-l-4 border-red-300">{formatCurrency(stats.officialPay)}</td>
                                        <td className="p-4 text-right font-black text-green-600 bg-green-50">{formatCurrency(stats.netPayable - stats.officialPay)}</td>
                                        <td className="p-4 text-right font-black text-blue-600 bg-blue-50 border-l-4 border-blue-300 text-lg">{formatCurrency(stats.netPayable)}</td>
                                        <td className="p-4 text-center flex justify-center space-x-2">
                                            <button 
                                                onClick={() => openEditModal(emp)}
                                                className="bg-yellow-100 text-yellow-700 p-2 rounded-full hover:bg-yellow-200 transition"
                                                title="Bilgileri Düzenle"
                                             hidden={!canManage} >
                                                <Pencil className="w-4 h-4"/>
                                            </button>
                                            <button 
                                                onClick={() => deleteEmployee(emp.id, emp.name)}
                                                className="bg-red-100 text-red-700 p-2 rounded-full hover:bg-red-200 transition"
                                                title="Personeli Sil"
                                             hidden={!canManage} >
                                                <Trash2 className="w-4 h-4"/>
                                            </button>
                                            <button 
                                                onClick={() => exportSinglePDF(emp)}
                                                className="bg-purple-100 text-purple-700 p-2 rounded-full hover:bg-purple-200 transition"
                                                title="Bordro PDF İndir"
                                            >
                                                <FileDown className="w-4 h-4"/>
                                            </button>
                                            <button 
                                                onClick={() => goToDetail(emp.id)}
                                                className="bg-blue-100 text-blue-700 p-2 rounded-full hover:bg-blue-200 transition"
                                                title="Puantaj Girişi"
                                            >
                                                <ArrowRightCircle className="w-4 h-4"/>
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {employees.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center text-gray-400 italic">Henüz personel eklenmemiş. "Yeni Personel" butonuna tıklayarak başlayın.</td>
                                </tr>
                            )}
                        </tbody>
                        {employees.length > 0 && (
                            <tfoot className="bg-gradient-to-r from-blue-900 to-blue-700 text-white">
                                <tr className="font-bold text-base">
                                    <td className="p-4" colSpan={2}>TOPLAM</td>
                                    <td className="p-4 text-right">{formatCurrency(employees.reduce((sum, emp) => sum + emp.agreedSalary, 0))}</td>
                                    <td className="p-4 text-center">
                                        {employees.reduce((sum, emp) => {
                                            const stats = calculateEmployeeStats(emp, appData[emp.id]?.[monthKey], daysInMonth, currentMonth, currentYear);
                                            return sum + stats.totalWorkDays;
                                        }, 0)}
                                    </td>
                                    <td className="p-4 text-center">
                                        {employees.reduce((sum, emp) => {
                                            const stats = calculateEmployeeStats(emp, appData[emp.id]?.[monthKey], daysInMonth, currentMonth, currentYear);
                                            return sum + stats.totalOvertimeHours;
                                        }, 0)} s
                                    </td>
                                    <td className="p-4 text-right">
                                        {formatCurrency(employees.reduce((sum, emp) => {
                                            const stats = calculateEmployeeStats(emp, appData[emp.id]?.[monthKey], daysInMonth, currentMonth, currentYear);
                                            return sum + stats.grossTotal;
                                        }, 0))}
                                    </td>
                                    <td className="p-4 text-right">
                                        {formatCurrency(employees.reduce((sum, emp) => {
                                            const stats = calculateEmployeeStats(emp, appData[emp.id]?.[monthKey], daysInMonth, currentMonth, currentYear);
                                            return sum + stats.totalAdvances;
                                        }, 0))}
                                    </td>
                                    <td className="p-4 text-right text-xl bg-red-800 border-l-4 border-yellow-300">
                                        {formatCurrency(employees.reduce((sum, emp) => {
                                            const stats = calculateEmployeeStats(emp, appData[emp.id]?.[monthKey], daysInMonth, currentMonth, currentYear);
                                            return sum + stats.netPayable;
                                        }, 0))}
                                    </td>
                                    <td className="p-4 text-right text-sm opacity-75">
                                        {formatCurrency(employees.reduce((sum, emp) => {
                                            const stats = calculateEmployeeStats(emp, appData[emp.id]?.[monthKey], daysInMonth, currentMonth, currentYear);
                                            return sum + stats.officialPay;
                                        }, 0))}
                                    </td>
                                    <td className="p-4"></td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
        )}

        {/* VIEW 2: DETAY GÖRÜNÜM */}
        {activeTab === 'detail' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* SOL PANEL */}
                <div className="lg:col-span-3 space-y-6">
                    <div className="bg-white rounded-xl shadow-md p-4 border-l-4 border-blue-600">
                        <div className="flex justify-between items-center mb-3">
                            <h2 className="text-sm font-bold text-gray-500 flex items-center"><Users className="w-4 h-4 mr-2"/> PERSONEL SEÇİMİ</h2>
                        </div>
                        <div className="flex space-x-2">
                            <select 
                                value={selectedEmployeeId} 
                                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                                className="flex-1 p-2 border rounded-md mb-4 bg-gray-50 font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                {employees.length === 0 && <option value="">Personel Yok</option>}
                                {employees.map(emp => (
                                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                                ))}
                            </select>
                            {selectedEmployee.id !== '0' && (
                              <button 
                                  onClick={() => openEditModal(selectedEmployee)}
                                  className="h-[42px] px-3 bg-yellow-100 text-yellow-700 rounded border border-yellow-200 hover:bg-yellow-200"
                                  title="Düzenle"
                               hidden={!canManage} >
                                  <Pencil className="w-4 h-4"/>
                              </button>
                            )}
                        </div>
                        
                        {selectedEmployee.id !== '0' && (
                          <div className="space-y-2 text-sm border-t pt-2">
                               <div className="flex justify-between"><span className="text-gray-500">Günlük Mesai Ücret:</span><span className="font-bold">{formatCurrency(currentStats.dailyRate)}</span></div>
                               <div className="flex justify-between"><span className="text-gray-500">Saatlik Mesai (x1.5):</span><span className="text-blue-600 font-mono">{formatCurrency(currentStats.hourlyRate * 1.5)}</span></div>
                          </div>
                        )}
                    </div>

                    {selectedEmployee.id !== '0' && (
                      <>
                        <div className="bg-white rounded-xl shadow-md overflow-hidden">
                            <div className="bg-gradient-to-r from-gray-800 to-gray-700 p-3 text-white flex justify-between items-center">
                                <h3 className="font-bold text-sm">HAKEDİŞ DETAYI</h3>
                                <Banknote className="w-5 h-5 text-green-400"/>
                            </div>
                            <div className="p-4 space-y-2 text-sm">
                                <div className="flex justify-between border-b pb-1">
                                  <span>Anlaşılan Maaş:</span>
                                  <span className="font-semibold">{formatCurrency(selectedEmployee.agreedSalary)}</span>
                                </div>
                                {currentStats.totalMissingDays > 0 && <p className="bg-amber-50 text-amber-900 p-2 rounded">{currentStats.totalMissingDays} günün puantajı eksik; bu günler devamsızlık sayılıp otomatik kesinti yapılmadı. Hesabı tamamlamadan puantajı doğrulayın.</p>}
                                {currentStats.absentDeduction > 0 && (
                                  <div className="flex justify-between border-b pb-1 text-red-600">
                                    <span>Gelmedi ({currentStats.totalAbsentDays} gün):</span>
                                    <span className="font-semibold">-{formatCurrency(currentStats.absentDeduction)}</span>
                                  </div>
                                )}
                                {currentStats.overtimePay > 0 && (
                                  <div className="flex justify-between border-b pb-1 text-blue-600">
                                    <span>Mesai ({currentStats.totalOvertimeHours} saat x1.5):</span>
                                    <span className="font-semibold">+{formatCurrency(currentStats.overtimePay)}</span>
                                  </div>
                                )}
                                {currentStats.totalSundayPay > 0 && (
                                  <div className="flex justify-between border-b pb-1 text-orange-600">
                                    <span>Pazar/Tatil Farkı ({currentStats.totalSundayDays} gün):</span>
                                    <span className="font-semibold">+{formatCurrency(currentStats.totalSundayPay)}</span>
                                  </div>
                                )}
                                {currentStats.totalBonuses > 0 && (
                                    <div className="flex justify-between border-b pb-1 text-green-600"><span>Prim:</span><span className="font-semibold">+{formatCurrency(currentStats.totalBonuses)}</span></div>
                                )}
                                {currentStats.totalExpenses > 0 && (
                                    <div className="flex justify-between border-b pb-1 text-purple-600"><span>Gider:</span><span className="font-semibold">+{formatCurrency(currentStats.totalExpenses)}</span></div>
                                )}
                                <div className="flex justify-between font-bold text-green-700 pt-2 border-t-2 text-base bg-green-50 p-2 rounded">
                                  <span>BRÜT HAKEDİŞ:</span>
                                  <span>{formatCurrency(currentStats.grossTotal)}</span>
                                </div>
                                {currentStats.totalAdvances > 0 && (
                                  <>
                                    <div className="flex justify-between border-b pb-1 text-red-600">
                                      <span>Avanslar:</span>
                                      <span className="font-semibold">-{formatCurrency(currentStats.totalAdvances)}</span>
                                    </div>
                                    {currentData.expenses.filter(e => e.type === 'Avans').map(avans => {
                                      const monthlyAmount = monthlyAdvanceAmount(avans,currentYear,currentMonth);
                                      return (
                                      <div key={avans.id} className="flex justify-between text-xs text-red-500 pl-4">
                                        <span>
                                          • {new Date(avans.date).toLocaleDateString('tr-TR')}
                                          {(avans.installment_total || 1) > 1 && (
                                            <span className="ml-1 bg-yellow-100 text-yellow-700 px-1 rounded text-[10px]">
                                              {avans.installment_current}/{avans.installment_total} taksit
                                            </span>
                                          )}
                                        </span>
                                        <span>-{formatCurrency(monthlyAmount)}</span>
                                      </div>
                                      );
                                    })}
                                  </>
                                )}
                                <div className="flex justify-between font-black text-lg pt-2 bg-blue-50 p-2 rounded"><span>NET HAKEDİŞ:</span><span>{formatCurrency(currentStats.netPayable)}</span></div>
                                <div className="bg-green-50 p-2 rounded border border-green-200 mt-2 space-y-1">
                                    <div className="flex justify-between font-bold text-green-700 text-sm border-b border-green-200 pb-1">
                                        <span>Resmi Maaş:</span>
                                        <span>{formatCurrency(currentStats.officialPay)}</span>
                                    </div>
                                    <div className="flex justify-between font-bold text-green-700 text-sm">
                                        <span>Ek Ödeme:</span>
                                        <span>{formatCurrency(currentStats.netPayable - currentStats.officialPay)}</span>
                                    </div>
                                    <div className="flex justify-between font-black text-green-700 text-lg border-t-2 border-green-300 pt-1">
                                        <span>TOPLAM ÖDENECEK:</span>
                                        <span>{formatCurrency(currentStats.netPayable)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div className="bg-white p-4 rounded-xl shadow-md">
                            <h4 className="text-xs font-bold text-gray-500 mb-2">HIZLI İŞLEMLER</h4>
                            <div className="grid grid-cols-3 gap-2 mb-3">
                                <button onClick={() => addExpense('Avans')} className="bg-red-100 text-red-700 py-2 rounded text-xs font-bold hover:bg-red-200" hidden={!canManage} >AVANS</button>
                                <button onClick={() => addExpense('Gider')} className="bg-orange-100 text-orange-700 py-2 rounded text-xs font-bold hover:bg-orange-200" hidden={!canManage} >GİDER</button>
                                <button onClick={() => addExpense('Prim')} className="bg-green-100 text-green-700 py-2 rounded text-xs font-bold hover:bg-green-200" hidden={!canManage} >PRİM</button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <button 
                                  onClick={restoreFromBackup}
                                  className="bg-orange-100 text-orange-700 py-2 rounded text-xs font-bold hover:bg-orange-200 flex items-center justify-center gap-1"
                                  title="Silinen kayıtları geri yükle"
                                 hidden={!canManage} >
                                  <Shield className="w-4 h-4"/>
                                  GERİ YÜKLE
                                </button>
                                <button 
                                  onClick={showChangeHistory}
                                  className="bg-purple-100 text-purple-700 py-2 rounded text-xs font-bold hover:bg-purple-200 flex items-center justify-center gap-1"
                                  title="Değişiklik geçmişini görüntüle"
                                >
                                  <History className="w-4 h-4"/>
                                  GEÇMİŞ
                                </button>
                            </div>
                            <button 
                                onClick={() => exportSinglePDF(selectedEmployee)} 
                                className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white py-2 rounded text-xs font-bold hover:from-red-600 hover:to-red-700 flex items-center justify-center shadow-lg"
                            >
                                <FileDown className="w-4 h-4 mr-2"/>
                                BORDRO PDF İNDİR
                            </button>
                            <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                                {currentData.expenses.length > 0 ? (
                                  currentData.expenses.map(e => {
                                    // Eğer avans ise, aylık taksit tutarını hesapla
                                    const displayAmount = e.type === 'Avans' 
                                      ? monthlyAdvanceAmount(e,currentYear,currentMonth)
                                      : e.amount;
                                    
                                    return (
                                    <div key={e.id} className="flex justify-between items-start text-xs bg-gray-50 p-2 rounded border hover:bg-blue-50 transition">
                                        <div className="flex-1">
                                          <div className={`font-bold ${e.type === 'Avans' ? 'text-red-600' : e.type === 'Gider' ? 'text-orange-600' : 'text-green-600'}`}>
                                            {e.type}
                                            {e.type === 'Avans' && (e.installment_total || 1) > 1 && (
                                              <span className="ml-1 text-[10px] bg-yellow-100 text-yellow-700 px-1 rounded">
                                                {e.installment_current}/{e.installment_total}
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-gray-500 text-[10px] mt-0.5">
                                            📅 {new Date(e.date).toLocaleDateString('tr-TR')}
                                            {e.type === 'Avans' && (e.installment_total || 1) > 1 && (
                                              <span className="ml-1 text-yellow-600">
                                                (Toplam: {formatCurrency(e.amount)})
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="font-bold">{formatCurrency(displayAmount)}/ay</span>
                                            <button 
                                              onClick={() => deleteExpense(e.id)}
                                              className="p-1 hover:bg-red-100 rounded"
                                             hidden={!canManage} >
                                              <Trash2 className="w-3 h-3 text-gray-400 hover:text-red-600"/>
                                            </button>
                                        </div>
                                    </div>
                                    );
                                  })
                                ) : (
                                  <div className="text-center text-gray-400 text-xs py-2 italic">
                                    Henüz kayıt yok
                                  </div>
                                )}
                            </div>
                        </div>
                      </>
                    )}
                </div>

                {/* SAĞ PANEL */}
                <div className="lg:col-span-9 bg-white rounded-xl shadow-md overflow-hidden flex flex-col">
                    {selectedEmployee.id === '0' ? (
                      <div className="p-8 text-center">
                        <Users className="w-16 h-16 mx-auto text-gray-300 mb-4"/>
                        <p className="text-gray-400 text-lg">Lütfen bir personel seçin veya yeni personel ekleyin.</p>
                        <button onClick={openAddModal} className="mt-4 bg-blue-600 text-white px-6 py-2 rounded font-bold hover:bg-blue-700" hidden={!canManage} >
                          YENİ PERSONEL EKLE
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                            <h2 className="font-bold text-gray-700 flex items-center">
                                <FileSpreadsheet className="w-5 h-5 mr-2 text-blue-600"/>
                                GÜNLÜK PUANTAJ ({selectedEmployee.name})
                            </h2>
                            <button onClick={fillMonthDefaults} className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-xs font-bold hover:bg-blue-200" hidden={!canManage} >OTOMATİK DOLDUR</button>
                        </div>
                        <div className="overflow-x-auto flex-1 p-2">
                            <table className="w-full text-sm text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-100 text-gray-600 uppercase text-xs">
                                        <th className="p-2 border text-center w-10">GÜN</th>
                                        <th className="p-2 border w-32">DURUM</th>
                                        <th className="p-2 border w-20">GİRİŞ</th>
                                        <th className="p-2 border w-20">ÇIKIŞ</th>
                                        <th className="p-2 border w-16 text-center bg-blue-50">MESAİ</th>
                                        <th className="p-2 border">AÇIKLAMA</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                                        const { isSaturday, isSunday } = isWeekend(day, currentMonth, currentYear);
                                        const log = currentData.logs[day] || {};
                                        const isActive = !!log.type;
                                        let rowClass = "hover:bg-blue-50 transition-colors border-b";
                                        if (isSunday) rowClass += " bg-red-50"; else if (isSaturday) rowClass += " bg-orange-50";
                                        
                                        return (
                                            <tr key={day} className={rowClass}>
                                                <td className="p-1 border text-center font-bold text-gray-500 text-xs">
                                                    <div>{day}</div>
                                                    <div className="font-normal text-[9px]">{getDayName(day, currentMonth, currentYear).slice(0,3)}</div>
                                                </td>
                                                <td className="p-1 border">
                                                    <select className={`w-full p-1 border rounded text-xs ${log.type === 'Pazar' ? 'text-red-600 font-bold' : ''} ${!log.type ? 'text-gray-400' : ''}`} value={log.type || ''} onChange={(e) => handleLogChange(day, 'type', e.target.value)} disabled={!canManage} >
                                                        <option value="">Gelmedi/Boş</option>
                                                        <option value="Normal">Normal</option>
                                                        <option value="Pazar">Pazar (x2)</option>
                                                        <option value="Resmi Tatil">Tatil (x2)</option>
                                                        <option value="Gelmedi">Gelmedi</option>
                                                        <option value="İzinli">İzinli</option>
                                                        <option value="Raporlu">Raporlu</option>
                                                    </select>
                                                </td>
                                                <td className="p-1 border"><input type="time" className="w-full text-xs text-center" value={log.startTime || ''} onChange={(e) => handleLogChange(day, 'startTime', e.target.value)} disabled={!canManage || (!isActive)}/></td>
                                                <td className="p-1 border"><input type="time" className="w-full text-xs text-center" value={log.endTime || ''} onChange={(e) => handleLogChange(day, 'endTime', e.target.value)} disabled={!canManage || (!isActive)}/></td>
                                                <td className="p-1 border text-center bg-blue-50"><input type="number" className="w-full text-center font-bold text-blue-700 bg-transparent text-xs" value={log.overtimeHours || 0} onChange={(e) => handleLogChange(day, 'overtimeHours', parseFloat(e.target.value))} disabled={!canManage || (!isActive)} min="0" step="0.5"/></td>
                                                <td className="p-1 border"><input type="text" className="w-full text-xs p-1" placeholder="..." value={log.description || ''} onChange={(e) => handleLogChange(day, 'description', e.target.value)} disabled={!canManage} /></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                      </>
                    )}
                </div>
            </div>
        )}
      </main>

      {/* GEÇMİŞ BORDROLAR MODALI */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
            <div className="bg-purple-600 text-white p-4 flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <FileText className="w-6 h-6"/>
                <h2 className="text-xl font-bold">Geçmiş Bordrolar</h2>
              </div>
              <button onClick={() => setShowHistoryModal(false)} className="hover:bg-purple-700 p-2 rounded">
                <X className="w-5 h-5"/>
              </button>
            </div>

            <div className="p-6">
              {/* Tarih Seçici */}
              <div className="flex items-center space-x-4 mb-6 bg-gray-100 p-4 rounded-lg">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Yıl</label>
                  <select 
                    value={historyYear} 
                    onChange={(e) => setHistoryYear(parseInt(e.target.value))}
                    className="p-2 border rounded"
                  >
                    {Array.from({length: 10}, (_, i) => new Date().getFullYear() - i).map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Ay</label>
                  <select 
                    value={historyMonth} 
                    onChange={(e) => setHistoryMonth(parseInt(e.target.value))}
                    className="p-2 border rounded"
                  >
                    {MONTHS.map((month, idx) => (
                      <option key={idx} value={idx}>{month}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={loadHistoricalPayroll}
                  disabled={loading}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold mt-6 disabled:opacity-50"
                >
                  {loading ? 'Yükleniyor...' : 'Bordroyu Göster'}
                </button>
              </div>

              {/* Geçmiş Bordro Tablosu */}
              {historicalData.length > 0 ? (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-purple-600 text-white sticky top-0">
                      <tr>
                        <th className="p-2 border text-left">Personel</th>
                        <th className="p-2 border text-right">Anlaşılan Maaş</th>
                        <th className="p-2 border text-center">Çalışılan Gün</th>
                        <th className="p-2 border text-center">Pazar Günü</th>
                        <th className="p-2 border text-center">Mesai Saat</th>
                        <th className="p-2 border text-right">Avans</th>
                        <th className="p-2 border text-right">Gider</th>
                        <th className="p-2 border text-right">Prim</th>
                        <th className="p-2 border text-right">Net Hakediş</th>
                        <th className="p-2 border text-right bg-red-600">Resmi Maaş</th>
                        <th className="p-2 border text-right bg-green-600">Ek Ödeme</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalData.map((record, idx) => (
                        <tr key={record.id} className={idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                          <td className="p-2 border font-semibold">{record.employee_name}</td>
                          <td className="p-2 border text-right">{parseFloat(record.agreed_salary).toLocaleString('tr-TR')} ₺</td>
                          <td className="p-2 border text-center font-semibold">{record.days_worked}</td>
                          <td className="p-2 border text-center">{record.sunday_days}</td>
                          <td className="p-2 border text-center">{parseFloat(record.overtime_hours).toFixed(1)}</td>
                          <td className="p-2 border text-right text-red-600">{parseFloat(record.advances).toLocaleString('tr-TR')} ₺</td>
                          <td className="p-2 border text-right text-orange-600">{parseFloat(record.expenses).toLocaleString('tr-TR')} ₺</td>
                          <td className="p-2 border text-right text-green-600">{parseFloat(record.bonuses).toLocaleString('tr-TR')} ₺</td>
                          <td className="p-2 border text-right font-bold text-blue-700">{parseFloat(record.net_payable).toLocaleString('tr-TR')} ₺</td>
                          <td className="p-2 border text-right font-bold text-red-700 bg-red-50">{parseFloat(record.official_salary).toLocaleString('tr-TR')} ₺</td>
                          <td className="p-2 border text-right font-bold text-green-700 bg-green-50">{parseFloat(record.hand_pay).toLocaleString('tr-TR')} ₺</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-purple-100 font-bold">
                      <tr>
                        <td colSpan={2} className="p-2 border text-right">TOPLAM:</td>
                        <td className="p-2 border text-center">{historicalData.reduce((sum, r) => sum + r.days_worked, 0)}</td>
                        <td className="p-2 border text-center">{historicalData.reduce((sum, r) => sum + r.sunday_days, 0)}</td>
                        <td className="p-2 border text-center">{historicalData.reduce((sum, r) => sum + parseFloat(r.overtime_hours), 0).toFixed(1)}</td>
                        <td className="p-2 border text-right text-red-600">{historicalData.reduce((sum, r) => sum + parseFloat(r.advances), 0).toLocaleString('tr-TR')} ₺</td>
                        <td className="p-2 border text-right text-orange-600">{historicalData.reduce((sum, r) => sum + parseFloat(r.expenses), 0).toLocaleString('tr-TR')} ₺</td>
                        <td className="p-2 border text-right text-green-600">{historicalData.reduce((sum, r) => sum + parseFloat(r.bonuses), 0).toLocaleString('tr-TR')} ₺</td>
                        <td className="p-2 border text-right font-bold text-blue-700">{historicalData.reduce((sum, r) => sum + parseFloat(r.net_payable), 0).toLocaleString('tr-TR')} ₺</td>
                        <td className="p-2 border text-right font-bold text-red-700 bg-red-50">{historicalData.reduce((sum, r) => sum + parseFloat(r.official_salary), 0).toLocaleString('tr-TR')} ₺</td>
                        <td className="p-2 border text-right font-bold text-green-700 bg-green-50">{historicalData.reduce((sum, r) => sum + parseFloat(r.hand_pay), 0).toLocaleString('tr-TR')} ₺</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300"/>
                  <p className="text-lg">Seçilen tarihte kayıtlı bordro bulunamadı.</p>
                  <p className="text-sm mt-2">Bordro kaydetmek için "Ayı Kapat & Kaydet" butonunu kullanın.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

