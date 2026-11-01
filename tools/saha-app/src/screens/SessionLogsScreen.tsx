// SessionLogsScreen — POZ-DEV-361
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, typography } from '../theme';
import { listSessions, recordSession } from '../services/governance';
import type { SessionLog } from '../types';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import { FLATLIST_DEFAULTS } from '../utils/perf';

export default function SessionLogsScreen() {
  const [items, setItems] = useState<SessionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hosted = typeof window !== 'undefined' && !!(window as any).VoltGuardEmployeeModules;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (hosted) throw new Error('Çalışan oturumlarını sağlayan denetim servisi bu portalda henüz bağlı değil. Kayıtlar doğrulanamadı.');
      setItems(await listSessions());
    } catch (failure: any) { setError(failure?.message || 'Oturum kayıtları yüklenemedi.'); }
    finally { setLoading(false); }
  }, [hosted]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const seedDemo = async () => {
    if (hosted) return;
    try {
      const now = Date.now();
      await recordSession({ userId: 'u1', userName: 'Ahmet', startedAt: new Date(now - 7200000).toISOString(), endedAt: new Date(now - 3600000).toISOString(), platform: 'android', ip: '10.0.0.5', device: 'Samsung A52' });
      await recordSession({ userId: 'u2', userName: 'Mehmet', startedAt: new Date(now - 86400000).toISOString(), platform: 'ios', ip: '88.12.4.1', device: 'iPhone 13', location: 'İstanbul' });
      await recordSession({ userId: 'u3', userName: 'Bilinmeyen', startedAt: new Date(now - 600000).toISOString(), platform: 'web', ip: '45.227.255.205', device: 'Chrome / TOR', suspicious: true, reason: 'Yabancı IP + TOR' });
      await load();
    } catch (failure: any) { setError(failure?.message || 'Örnek kayıtlar oluşturulamadı.'); }
  };

  if (loading) return <SafeAreaView style={s.safe} edges={['bottom']}><ActivityIndicator accessibilityLabel="Kayıtlar yükleniyor" /></SafeAreaView>;
  if (error) return <SafeAreaView style={s.safe} edges={['bottom']}><ErrorState title="Oturum kayıtları kullanılamıyor" message={error} onRetry={load} retryLabel="Yeniden kontrol et" /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.toolbar}>
        <Text style={s.toolbarT}>{items.length} oturum</Text>
        {!hosted && <TouchableOpacity style={s.btn} onPress={seedDemo}>
          <Ionicons name="flask-outline" size={14} color="#fff" />
          <Text style={s.btnTxt}>Demo Veri</Text>
        </TouchableOpacity>}
      </View>
      <FlatList
        {...FLATLIST_DEFAULTS}
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: 80 }}
        ListEmptyComponent={
          <EmptyState
            icon="key-outline"
            title="Oturum kaydı yok"
            subtitle="Henüz sisteme giriş kaydı bulunmuyor."
            actionLabel={hosted ? undefined : '+ Demo Veri Oluştur'}
            onAction={hosted ? undefined : seedDemo}
          />
        }
        renderItem={({ item }) => (
          <View style={[s.card, item.suspicious && { borderColor: '#ef4444' }]}>
            <View style={[s.iconWrap, { backgroundColor: (item.suspicious ? '#ef4444' : '#ec4899') + '22' }]}>
              <Ionicons name={item.suspicious ? 'warning-outline' : 'log-in-outline'} size={22} color={item.suspicious ? '#ef4444' : '#ec4899'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.t}>{item.userName || item.userId}{item.suspicious ? ' ⚠️' : ''}</Text>
              <Text style={s.sub}>{item.platform || '—'} · {item.device || '—'}{item.ip ? ' · ' + item.ip : ''}</Text>
              <Text style={s.sub}>{new Date(item.startedAt).toLocaleString('tr-TR')}{item.endedAt ? ' → ' + new Date(item.endedAt).toLocaleTimeString('tr-TR') : ' (aktif)'}</Text>
              {item.reason ? <Text style={s.warn}>{item.reason}</Text> : null}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  toolbarT: { color: colors.text.muted, fontSize: typography.sm },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#8b5cf6', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full },
  btnTxt: { color: '#fff', fontSize: typography.xs, fontWeight: '700' },
  empty: { color: colors.text.muted, textAlign: 'center', marginTop: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.bg.secondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.primary },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  t: { color: colors.text.primary, fontSize: typography.sm, fontWeight: '700' },
  sub: { color: colors.text.muted, fontSize: typography.xs, marginTop: 2 },
  warn: { color: '#ef4444', fontSize: typography.xs, marginTop: 2, fontWeight: '700' },
});
