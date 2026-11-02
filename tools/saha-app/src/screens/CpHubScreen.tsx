import { siteHubStyles, siteHubCardStyle, siteHubIconColor, siteHubIconSize } from '../portal/siteHubStyles';
// Faz 48 — CpHubScreen
import { useMeasuredGrid } from '../portal/useMeasuredGrid';
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, radius, typography } from '../theme';

const TILES = [
  { key: 'login', label: 'Müşteri Girişi', icon: 'log-in', color: '#0ea5e9', nav: 'CpLogin' },
  { key: 'dash', label: 'Müşteri Dashboard', icon: 'grid', color: '#22c55e', nav: 'CpDashboard' },
  { key: 'quote', label: 'Teklif Onay/Red', icon: 'checkmark-done', color: '#f59e0b', nav: 'CpQuoteApproval' },
  { key: 'wo', label: 'İş Emri Takip', icon: 'navigate', color: '#a855f7', nav: 'CpWorkOrderTracking' },
  { key: 'req', label: 'Servis Talebi', icon: 'add-circle', color: '#ef4444', nav: 'CpServiceRequest' },
  { key: 'doc', label: 'Belge Arşivi', icon: 'folder', color: '#06b6d4', nav: 'CpDocumentArchive' },
  { key: 'sat', label: 'Memnuniyet', icon: 'happy', color: '#8b5cf6', nav: 'CpSatisfaction' },
  { key: 'notif', label: 'Bildirimler', icon: 'notifications', color: '#f97316', nav: 'CpNotifications' },
  { key: 'brand', label: 'Marka Özelleştirme', icon: 'color-palette', color: '#ec4899', nav: 'CpBranding' },
  { key: 'sec', label: 'Paylaşım Güvenliği', icon: 'shield-checkmark', color: '#14b8a6', nav: 'CpShareLinkSecurity' },
];

export default function CpHubScreen() {
  const nav = useNavigation<any>();
  const { tileWidth, onGridLayout } = useMeasuredGrid({ gap: '2%', horizontalPadding: spacing.md });
  const tileStyle = { width: tileWidth };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.hero}>
          <Ionicons name="people-circle" size={100} color="#0ea5e9" />
          <Text style={s.heroT}>Müşteri Portalı 2.0</Text>
          <Text style={s.heroS}>Müşteri deneyimi, paylaşım ve profesyonel dış ekran</Text>
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
