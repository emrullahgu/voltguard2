// OfficeMeetingsScreen — toplantı notları listesi (Ofis Takip).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography, brand } from '../theme';
import { RootStackParamList, OfficeMeeting } from '../types';
import { listMeetings, subscribeOffice } from '../services/officeWorkspace';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function OfficeMeetingsScreen() {
  const nav = useNavigation<Nav>();
  const [meetings, setMeetings] = useState<OfficeMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const alive = useRef(true), readRequest = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; readRequest.current++; }; }, []);

  const refresh = useCallback(async () => {
    if (!alive.current) return;
    const request = ++readRequest.current, isCurrent = () => alive.current && readRequest.current === request;
    setLoading(true); setLoadError('');
    try { const rows = await listMeetings(); if (isCurrent()) { setMeetings(rows); setLoaded(true); } }
    catch (error: any) { if (isCurrent()) setLoadError(error?.message || 'Toplantı listesi yüklenemedi.'); }
    finally { if (isCurrent()) setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  useEffect(() => subscribeOffice('office_meetings', refresh), [refresh]);

  if (loadError && !loaded) return <SafeAreaView style={s.safe} edges={['bottom']}><ErrorState title="Toplantılar yüklenemedi" message={loadError} onRetry={() => { void refresh(); }} /></SafeAreaView>;
  if (loading && !loaded) {
    return <SafeAreaView style={s.safe} edges={['bottom']}><View style={s.center}><ActivityIndicator color={brand.green} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {!!loadError && <ErrorState title="Toplantılar yenilenemedi" message={loadError + ' Son doğrulanmış görünüm korunuyor.'} onRetry={() => { void refresh(); }} />}
        {meetings.length === 0 ? (
          !loadError && <EmptyState icon="people-outline" title="Toplantı notu yok" description="İlk toplantı notunuzu oluşturun — katılımcılar, gündem, aksiyon maddeleri." />
        ) : meetings.map(m => {
          const open = m.actionItems.filter(a => !a.done).length;
          return (
            <TouchableOpacity key={m.id} style={s.card} onPress={() => nav.navigate('OfficeMeeting', { meetingId: m.id })} activeOpacity={0.85}>
              <View style={s.dateBox}>
                <Text style={s.dateText}>{m.date.slice(8, 10)}</Text>
                <Text style={s.monthText}>{monthShort(m.date)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{m.title}</Text>
                <Text style={s.cardMeta}>
                  {m.attendees.length} katılımcı{m.time ? ` · ${m.time}` : ''}
                  {open > 0 ? ` · ${open} açık aksiyon` : ''}
                </Text>
              </View>
              {open > 0 && <View style={s.badge}><Text style={s.badgeText}>{open}</Text></View>}
              <Ionicons name="chevron-forward" size={18} color={colors.text.faint} />
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity style={s.newBtn} onPress={() => nav.navigate('OfficeMeeting', {})} activeOpacity={0.85}>
          <Ionicons name="add-circle" size={20} color="#fff" />
          <Text style={s.newBtnText}>Yeni Toplantı</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
function monthShort(iso: string): string {
  const m = parseInt(iso.slice(5, 7), 10);
  return MONTHS[m - 1] ?? '';
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: 90, gap: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.md },
  dateBox: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: colors.indigo.bg, alignItems: 'center', justifyContent: 'center' },
  dateText: { color: colors.indigo.default, fontSize: typography.lg, fontWeight: '800' },
  monthText: { color: colors.indigo.default, fontSize: 10, fontWeight: '700' },
  cardTitle: { color: colors.text.primary, fontSize: typography.md, fontWeight: '700' },
  cardMeta: { color: colors.text.muted, fontSize: typography.xs, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.rose.default, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: typography.xs, fontWeight: '800' },
  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: brand.green, paddingVertical: 14, borderRadius: radius.md, marginTop: spacing.md },
  newBtnText: { color: '#fff', fontWeight: '800', fontSize: typography.md },
});
