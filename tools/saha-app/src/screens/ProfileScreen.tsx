import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, radius, typography, brand } from '../theme';
import { useAuth, UserRole } from '../context/AuthContext';
import { getPendingWrites } from '../portal/api';

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Yönetici', manager: 'Müdür', engineer: 'Mühendis', field: 'Saha personeli' };
export default function ProfileScreen() {
  const nav = useNavigation<any>();
  const { user, profile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = profile?.full_name || user?.user_metadata?.full_name || 'Çalışan';
  const initials = name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toLocaleUpperCase('tr');
  const leave = async () => {
    setError(''); setBusy(true);
    try { await signOut(); } catch (e: any) { setError(e?.message || 'Oturum kapatılamadı.'); } finally { setBusy(false); }
  };
  const openAccount = () => {
    if (getPendingWrites()) { setError('Sunucuya yazılan işlemlerin tamamlanmasını bekleyin.'); return; }
    window.top!.location.assign('/calisan/');
  };
  return <SafeAreaView style={s.safe} edges={['bottom']}><ScrollView contentContainerStyle={s.content}>
    <View style={s.card}>
      {profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={s.avatar} /> : <View style={s.avatar}><Text style={s.initials}>{initials}</Text></View>}
      <Text style={s.title}>{name}</Text><Text style={s.text}>{user?.email || '—'}</Text>
      <Text style={s.text}>{profile?.role ? ROLE_LABEL[profile.role] : 'Çalışan'}</Text>
      {profile?.phone ? <Text style={s.text}>{profile.phone}</Text> : null}
    </View>
    <View style={s.card}><Text style={s.title}>Çalışan hesabınız</Text>
      <Text style={s.text}>Bu modüller mevcut VoltGuard çalışan oturumunuzu kullanır. Ad, telefon, fotoğraf ve erişim yetkisi değişikliklerini şirket yöneticinizle güncelleyebilirsiniz.</Text>
      <Text style={s.text}>Şifre, doğrulayıcı uygulama ve cihaz değişikliği için çalışan portalındaki “Hesap güvenliği” bölümünü kullanın.</Text>
      <TouchableOpacity style={s.button} onPress={openAccount}><Ionicons name="shield-checkmark-outline" size={20} color="#fff" /><Text style={s.buttonText}>Çalışan hesabını aç</Text></TouchableOpacity>
    </View>
    <TouchableOpacity style={s.row} onPress={() => nav.navigate('Notifications')}><Ionicons name="notifications-outline" size={20} color={colors.text.primary} /><Text style={s.text}>Bildirimler</Text></TouchableOpacity>
    {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
    <TouchableOpacity style={[s.button, s.signout]} onPress={leave} disabled={busy} accessibilityState={{ busy }}>
      {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="log-out-outline" size={20} color="#fff" />}<Text style={s.buttonText}>Çalışan oturumunu kapat</Text>
    </TouchableOpacity>
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary }, content: { padding: spacing.md, gap: spacing.md, paddingBottom: 80 },
  card: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.bg.secondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.primary },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: brand.blue, alignItems: 'center', justifyContent: 'center' }, initials: { color: '#fff', fontSize: 24, fontWeight: '800' },
  title: { fontSize: typography.md, color: colors.text.primary, fontWeight: '800' }, text: { color: colors.text.secondary, fontSize: typography.sm, lineHeight: 23, flexShrink: 1 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', padding: spacing.md, backgroundColor: brand.blue, borderRadius: radius.md }, buttonText: { color: '#fff', fontWeight: '700', fontSize: typography.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', padding: spacing.md, backgroundColor: colors.bg.secondary, borderRadius: radius.md }, signout: { backgroundColor: '#b91c1c' }, error: { color: '#b91c1c', fontSize: typography.sm },
});
