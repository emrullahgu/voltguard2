import { siteHubStyles, siteHubCardStyle, siteHubIconColor, siteHubIconSize } from '../portal/siteHubStyles';
// Faz 47 — ExecHubScreen
import { useMeasuredGrid } from '../portal/useMeasuredGrid';
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, radius, typography } from '../theme';

const TILES = [
  { key: 'ceo', label: 'CEO Özeti', icon: 'briefcase', color: '#facc15', nav: 'CeoSummary' },
  { key: 'health', label: 'Operasyon Sağlık', icon: 'pulse', color: '#22c55e', nav: 'OpsHealthScore' },
  { key: 'rev', label: 'Gelir & Kâr KPI', icon: 'cash', color: '#0ea5e9', nav: 'RevenueKpi' },
  { key: 'cust', label: 'Kârlı Müşteriler', icon: 'star', color: '#f59e0b', nav: 'ProfitableCustomers' },
  { key: 'wo', label: 'Maliyetli İş Emirleri', icon: 'alert-circle', color: '#ef4444', nav: 'CostlyWorkOrders' },
  { key: 'emp', label: 'Personel Sıralaması', icon: 'people', color: '#8b5cf6', nav: 'EmployeeRanking' },
  { key: 'veh', label: 'Araç Verimliliği', icon: 'car', color: '#06b6d4', nav: 'VehicleEfficiency' },
  { key: 'stock', label: 'Stok Devir Hızı', icon: 'cube', color: '#a855f7', nav: 'StockTurnover' },
  { key: 'quote', label: 'Teklif Dönüşümü', icon: 'document-text', color: '#14b8a6', nav: 'QuoteConversion' },
  { key: 'ai', label: 'AI Yönetici Özeti', icon: 'sparkles', color: '#ec4899', nav: 'AiExecSummary' },
];

export default function ExecHubScreen() {
  const nav = useNavigation<any>();
  const { tileWidth, onGridLayout } = useMeasuredGrid({ gap: '2%', horizontalPadding: spacing.md });
  const tileStyle = { width: tileWidth };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.hero}>
          <Ionicons name="trending-up" size={100} color="#facc15" />
          <Text style={s.heroT}>Stratejik Dashboard</Text>
          <Text style={s.heroS}>CEO ve üst yönetim için özet göstergeler</Text>
        </View>
        <View style={s.grid} onLayout={onGridLayout}>
          {TILES.map(t => (
            <TouchableOpacity accessibilityRole="button" testID="site-hub-card" key={t.key} style={[s.tile, tileStyle, { backgroundColor: t.color + '22', borderColor: t.color }, siteHubCardStyle()]} onPress={() => nav.navigate(t.nav)}>
              <Ionicons testID="site-hub-icon" name={t.icon as any} size={siteHubIconSize(28)} color={siteHubIconColor(t.color)} />
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
  scroll: { padding: spacing.md, gap: spacing.md },
  hero: { alignItems: 'center', paddingVertical: spacing.md },
  heroT: { color: colors.text.primary, fontSize: typography.xxl, fontWeight: '800', marginTop: spacing.sm },
  heroS: { color: colors.text.muted, fontSize: typography.sm, textAlign: 'center', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: '2%' as any, rowGap: spacing.md },
  tile: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 100 },
  tileT: { color: colors.text.primary, fontSize: typography.sm, fontWeight: '700', textAlign: 'center' },
}, { hideHero: true }));
