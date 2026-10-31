import { siteHubStyles, siteHubCardStyle, siteHubIconColor, siteHubIconSize } from '../portal/siteHubStyles';
// Faz 51 — DepHubScreen
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
  { key: 'DepSupabase', label: 'Şirket sunucusu Yapılandırma', icon: 'server', color: '#22c55e' },
  { key: 'DepRlsPolicies', label: 'RLS Politikaları', icon: 'shield-checkmark', color: '#0ea5e9' },
  { key: 'DepStorage', label: 'Storage Bucket', icon: 'folder-open', color: '#a855f7' },
  { key: 'DepNetlify', label: 'Netlify Deploy', icon: 'cloud-upload', color: '#06b6d4' },
  { key: 'DepBuildErrors', label: 'Derleme Hataları', icon: 'bug', color: '#ef4444' },
  { key: 'DepAiProviders', label: 'AI Sağlayıcılar', icon: 'sparkles', color: '#f59e0b' },
  { key: 'DepAiSecurity', label: 'AI Güvenlik & Log', icon: 'shield-half', color: '#ec4899' },
  { key: 'DepWebWarnings', label: 'Web Uyarıları', icon: 'globe', color: '#3b82f6' },
  { key: 'DepMobileWarnings', label: 'Mobil Uyarıları', icon: 'phone-portrait', color: '#10b981' },
  { key: 'DepApkBuild', label: 'APK Build & Test', icon: 'download', color: '#8b5cf6' },
];

export default function DepHubScreen() {
  const nav = useNavigation<Nav>();
  const { tileWidth: tileW, onGridLayout } = useMeasuredGrid({ gap: '2%', horizontalPadding: spacing.md });
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.hero}>
          <Ionicons name="rocket-outline" size={100} color="#22c55e" />
          <Text style={s.heroT}>Yayın & Platform Kontrolü</Text>
          <Text style={s.heroD}>Şirket sunucusu, Netlify, AI sağlayıcı, derleme uyarıları ve APK build</Text>
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
