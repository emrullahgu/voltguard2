import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radius, brand } from '../theme';
import { getPendingWrites, reportPortalError } from '../portal/api';
export default function ChangePasswordScreen() {
  const openAccount = () => {
    if (getPendingWrites()) { reportPortalError(new Error('Sunucuya yazılan işlemlerin tamamlanmasını bekleyin.')); return; }
    window.top!.location.assign('/calisan/');
  };
  return <SafeAreaView style={s.safe}><View style={s.card}>
    <Text style={s.title}>Çalışan hesabı güvenliği</Text>
    <Text style={s.text}>SahaTakip için ayrı bir şifre yoktur. Şifre veya doğrulayıcı uygulama değişikliği gerekiyorsa şirket yöneticinizden yeni etkinleştirme daveti isteyin.</Text>
    <TouchableOpacity style={s.button} onPress={openAccount}><Text style={s.buttonText}>Çalışan portalında hesap güvenliği</Text></TouchableOpacity>
  </View></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg.primary, padding: spacing.md }, card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg.secondary, gap: spacing.md }, title: { color: colors.text.primary, fontSize: 22, fontWeight: '800' }, text: { color: colors.text.secondary, fontSize: 15, lineHeight: 24 }, button: { backgroundColor: brand.blue, padding: spacing.md, borderRadius: radius.md }, buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' } });
