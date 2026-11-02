import { siteHubStyles, siteHubCardStyle, siteHubIconStyle, siteHubIconColor, siteHubIconSize, siteHubStatStyle, siteHubStatColor } from '../portal/siteHubStyles';
// PayrollHubScreen — POZ-DEV-251 Bordro & Puantaj merkez
import { useMeasuredGrid } from '../portal/useMeasuredGrid';
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../types';
import { useAppContext } from '../context/AppContext';
import { listPayrollRuns, listTimesheet } from '../services/payroll';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function PayrollHubScreen() {
  const nav = useNavigation<Nav>();
  const { employees } = useAppContext();
  const { tileWidth, onGridLayout } = useMeasuredGrid({ gap: spacing.md, horizontalPadding: spacing.lg, maxWidth: 1200 });
  const month = new Date().toISOString().slice(0, 7);
  const [c, setC] = useState({ runsThisMonth: 0, totalNet: 0, daysLogged: 0 });
  const refresh = useCallback(async () => {
    const [runs, ts] = await Promise.all([listPayrollRuns(), listTimesheet()]);
    const thisMonth = runs.filter(r => r.periodMonth === month);
    setC({
      runsThisMonth: thisMonth.length,
      totalNet: thisMonth.reduce((s, r) => s + r.net, 0),
      daysLogged: ts.filter(t => t.date.startsWith(month)).length,
    });
  }, [month]);
  useEffect(() => { refresh(); }, [refresh]);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const TILES = [
    { key: 'Timesheet',   label: 'Puantaj',         desc: 'Günlük gel/git/izin',    icon: 'calendar-outline' as const,  color: '#0ea5e9', poz: 'POZ-DEV-252' },
    { key: 'PayrollRuns', label: 'Bordro Listesi',  desc: 'Aylık bordrolar',        icon: 'document-text-outline' as const, color: '#22c55e', poz: 'POZ-DEV-253' },
    { key: 'LeaveRequests', label: 'İzin Talepleri', desc: 'İzin onay/ret',          icon: 'airplane-outline' as const, color: '#f59e0b', poz: 'POZ-DEV-254' },
  ];

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <View style={s.heroIcon}><Ionicons name="cash-outline" size={28} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroT}>Bordro & Puantaj</Text>
            <Text style={s.heroS}>{employees.length} personel · {month}</Text>
          </View>
        </View>
        <View style={s.statusRow}>
          <Pill label={`Bu ay bordro: ${c.runsThisMonth}`} color="#22c55e" icon="document-text-outline" />
          <Pill label={`Net: ₺${c.totalNet.toLocaleString('tr-TR')}`} color="#0ea5e9" icon="wallet-outline" />
          <Pill label={`Puantaj: ${c.daysLogged}`} color="#a855f7" icon="calendar-outline" />
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
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, backgroundColor: '#10b981', borderRadius: radius.md },
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
