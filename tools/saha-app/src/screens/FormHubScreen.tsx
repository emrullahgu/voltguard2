import { siteHubStyles, siteHubCardStyle, siteHubIconStyle, siteHubIconColor, siteHubIconSize, siteHubStatStyle, siteHubStatColor } from '../portal/siteHubStyles';
// FormHubScreen — POZ-DEV-149 Form sistem merkez ekranı
import { useMeasuredGrid } from '../portal/useMeasuredGrid';
import React, { useEffect, useState } from 'react';
import { localDateISO } from '../utils/date';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../types';
import { listTemplates } from '../services/formTemplates';
import { listResponses } from '../services/formResponses';

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
  { key: 'FormTemplates', label: 'Şablonlar',  desc: 'Hazır + özel formlar',     icon: 'albums-outline',         color: '#0ea5e9', poz: 'POZ-DEV-051' },
  { key: 'FormBuilder',   label: 'Yeni Şablon', desc: 'Form tasarımcı',          icon: 'create-outline',         color: '#8b5cf6', poz: 'POZ-DEV-050' },
  { key: 'FormResponses', label: 'Yanıtlar',    desc: 'Doldurulan formlar',      icon: 'list-outline',           color: '#22c55e', poz: 'POZ-DEV-150' },
  { key: 'FormStats',     label: 'İstatistik',  desc: 'Kategori & şablon özeti', icon: 'stats-chart-outline',    color: '#f59e0b', poz: 'POZ-DEV-151' },
];

export default function FormHubScreen() {
  const nav = useNavigation<Nav>();
  const { tileWidth, onGridLayout } = useMeasuredGrid({ gap: spacing.md, horizontalPadding: spacing.lg, maxWidth: 1200 });

  const [tplCount, setTplCount] = useState(0);
  const [seedCount, setSeedCount] = useState(0);
  const [respCount, setRespCount] = useState(0);
  const [todayCount, setTodayCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [tpls, resps] = await Promise.all([listTemplates(), listResponses()]);
        setTplCount(tpls.length);
        setSeedCount(tpls.filter(t => t.isSeed).length);
        setRespCount(resps.length);
        const today = localDateISO();
        // UTC slice yerine yerel gün karşılaştır (gece yarısı UTC+3 kayması).
        setTodayCount(resps.filter(r => r.createdAt && localDateISO(new Date(r.createdAt)) === today).length);
      } catch {}
    })();
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="clipboard-outline" size={28} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Form & Kontrol Listeleri</Text>
            <Text style={styles.heroSub}>Dinamik form tasarla, doldur, raporla</Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <Pill label={`Şablon: ${tplCount}`} color="#0ea5e9" icon="albums-outline" />
          <Pill label={`Hazır: ${seedCount}`} color="#8b5cf6" icon="star-outline" />
          <Pill label={`Yanıt: ${respCount}`} color="#22c55e" icon="checkmark-circle-outline" />
          <Pill label={`Bugün: ${todayCount}`} color="#f59e0b" icon="today-outline" />
        </View>

        <View style={[styles.grid, { maxWidth: 1200, alignSelf: 'center', width: '100%' }]} onLayout={onGridLayout}>
          {TILES.map(t => (
            <TouchableOpacity accessibilityRole="button" testID="site-hub-card"
              key={String(t.key)}
              style={[styles.tile, { width: tileWidth }, siteHubCardStyle()]}
              onPress={() => nav.navigate(t.key as never)}
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { padding: spacing.md, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.md },
  tileIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileLabel: { color: colors.text.primary, fontWeight: '800', fontSize: typography.sm },
  tileDesc: { color: colors.text.muted, fontSize: typography.xs, marginTop: 2 },
  tilePoz: { color: colors.text.faint, fontSize: 10, marginTop: 6, fontWeight: '700' },
}, { hideHero: true }));
