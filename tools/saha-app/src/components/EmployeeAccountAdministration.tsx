import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radius, brand } from '../theme';
import { useAuth } from '../context/AuthContext';
import { getPendingWrites } from '../portal/api';
export default function EmployeeAccountAdministration() {
  const { profile } = useAuth();
  const [error, setError] = useState('');
  const open = () => {
    if (getPendingWrites()) { setError('Sunucuya yazılan işlemlerin tamamlanmasını bekleyin.'); return; }
    window.top!.location.assign('/calisan/');
  };
  return <SafeAreaView style={s.safe}><View style={s.card}>
    <Text style={s.title}>Çalışan hesapları ve erişim</Text>
    <Text style={s.text}>Çalışan davetleri, hesap onayları ve erişim yetkileri VoltGuard çalışan portalından yönetilir. Tüm modüller aynı onaylı çalışan hesabını kullanır.</Text>
    <Text style={s.text}>{profile?.role === 'admin' ? 'Çalışan portalındaki “Çalışanlar” bölümünden davet oluşturabilir ve hesap durumlarını yönetebilirsiniz.' : 'Hesap açma ve erişim değişiklikleri için şirket yöneticinize başvurun. Çalışan portalında kendi hesap güvenliğinizi görebilirsiniz.'}</Text>
    {error ? <Text style={s.text} accessibilityRole="alert">{error}</Text> : null}
    <TouchableOpacity style={s.button} onPress={open}><Text style={s.buttonText}>VoltGuard çalışan portalını aç</Text></TouchableOpacity>
  </View></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg.primary, padding: spacing.md }, card: { backgroundColor: colors.bg.secondary, borderRadius: radius.md, padding: spacing.md, gap: spacing.md }, title: { color: colors.text.primary, fontSize: 22, fontWeight: '800' }, text: { color: colors.text.secondary, lineHeight: 24, fontSize: 15 }, button: { backgroundColor: brand.blue, padding: spacing.md, borderRadius: radius.md }, buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' } });
