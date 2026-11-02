import { siteHubStyles, siteHubCardStyle, siteHubIconColor, siteHubIconSize } from '../portal/siteHubStyles';
// Faz 45 — ComplianceHubScreen
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

type Tile = { key: keyof RootStackParamList; label: string; icon: any; color: string };

const TILES: Tile[] = [
  { key: 'NonConformity', label: 'Uygunsuzluklar', icon: 'warning', color: '#ef4444' },
  { key: 'Capa', label: 'DÖF/Ö-Faaliyet', icon: 'construct', color: '#0ea5e9' },
  { key: 'SafetyChecklists', label: 'İSG Kontrol', icon: 'list', color: '#f59e0b' },
  { key: 'RiskAssessment', label: 'Risk Değerlend.', icon: 'analytics', color: '#f97316' },
  { key: 'AuditSchedule', label: 'Denetim Planı', icon: 'calendar', color: '#8b5cf6' },
  { key: 'AuditScoring', label: 'Denetim Puanlama', icon: 'star', color: '#eab308' },
  { key: 'NcPhotoEvidence', label: 'Fotoğraflı Kanıt', icon: 'camera', color: '#06b6d4' },
  { key: 'NcAssignment', label: 'Sorumlu Atama', icon: 'people', color: '#a855f7' },
  { key: 'QualityDashboard', label: 'Kalite Panosu', icon: 'speedometer', color: '#14b8a6' },
  { key: 'AuditReport', label: 'Denetim Raporu', icon: 'document-text', color: '#22c55e' },
];

export default function ComplianceHubScreen() {
  const nav = useNavigation<Nav>();
  const { tileWidth, onGridLayout } = useMeasuredGrid({ gap: '2%', horizontalPadding: spacing.md });
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
        <View style={s.hero}>
          <Ionicons name="shield-checkmark" size={100} color="#14b8a6" />
          <Text style={s.heroTitle}>Kalite & Denetim</Text>
          <Text style={s.heroSub}>Uygunsuzluk, DÖF, risk, denetim ve raporlama</Text>
        </View>
        <View style={s.grid} onLayout={onGridLayout}>
          {TILES.map(t => (
            <TouchableOpacity accessibilityRole="button" testID="site-hub-card"
              key={t.key}
              style={[s.tile, { width: tileWidth, backgroundColor: t.color }, siteHubCardStyle()]}
              onPress={() => nav.navigate(t.key as any)}
              activeOpacity={0.85}
            >
              <Ionicons testID="site-hub-icon" name={t.icon} size={siteHubIconSize(28)} color={siteHubIconColor("#fff")} />
              <Text testID="site-hub-title" style={s.tileT}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create(siteHubStyles({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  hero: { alignItems: 'center', paddingVertical: spacing.lg, gap: 4 },
  heroTitle: { color: colors.text.primary, fontSize: typography.xxl, fontWeight: '800', marginTop: spacing.sm },
  heroSub: { color: colors.text.muted, fontSize: typography.sm, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: '2%' as any },
  tile: { aspectRatio: 1.4, borderRadius: radius.md, padding: spacing.md, justifyContent: 'space-between', marginBottom: spacing.sm },
  tileT: { color: '#fff', fontSize: typography.sm, fontWeight: '800' },
}, { hideHero: true }));
