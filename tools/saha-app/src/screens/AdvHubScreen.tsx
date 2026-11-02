import { siteHubStyles, siteHubCardStyle, siteHubIconColor, siteHubIconSize } from '../portal/siteHubStyles';
// Faz 58 — AdvHubScreen (POZ-DEV-285)
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
type Tile = { key: keyof RootStackParamList; label: string; icon: string; color: string; desc: string };

const TILES: Tile[] = [
  { key: 'AdvEcommerce', label: 'E-Ticaret Entegrasyonu', icon: 'storefront', color: '#0ea5e9', desc: 'Shopify, Woo, Trendyol, Hepsiburada' },
  { key: 'AdvCallCenter', label: 'Çağrı Merkezi', icon: 'call', color: '#22c55e', desc: 'Operatör paneli, kayıt, aktarım' },
  { key: 'AdvBI', label: 'Power BI / Looker', icon: 'bar-chart', color: '#8b5cf6', desc: 'Veri köprüsü ve dataset takibi' },
  { key: 'AdvVoiceAI', label: 'Sesli AI', icon: 'mic', color: '#f59e0b', desc: 'Ses-metin dönüşümü ve sınıflandırma' },
  { key: 'AdvCollectionForecast', label: 'Tahsilat Tahmini', icon: 'trending-down', color: '#dc2626', desc: 'Ödeme tarihi tahmini & risk skoru' },
  { key: 'AdvRfm', label: 'RFM Segmentasyon', icon: 'people-circle', color: '#ec4899', desc: 'Otomatik müşteri segmentasyonu' },
];

export default function AdvHubScreen() {
  const nav = useNavigation<Nav>();
  const { tileWidth: tileW, onGridLayout } = useMeasuredGrid({ gap: '2%', horizontalPadding: spacing.md, breakpoints: [[900, 3], [520, 2]] });
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.hero}>
          <Ionicons name="rocket" size={100} color="#ec4899" />
          <Text style={s.heroT}>İleri Analitik & AI</Text>
          <Text style={s.heroD}>E-ticaret, çağrı merkezi, BI, sesli AI, tahsilat tahmini, RFM segmentasyon</Text>
        </View>
        <View style={s.grid} onLayout={onGridLayout}>
          {TILES.map(t => (
            <TouchableOpacity accessibilityRole="button" testID="site-hub-card" key={t.key} style={[s.tile, { width: tileW, borderColor: t.color }, siteHubCardStyle()]} onPress={() => nav.navigate(t.key as any)} activeOpacity={0.85}>
              <Ionicons testID="site-hub-icon" name={t.icon as any} size={siteHubIconSize(32)} color={siteHubIconColor(t.color)} />
              <Text testID="site-hub-title" style={s.tileL}>{t.label}</Text>
              <Text testID="site-hub-description" style={s.tileD}>{t.desc}</Text>
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
  tile: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.bg.secondary, alignItems: 'center', gap: 6, minHeight: 140, justifyContent: 'center', marginBottom: spacing.sm },
  tileL: { color: colors.text.primary, fontSize: typography.sm, fontWeight: '700', textAlign: 'center' },
  tileD: { color: colors.text.muted, fontSize: typography.xs, textAlign: 'center' },
}, { hideHero: true }));
