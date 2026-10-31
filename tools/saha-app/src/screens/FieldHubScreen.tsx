import { siteHubStyles, siteHubCardStyle, siteHubIconStyle, siteHubIconColor, siteHubIconSize } from '../portal/siteHubStyles';
// FieldHubScreen — POZ-DEV-380 Faz 36 hub
import { useMeasuredGrid } from '../portal/useMeasuredGrid';
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography } from '../theme';
import { listOps } from '../services/offline';
import type { OfflineOperation, RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'FieldHub'>;

const TILES: { key: keyof RootStackParamList; label: string; icon: string; color: string; desc: string }[] = [
  { key: 'OfflineQueue', label: 'Offline Kuyruk', icon: 'cloud-offline-outline', color: '#f59e0b', desc: 'Bekleyen senkron işlemleri' },
  { key: 'SyncHistory', label: 'Senkron Geçmişi', icon: 'sync-circle-outline', color: '#0ea5e9', desc: 'Önceki senkronlar' },
  { key: 'ConnectivityMonitor', label: 'Bağlantı Monitörü', icon: 'pulse-outline', color: '#22c55e', desc: 'Online / offline takibi' },
  { key: 'FieldFavorites', label: 'Favori İşlemler', icon: 'star-outline', color: '#ec4899', desc: 'Hızlı erişim kısayolları' },
  { key: 'FieldSettings', label: 'Saha Ayarları', icon: 'options-outline', color: '#8b5cf6', desc: 'Sade mod / tek el / GPS' },
];

export default function FieldHubScreen() {
  const nav = useNavigation<Nav>();
  const { tileWidth: tileW, onGridLayout } = useMeasuredGrid({ gap: spacing.sm, horizontalPadding: spacing.md });
  const [ops, setOps] = useState<OfflineOperation[]>([]);

  const load = useCallback(async () => { setOps(await listOps()); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pending = ops.filter(o => o.status === 'pending').length;
  const conflicts = ops.filter(o => o.status === 'conflict').length;
  const failed = ops.filter(o => o.status === 'failed').length;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <View style={s.heroIcon}><Ionicons name="phone-portrait-outline" size={28} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroT}>Mobil Saha</Text>
            <Text style={s.heroS}>FAZ 36 — Offline + sade mod + favoriler</Text>
          </View>
        </View>

        <View style={s.stats}>
          <Stat label="Bekleyen" value={pending} color="#f59e0b" />
          <Stat label="Çakışma" value={conflicts} color="#a855f7" />
          <Stat label="Hatalı" value={failed} color="#ef4444" />
          <Stat label="Toplam" value={ops.length} color="#0ea5e9" />
        </View>

        <View style={s.grid} onLayout={onGridLayout}>
          {TILES.map(t => (
            <TouchableOpacity accessibilityRole="button" testID="site-hub-card" key={t.key} style={[s.tile, { width: tileW, borderLeftColor: t.color }, siteHubCardStyle()]} onPress={() => nav.navigate(t.key as never)}>
              <View testID="site-hub-icon" style={[s.tileIcon, { backgroundColor: t.color + '22' }, siteHubIconStyle()]}>
                <Ionicons name={t.icon as never} size={siteHubIconSize(22)} color={siteHubIconColor(t.color)} />
              </View>
              <Text testID="site-hub-title" style={s.tileLabel}>{t.label}</Text>
              <Text testID="site-hub-description" style={s.tileDesc} numberOfLines={2}>{t.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[s.stat, { borderColor: color }]}>
      <Text style={[s.statV, { color }]}>{value}</Text>
      <Text style={s.statL}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create(siteHubStyles({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.md, gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: '#0ea5e9', borderRadius: radius.md },
  heroIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  heroT: { color: '#fff', fontSize: typography.md, fontWeight: '800' },
  heroS: { color: '#fff', opacity: 0.9, fontSize: typography.sm, marginTop: 2 },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.bg.secondary, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1 },
  statV: { fontSize: typography.lg, fontWeight: '800' },
  statL: { color: colors.text.muted, fontSize: typography.xs, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { padding: spacing.md, backgroundColor: colors.bg.secondary, borderRadius: radius.md, borderLeftWidth: 4, gap: 6, borderWidth: 1, borderColor: colors.border.primary },
  tileIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { color: colors.text.primary, fontSize: typography.sm, fontWeight: '700' },
  tileDesc: { color: colors.text.muted, fontSize: typography.xs },
}, { hideHero: true }));
