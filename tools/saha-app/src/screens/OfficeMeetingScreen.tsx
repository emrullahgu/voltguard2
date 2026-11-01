// OfficeMeetingScreen — toplantı notu detay/düzenleme (başlık, tarih, katılımcılar,
// not, aksiyon maddeleri). Aksiyon maddeleri tamamlandı olarak işaretlenebilir.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, radius, typography, brand } from '../theme';
import { RootStackParamList, OfficeMeeting, OfficeActionItem } from '../types';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../context/AppContext';
import { getMeeting, saveMeeting, deleteMeeting, newActionItem } from '../services/officeWorkspace';
import { notifyUsers } from '../services/notifications';
import { localDateISO } from '../utils/date';
import ErrorState from '../components/ErrorState';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'OfficeMeeting'>;

export default function OfficeMeetingScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const meetingId = route.params?.meetingId;
  const { user, profile } = useAuth();
  const { showToast } = useAppContext();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('Toplantı');
  const [date, setDate] = useState(localDateISO());
  const [time, setTime] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [attInput, setAttInput] = useState('');
  const [notes, setNotes] = useState('');
  const [actions, setActions] = useState<OfficeActionItem[]>([]);
  const [actInput, setActInput] = useState('');
  const serverRevision = useRef<number | undefined>(undefined);
  const origOwners = useRef<Record<string, string>>({}); // id → owner (kayıt anındaki) — yeni atamada bildirim
  const alive = useRef(true);
  const readRequest = useRef(0);
  const editSerial = useRef(0);
  const loadedId = useRef<string | undefined>(undefined);
  const currentMeetingId = useRef(meetingId);
  const savingRef = useRef(false);
  currentMeetingId.current = meetingId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; readRequest.current++; }; }, []);

  const load = useCallback(async () => {
    if (!alive.current) return;
    const request = ++readRequest.current, serial = editSerial.current;
    const isCurrent = () => alive.current && request === readRequest.current && currentMeetingId.current === meetingId;
    setLoadError('');
    if (loadedId.current !== meetingId) setLoading(true);
    try {
    if (meetingId) {
      const m = await getMeeting(meetingId);
      if (!isCurrent()) return;
      // A focused screen may be refreshed while a read is in flight. Keep all
      // fields and the original CAS revision when the user has begun editing.
      if (editSerial.current !== serial || serial > 0 && loadedId.current === meetingId) return;
      if (!m) throw new Error('Toplantı kaydı bulunamadı. Listeyi yenileyin.');
      {
        loadedId.current = m.id;
        editSerial.current = 0;
        serverRevision.current = m.serverRevision;
        setTitle(m.title); setDate(m.date); setTime(m.time ?? '');
        setAttendees(m.attendees); setNotes(m.notes); setActions(m.actionItems);
        origOwners.current = Object.fromEntries(m.actionItems.map(a => [a.id, a.owner ?? '']));
      }
    } else if (loadedId.current !== undefined) {
      loadedId.current = undefined; serverRevision.current = undefined; editSerial.current = 0; origOwners.current = {};
      setTitle('Toplantı'); setDate(localDateISO()); setTime(''); setAttendees([]); setAttInput(''); setNotes(''); setActions([]); setActInput('');
    }
    } catch (error: any) { if (isCurrent()) setLoadError(error?.message || 'Toplantı yüklenemedi.'); }
    finally { if (isCurrent()) setLoading(false); }
  }, [meetingId]);
  useFocusEffect(useCallback(() => { void load(); return () => { readRequest.current++; }; }, [load]));

  const editValue = (setValue: (value: string) => void, value: string) => {
    if (savingRef.current) return;
    editSerial.current++; setValue(value);
  };

  const addAttendee = () => {
    const v = attInput.trim();
    if (!v || savingRef.current) return;
    editSerial.current++;
    setAttendees(prev => Array.from(new Set([...prev, v])));
    setAttInput('');
  };
  const removeAttendee = (a: string) => { if (savingRef.current) return; editSerial.current++; setAttendees(prev => prev.filter(x => x !== a)); };

  const addAction = () => {
    const v = actInput.trim();
    if (!v || savingRef.current) return;
    editSerial.current++;
    setActions(prev => [...prev, newActionItem(v)]);
    setActInput('');
  };
  const toggleAction = (id: string) => { if (savingRef.current) return; editSerial.current++; setActions(prev => prev.map(a => a.id === id ? { ...a, done: !a.done } : a)); };
  const setActionOwner = (id: string, owner: string) => { if (savingRef.current) return; editSerial.current++; setActions(prev => prev.map(a => a.id === id ? { ...a, owner } : a)); };
  const removeAction = (id: string) => { if (savingRef.current) return; editSerial.current++; setActions(prev => prev.filter(a => a.id !== id)); };

  const save = async () => {
    if (savingRef.current || loading || meetingId && loadedId.current !== meetingId) return;
    savingRef.current = true; setSaving(true);
    try {
      const saved = await saveMeeting({
        id: meetingId,
        serverRevision: serverRevision.current,
        title: title.trim() || 'Toplantı',
        date, time: time.trim() || undefined,
        attendees, notes, actionItems: actions,
        createdBy: user?.id, createdByName: profile?.full_name ?? undefined,
      });
      if (!alive.current || currentMeetingId.current !== meetingId) return;
      serverRevision.current = saved.serverRevision;
      // Yeni/değişen sorumlulara aksiyon bildirimi gönder (aynı sorumluya tekrar gönderme).
      const notified = new Set<string>();
      for (const a of actions) {
        const owner = (a.owner ?? '').trim();
        if (owner && origOwners.current[a.id] !== owner && !notified.has(owner)) {
          notified.add(owner);
          notifyUsers({ userNames: [owner] }, 'task_assigned', 'Size aksiyon atandı', `${saved.title}: ${a.text}`, saved.id).catch(() => {});
        }
      }
      showToast('Toplantı kaydedildi');
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Kaydedilemedi', e?.message || 'Hata');
    } finally { savingRef.current = false; if (alive.current && currentMeetingId.current === meetingId) setSaving(false); }
  };

  const onDelete = () => {
    if (!meetingId) { nav.goBack(); return; }
    Alert.alert('Toplantıyı sil', 'Bu toplantı notu silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => { try { await deleteMeeting(meetingId, serverRevision.current); nav.goBack(); } catch (e: any) { Alert.alert('Silinemedi', e?.message || 'Hata'); } } },
    ]);
  };

  if (loadError && meetingId && loadedId.current !== meetingId) return <SafeAreaView style={s.safe} edges={['bottom']}><ErrorState title="Toplantı yüklenemedi" message={loadError} onRetry={() => { void load(); }} /></SafeAreaView>;
  if (loading || meetingId && loadedId.current !== meetingId) {
    return <SafeAreaView style={s.safe} edges={['bottom']}><View style={s.center}><ActivityIndicator color={brand.green} /></View></SafeAreaView>;
  }

  const openCount = actions.filter(a => !a.done).length;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {!!loadError && <View><Text accessibilityRole="alert" style={{ color: colors.rose.foreground }}>{loadError} Taslağınız korunuyor.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Toplantı bağlantısını yeniden kontrol et" onPress={() => { void load(); }}><Text style={{ color: colors.indigo.foreground }}>Yeniden kontrol et</Text></TouchableOpacity></View>}
          <TextInput style={s.titleInput} value={title} onChangeText={value => editValue(setTitle, value)} placeholder="Toplantı başlığı" placeholderTextColor={colors.text.faint} multiline />

          <View style={s.dateRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Tarih (YYYY-AA-GG)</Text>
              <TextInput style={s.input} value={date} onChangeText={value => editValue(setDate, value)} placeholder="2026-07-01" placeholderTextColor={colors.text.faint} />
            </View>
            <View style={{ width: 110 }}>
              <Text style={s.label}>Saat</Text>
              <TextInput style={s.input} value={time} onChangeText={value => editValue(setTime, value)} placeholder="14:30" placeholderTextColor={colors.text.faint} />
            </View>
          </View>

          <Text style={s.label}>Katılımcılar</Text>
          <View style={s.chipRow}>
            {attendees.map(a => (
              <TouchableOpacity key={a} style={s.chip} onPress={() => removeAttendee(a)}>
                <Text style={s.chipText}>{a}</Text>
                <Ionicons name="close" size={13} color={colors.text.muted} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.addRow}>
            <TextInput style={[s.input, { flex: 1 }]} value={attInput} onChangeText={value => editValue(setAttInput, value)} placeholder="İsim ekle" placeholderTextColor={colors.text.faint} onSubmitEditing={addAttendee} returnKeyType="done" />
            <TouchableOpacity style={s.addMini} onPress={addAttendee}><Ionicons name="add" size={20} color="#fff" /></TouchableOpacity>
          </View>

          <Text style={s.label}>Notlar</Text>
          <TextInput style={[s.input, s.textarea]} value={notes} onChangeText={value => editValue(setNotes, value)} placeholder="Gündem, kararlar, notlar…" placeholderTextColor={colors.text.faint} multiline />

          <View style={s.actHeader}>
            <Text style={s.label}>Aksiyon Maddeleri</Text>
            {openCount > 0 && <Text style={s.openTag}>{openCount} açık</Text>}
          </View>
          {actions.map(a => (
            <View key={a.id} style={s.actItem}>
              <TouchableOpacity onPress={() => toggleAction(a.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name={a.done ? 'checkbox' : 'square-outline'} size={20} color={a.done ? brand.green : colors.text.muted} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={[s.actText, a.done && s.actDone]}>{a.text}</Text>
                <TextInput style={s.ownerInput} value={a.owner} onChangeText={t => setActionOwner(a.id, t)} placeholder="Sorumlu (opsiyonel)" placeholderTextColor={colors.text.faint} />
              </View>
              <TouchableOpacity onPress={() => removeAction(a.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="trash-outline" size={16} color={colors.rose.default} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={s.addRow}>
            <TextInput style={[s.input, { flex: 1 }]} value={actInput} onChangeText={value => editValue(setActInput, value)} placeholder="Aksiyon ekle" placeholderTextColor={colors.text.faint} onSubmitEditing={addAction} returnKeyType="done" />
            <TouchableOpacity style={s.addMini} onPress={addAction}><Ionicons name="add" size={20} color="#fff" /></TouchableOpacity>
          </View>

          <TouchableOpacity style={s.saveBtn} onPress={save} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark" size={20} color="#fff" /><Text style={s.saveText}>Kaydet</Text></>}
          </TouchableOpacity>
          <TouchableOpacity style={s.deleteBtn} onPress={onDelete} activeOpacity={0.85}>
            <Text style={s.deleteText}>{meetingId ? 'Sil' : 'Vazgeç'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: 120 },
  titleInput: { color: colors.text.primary, fontSize: 24, fontWeight: '800', padding: 0, marginBottom: spacing.md, lineHeight: 30 },
  dateRow: { flexDirection: 'row', gap: spacing.md },
  label: { color: colors.text.muted, fontSize: typography.xs, fontWeight: '700', marginTop: spacing.md, marginBottom: 6 },
  input: { backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text.primary, fontSize: typography.base },
  textarea: { minHeight: 120, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.bg.secondary, borderWidth: 1, borderColor: colors.border.primary },
  chipText: { color: colors.text.primary, fontSize: typography.sm, fontWeight: '600' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  addMini: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: brand.green, alignItems: 'center', justifyContent: 'center' },
  actHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  openTag: { color: colors.rose.default, fontSize: typography.xs, fontWeight: '800', marginTop: spacing.md },
  actItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.primary },
  actText: { color: colors.text.primary, fontSize: typography.base, fontWeight: '600', paddingTop: 1 },
  actDone: { textDecorationLine: 'line-through', color: colors.text.faint },
  ownerInput: { color: colors.text.muted, fontSize: typography.sm, padding: 0, marginTop: 2 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: brand.green, paddingVertical: 14, borderRadius: radius.md, marginTop: spacing.xl },
  saveText: { color: '#fff', fontWeight: '800', fontSize: typography.md },
  deleteBtn: { alignItems: 'center', paddingVertical: 12, marginTop: spacing.sm },
  deleteText: { color: colors.rose.default, fontWeight: '700', fontSize: typography.base },
});
