import { siteHubStyles, siteHubCardStyle, siteHubIconStyle, siteHubIconColor, siteHubIconSize, siteHubStatStyle, siteHubStatColor } from '../portal/siteHubStyles';
// StockHubScreen — POZ-DEV-156 Stok & Zimmet merkez ekranı
import { useMeasuredGrid } from '../portal/useMeasuredGrid';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../types';
import { listMaterials } from '../services/materials';
import { listWarehouses } from '../services/warehouses';
import { listMovements, lowStockAlerts } from '../services/stock';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface Tile {
  key: keyof RootStackParamList;
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  poz?: string;
}

const TILES: Tile[] = [
  { key: 'Materials',       label: 'Malzemeler',     desc: "Malzeme kayıtlarını görüntüleyin ve düzenleyin.",           icon: 'cube-outline',          color: '#0ea5e9', poz: 'POZ-DEV-054' },
  { key: 'Warehouses',      label: 'Depolar',        desc: 'Depo / araç / personel',   icon: 'archive-outline',       color: '#22c55e', poz: 'POZ-DEV-055' },
  { key: 'Stock',           label: 'Stok Bakiye',    desc: 'Anlık miktar',             icon: 'layers-outline',        color: '#8b5cf6', poz: 'POZ-DEV-056' },
  { key: 'StockMovements',  label: 'Hareketler',     desc: 'Giriş / çıkış / transfer', icon: 'swap-horizontal-outline', color: '#f59e0b', poz: 'POZ-DEV-057' },
  { key: 'LowStockAlerts',  label: 'Düşük Stok',     desc: 'Min altı uyarıları',       icon: 'warning-outline',       color: '#ef4444', poz: 'POZ-DEV-157' },
  { key: 'StockSummary',    label: 'Stok Özeti',     desc: 'Depo & değer dağılımı',    icon: 'pie-chart-outline',     color: '#ec4899', poz: 'POZ-DEV-158' },
  { key: 'Assignments',     label: 'Zimmetler',      desc: 'Personel/araç üzeri',      icon: 'person-circle-outline', color: '#14b8a6', poz: 'POZ-DEV-058' },
  { key: 'BarcodeScan',     label: 'Barkod Tara',    desc: 'Stok giriş / çıkış',       icon: 'barcode-outline',       color: '#64748b', poz: 'POZ-DEV-059' },
];

export default function StockHubScreen() {
  const nav = useNavigation<Nav>();
  const { tileWidth, onGridLayout } = useMeasuredGrid({ gap: spacing.md, horizontalPadding: spacing.lg, maxWidth: 1200 });

  const [matCount, setMatCount] = useState(0);
  const [whCount, setWhCount] = useState(0);
  const [movCount, setMovCount] = useState(0);
  const [lowCount, setLowCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [mats, whs, movs, lows] = await Promise.all([
          listMaterials(), listWarehouses(), listMovements(), lowStockAlerts(),
        ]);
        setMatCount(mats.length);
        setWhCount(whs.length);
        setMovCount(movs.length);
        setLowCount(lows.length);
      } catch {}
    })();
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="cube-outline" size={28} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Stok & Zimmet</Text>
            <Text style={styles.heroSub}>Malzeme, depo, hareket, zimmet</Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <Pill label={`Malzeme: ${matCount}`} color="#0ea5e9" icon="cube-outline" />
          <Pill label={`Depo: ${whCount}`} color="#22c55e" icon="archive-outline" />
          <Pill label={`Hareket: ${movCount}`} color="#f59e0b" icon="swap-horizontal-outline" />
          <Pill label={`Düşük: ${lowCount}`} color={lowCount > 0 ? '#ef4444' : '#64748b'} icon="warning-outline" />
        </View>

        {lowCount > 0 && (
          <TouchableOpacity
            style={styles.alertCard}
            activeOpacity={0.85}
            onPress={() => nav.navigate('LowStockAlerts')}
          >
            <Ionicons name="alert-circle" size={20} color="#ef4444" />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertLabel}>Düşük Stok Uyarısı</Text>
              <Text style={styles.alertValue}>{lowCount} malzeme minimum stok altında</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#ef4444" />
          </TouchableOpacity>
        )}

        <View style={[styles.grid, { maxWidth: 1200, alignSelf: 'center', width: '100%' }]} onLayout={onGridLayout}>
          {TILES.map(t => (
            <TouchableOpacity accessibilityRole="button" testID="site-hub-card"
              key={String(t.key)}
              style={[styles.tile, { width: tileWidth }, siteHubCardStyle()]}
              onPress={() => {
                if (t.key === 'BarcodeScan') {
                  nav.navigate('BarcodeScan', { mode: 'material-lookup' });
                } else {
                  nav.navigate(t.key as never);
                }
              }}
              activeOpacity={0.85}
            >
              <View testID="site-hub-icon" style={[styles.tileIcon, { backgroundColor: t.color }, siteHubIconStyle()]}>
                <Ionicons name={t.icon} size={siteHubIconSize(22)} color={siteHubIconColor("#fff")} />
              </View>
              <Text testID="site-hub-title" style={styles.tileLabel}>{t.label}</Text>
              <Text testID="site-hub-description" style={styles.tileDesc}>{t.desc}</Text>

            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Pill({ label, color, icon }: { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={[styles.pill, { borderColor: color, backgroundColor: color + '22' }, siteHubStatStyle(color)]}>
      <Ionicons name={icon} size={12} color={siteHubStatColor(color)} />
      <Text style={[styles.pillText, { color }, { color: siteHubStatColor(color) }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create(siteHubStyles({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.lg, paddingBottom: 80, gap: spacing.md },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, backgroundColor: '#0ea5e9', borderRadius: radius.md },
  heroIcon: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: '#fff', fontWeight: '800', fontSize: typography.md },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: typography.xs, marginTop: 2 },
  statusRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, borderWidth: 1 },
  pillText: { fontSize: 11, fontWeight: '700' },
  alertCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: '#ef4444', borderRadius: radius.md, borderLeftWidth: 4, borderLeftColor: '#ef4444' },
  alertLabel: { color: '#ef4444', fontWeight: '800', fontSize: typography.sm },
  alertValue: { color: colors.text.muted, fontSize: typography.xs, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { padding: spacing.md, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.md },
  tileIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileLabel: { color: colors.text.primary, fontWeight: '800', fontSize: typography.sm },
  tileDesc: { color: colors.text.muted, fontSize: typography.xs, marginTop: 2 },
  tilePoz: { color: colors.text.faint, fontSize: 10, marginTop: 6, fontWeight: '700' },
}, { hideHero: true }));
