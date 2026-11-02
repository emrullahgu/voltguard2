import { siteHubStyles, siteHubCardStyle, siteHubIconColor, siteHubIconSize } from '../portal/siteHubStyles';
// Faz 54 — DocHubScreen
import { useMeasuredGrid } from '../portal/useMeasuredGrid';
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography } from '../theme';
import type { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tile = { key: keyof RootStackParamList; label: string; icon: string; color: string };

const TILES: Tile[] = [
  { key: 'DocAdminGuide', label: 'Admin Kılavuzu', icon: 'shield-checkmark', color: '#ef4444' },
  { key: 'DocManagerGuide', label: 'Yönetici Kılavuzu', icon: 'briefcase', color: '#a855f7' },
  { key: 'DocFieldGuide', label: 'Saha Personeli', icon: 'walk', color: '#22c55e' },
  { key: 'DocCustomerGuide', label: 'Müşteri Portalı', icon: 'person', color: '#0ea5e9' },
  { key: 'DocSupabaseOps', label: 'Şirket sunucusu Ops', icon: 'server', color: '#10b981' },
  { key: 'DocNetlifyOps', label: 'Netlify Ops', icon: 'cloud', color: '#06b6d4' },
  { key: 'DocApkOps', label: 'APK Yayın', icon: 'phone-portrait', color: '#8b5cf6' },
  { key: 'DocFaq', label: 'Sık Sorulanlar', icon: 'help-buoy', color: '#f59e0b' },
  { key: 'DocTraining', label: 'Eğitim Videoları', icon: 'play-circle', color: '#ec4899' },
  { key: 'DocChecklist', label: 'Yayın Öncesi Kontrol', icon: 'checkbox', color: '#3b82f6' },
];

export default function DocHubScreen() {
  const nav = useNavigation<Nav>();
  const { tileWidth: tileW, onGridLayout } = useMeasuredGrid({ gap: '2%', horizontalPadding: spacing.md });
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.hero}>
          <Ionicons name="library" size={100} color="#0891b2" />
          <Text style={s.heroT}>Dokümantasyon & Eğitim</Text>
          <Text style={s.heroD}>Rol bazlı kılavuzlar, operasyon runbook'ları, SSS ve eğitim videoları</Text>
        </View>
        <View style={s.grid} onLayout={onGridLayout}>
          {TILES.map(t => (
            <TouchableOpacity accessibilityRole="button" testID="site-hub-card" key={t.key} style={[s.tile, { width: tileW, borderColor: t.color }, siteHubCardStyle()]} onPress={() => nav.navigate(t.key as any)} activeOpacity={0.85}>
              <Ionicons testID="site-hub-icon" name={t.icon as any} size={siteHubIconSize(32)} color={siteHubIconColor(t.color)} />
              <Text testID="site-hub-title" style={s.tileL}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create(siteHubStyles({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: { padding: spacing.md, gap: spacing.md },
  hero: { alignItems: 'center', paddingVertical: spacing.lg, gap: 6 },
  heroT: { color: colors.text.primary, fontSize: typography.xxl, fontWeight: '800' },
  heroD: { color: colors.text.muted, fontSize: typography.sm, textAlign: 'center', paddingHorizontal: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: '2%' as any },
  tile: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.bg.secondary, alignItems: 'center', gap: spacing.sm, minHeight: 120, justifyContent: 'center', marginBottom: spacing.sm },
  tileL: { color: colors.text.primary, fontSize: typography.sm, fontWeight: '700', textAlign: 'center' },
}, { hideHero: true }));
