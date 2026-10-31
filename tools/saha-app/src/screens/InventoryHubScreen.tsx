import { siteHubStyles, siteHubCardStyle, siteHubIconStyle, siteHubIconColor, siteHubIconSize, siteHubStatStyle, siteHubStatColor } from '../portal/siteHubStyles';
// InventoryHubScreen — POZ-DEV-241 Ürün Takip merkez
import { useMeasuredGrid } from '../portal/useMeasuredGrid';
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../types';
import { listProductItems } from '../services/productItems';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function InventoryHubScreen() {
  const nav = useNavigation<Nav>();
  const { tileWidth, onGridLayout } = useMeasuredGrid({ gap: spacing.md, horizontalPadding: spacing.lg, maxWidth: 1200 });
  const [c, setC] = useState({ total: 0, stock: 0, inuse: 0, maint: 0 });
  const refresh = useCallback(async () => {
    const all = await listProductItems();
    setC({
      total: all.length,
      stock: all.filter(p => p.status === 'in_stock').length,
      inuse: all.filter(p => p.status === 'in_use').length,
      maint: all.filter(p => p.status === 'maintenance').length,
    });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const TILES = [
    { key: 'ProductCatalog',  label: 'Ürün Kataloğu',  desc: '16K+ ürün · marka · kategori', icon: 'library-outline' as const,    color: '#10b981', poz: 'POZ-CAT-001' },
    { key: 'ProductItems',    label: 'Ürün Listesi',  desc: 'Seri no + lokasyon',     icon: 'cube-outline' as const,        color: '#0ea5e9', poz: 'POZ-DEV-242' },
    { key: 'ProductItemForm', label: 'Yeni Ürün',     desc: 'Envantere ürün ekle',    icon: 'add-circle-outline' as const,  color: '#22c55e', poz: 'POZ-DEV-243' },
    { key: 'Stock',           label: 'Klasik Stok',   desc: 'Malzeme stoğu',          icon: 'layers-outline' as const,      color: '#8b5cf6', poz: 'POZ-DEV-156' },
    { key: 'BarcodeScan',     label: 'Barkod Tarat',  desc: 'Hızlı arama / sayım',    icon: 'barcode-outline' as const,     color: '#f59e0b', poz: 'POZ-DEV-159' },
  ];

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <View style={s.heroIcon}><Ionicons name="cube-outline" size={28} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroT}>Ürün Takip</Text>
            <Text style={s.heroS}>Envanter · Seri no · Lokasyon</Text>
          </View>
        </View>
        <View style={s.statusRow}>
          <Pill label={`Toplam: ${c.total}`} color="#64748b" icon="layers-outline" />
          <Pill label={`Depoda: ${c.stock}`} color="#22c55e" icon="archive-outline" />
          <Pill label={`Kullanımda: ${c.inuse}`} color="#0ea5e9" icon="hammer-outline" />
          <Pill label={`Bakımda: ${c.maint}`} color={c.maint > 0 ? '#a855f7' : '#64748b'} icon="construct-outline" />
        </View>
        <View style={[s.grid, { maxWidth: 1200, alignSelf: 'center', width: '100%' }]} onLayout={onGridLayout}>
          {TILES.map(t => (
            <TouchableOpacity accessibilityRole="button" testID="site-hub-card" key={t.key} style={[s.tile, { width: tileWidth }, siteHubCardStyle()]} onPress={() => nav.navigate(t.key as never)} activeOpacity={0.85}>
              <View testID="site-hub-icon" style={[s.tileIcon, { backgroundColor: t.color }, siteHubIconStyle()]}><Ionicons name={t.icon} size={siteHubIconSize(22)} color={siteHubIconColor("#fff")} /></View>
              <Text testID="site-hub-title" style={s.tileLabel}>{t.label}</Text>
              <Text testID="site-hub-description" style={s.tileDesc}>{t.desc}</Text>

            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Pill({ label, color, icon }: { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={[s.pill, { borderColor: color, backgroundColor: color + '22' }, siteHubStatStyle(color)]}>
      <Ionicons name={icon} size={12} color={siteHubStatColor(color)} />
      <Text style={[s.pillText, { color }, { color: siteHubStatColor(color) }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create(siteHubStyles({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.lg, paddingBottom: 80, gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, backgroundColor: '#0ea5e9', borderRadius: radius.md },
  heroIcon: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  heroT: { color: '#fff', fontWeight: '800', fontSize: typography.md },
  heroS: { color: 'rgba(255,255,255,0.85)', fontSize: typography.xs, marginTop: 2 },
  statusRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { padding: spacing.md, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.md },
  tileIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileLabel: { color: colors.text.primary, fontWeight: '800', fontSize: typography.sm },
  tileDesc: { color: colors.text.muted, fontSize: typography.xs, marginTop: 2 },
  tilePoz: { color: colors.text.faint, fontSize: 10, marginTop: 6, fontWeight: '700' },
}, { hideHero: true }));
