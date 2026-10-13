import { privateStorage as localStorage } from './privateStorage';
import { supabase } from './supabaseClient';

/**
 * Aktivite log kaydı oluşturur
 * @param {string} actionType - İşlem tipi: 'create', 'update', 'delete', 'view', 'login', 'logout', 'export'
 * @param {string} actionDescription - İşlem açıklaması
 * @param {string} module - Modül adı: 'bordro', 'teklif', 'fatura', 'login', 'admin'
 * @param {string} relatedId - ılgili kayıt ID (opsiyonel)
 */
export const logActivity = async (actionType, actionDescription, module = 'system', relatedId = null) => {
  try {
    // Kullanıcı bilgilerini localStorage'dan al (custom auth sistemi)
    const stored = localStorage.getItem('currentUser');
    const user = stored ? JSON.parse(stored) : null;
    
    if (!user) {
      // Sessizce devam et - kullanıcı giriş yapmamış olabilir
      return;
    }

    // Log verisini hazırla
    const logData = {
      user_id: user.id,
      user_email: user.email,
      action_type: actionType,
      action_description: actionDescription,
      module: module,
      related_id: relatedId,
      ip_address: null, // Client-side IP alınamaz, backend gerekir
      user_agent: navigator.userAgent
    };

    // Supabase'e kaydet
    const { error } = await supabase
      .from('activity_logs')
      .insert([logData]);

    if (error) {
      // Tablo yoksa veya RLS hatası varsa sessiz ol
      if (error.code === '42P01' || error.code === 'PGRST116') {
        console.log('📋 Activity logs tablosu henüz oluşturulmamış');
      } else {
        console.error('Log kaydetme hatası:', error);
      }
    }
  } catch (error) {
    console.error('Log kaydetme hatası:', error);
  }
};

/**
 * Önceden tanımlanmış log fonksiyonları
 */
export const ActivityLogger = {
  // Login/Logout
  login: (email) => logActivity('login', `Kullanıcı giriş yaptı: ${email}`, 'login'),
  logout: (email) => logActivity('logout', `Kullanıcı çıkış yaptı: ${email}`, 'login'),
  
  // Bordro işlemleri
  bordroEmployeeCreate: (name) => logActivity('create', `Personel eklendi: ${name}`, 'bordro'),
  bordroEmployeeUpdate: (name) => logActivity('update', `Personel güncellendi: ${name}`, 'bordro'),
  bordroEmployeeDelete: (name) => logActivity('delete', `Personel silindi: ${name}`, 'bordro'),
  bordroDailyLogSave: (employeeName, date) => logActivity('update', `Puantaj kaydedildi: ${employeeName} - ${date}`, 'bordro'),
  bordroExpenseAdd: (type, amount, employeeName) => logActivity('create', `${type} eklendi: ${amount} TL - ${employeeName}`, 'bordro'),
  bordroExpenseDelete: (type, amount) => logActivity('delete', `${type} silindi: ${amount} TL`, 'bordro'),
  bordroBalanceUpdate: (employeeName, month, year) => logActivity('update', `Bakiye kaydedildi: ${employeeName} - ${month}/${year}`, 'bordro'),
  bordroMonthlySave: (month, year, employeeCount) => logActivity('create', `Aylık bordro kaydedildi: ${month}/${year} - ${employeeCount} personel`, 'bordro'),
  bordroExportPDF: (employeeName) => logActivity('export', `Bordro PDF indirildi: ${employeeName}`, 'bordro'),
  bordroExportAllPDF: (month, year) => logActivity('export', `Toplu bordro PDF indirildi: ${month}/${year}`, 'bordro'),
  bordroExportExcel: (month, year) => logActivity('export', `Bordro Excel indirildi: ${month}/${year}`, 'bordro'),
  
  // Teklif işlemleri
  teklifCreate: (companyName) => logActivity('create', `Teklif oluşturuldu: ${companyName}`, 'teklif'),
  teklifUpdate: (companyName) => logActivity('update', `Teklif güncellendi: ${companyName}`, 'teklif'),
  teklifDelete: (companyName) => logActivity('delete', `Teklif silindi: ${companyName}`, 'teklif'),
  teklifExportPDF: (companyName) => logActivity('export', `Teklif PDF indirildi: ${companyName}`, 'teklif'),
  
  // Fatura işlemleri
  faturaCreate: (invoiceNo) => logActivity('create', `Fatura oluşturuldu: ${invoiceNo}`, 'fatura'),
  faturaUpdate: (invoiceNo) => logActivity('update', `Fatura güncellendi: ${invoiceNo}`, 'fatura'),
  faturaDelete: (invoiceNo) => logActivity('delete', `Fatura silindi: ${invoiceNo}`, 'fatura'),
  faturaExportPDF: (invoiceNo) => logActivity('export', `Fatura PDF indirildi: ${invoiceNo}`, 'fatura'),
  
  // Admin işlemleri
  adminView: () => logActivity('view', 'Admin paneli görüntülendi', 'admin'),
  settingsUpdate: (settingName) => logActivity('update', `Ayar güncellendi: ${settingName}`, 'admin')
};

export default ActivityLogger;

