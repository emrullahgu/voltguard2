import { siteHubStyles, siteHubCardStyle, siteHubIconStyle, siteHubIconColor, siteHubIconSize } from '../portal/siteHubStyles';
// ProposalsHubScreen — POZ-DEV-260 Teklif modülleri merkez
import { useMeasuredGrid } from '../portal/useMeasuredGrid';
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography } from '../theme';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TILES: { key: keyof RootStackParamList; label: string; desc: string; icon: keyof typeof Ionicons.glyphMap; color: string; poz: string }[] = [
  { key: 'TransformerProposals', label: 'YG Trafo Teklif',  desc: 'İşletme sorumlusu hesap', icon: 'flash-outline',     color: '#0ea5e9', poz: 'POZ-DEV-218' },
  { key: 'GesProposals',         label: 'GES Teklif',       desc: 'Çatı/Arazi/Carport',     icon: 'sunny-outline',     color: '#f59e0b', poz: 'POZ-DEV-225' },
  { key: 'NewQuote',             label: 'Yeni Teklif',       desc: 'Keşif/metraj kalemli',   icon: 'add-circle-outline',color: '#8b5cf6', poz: 'POZ-DEV-041' },
];

export default function ProposalsHubScreen() {
  const nav = useNavigation<Nav>();
  const { tileWidth, onGridLayout } = useMeasuredGrid({ gap: spacing.md, horizontalPadding: spacing.lg, maxWidth: 1200 });
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <View style={s.heroIcon}><Ionicons name="calculator-outline" size={28} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroT}>Teklif Modülleri</Text>
            <Text style={s.heroS}>Trafo · GES · Standart teklifler</Text>
          </View>
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

const s = StyleSheet.create(siteHubStyles({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.lg, paddingBottom: 80, gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, backgroundColor: '#f59e0b', borderRadius: radius.md },
  heroIcon: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  heroT: { color: '#fff', fontWeight: '800', fontSize: typography.md },
  heroS: { color: 'rgba(255,255,255,0.85)', fontSize: typography.xs, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { padding: spacing.md, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.md },
  tileIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileLabel: { color: colors.text.primary, fontWeight: '800', fontSize: typography.sm },
  tileDesc: { color: colors.text.muted, fontSize: typography.xs, marginTop: 2 },
  tilePoz: { color: colors.text.faint, fontSize: 10, marginTop: 6, fontWeight: '700' },
}, { hideHero: true }));
