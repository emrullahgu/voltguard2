import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { onPortalReset } from '../portal/api';
import { colors, radius, spacing, typography } from '../theme';
import {
  CONNECTED_DATA_SERVICES, connectedDataParams, getConnectedDataStatus, requestConnectedData,
  type ConnectedDataResult, type ConnectedDataService, type ConnectedDataStatus,
} from '../services/connectedData';

const labels: Record<ConnectedDataService, string> = {
  epias: 'EPİAŞ · saatlik PTF', ipinfo: 'IPinfo · IP konumu', github: 'GitHub · depo bilgisi',
  unsplash: 'Unsplash · görsel arama', tmdb: 'TMDB · film arama', newsapi: 'NewsAPI · haber arama',
  jsonplaceholder: 'JSONPlaceholder · sentetik kayıtlar', dummyjson: 'DummyJSON · sentetik ürünler',
};
const fieldsByService: Record<ConnectedDataService, { key: string; label: string; placeholder: string }[]> = {
  epias: [{ key: 'date', label: 'Tarih', placeholder: 'YYYY-AA-GG' }],
  ipinfo: [{ key: 'ip', label: 'Genel IP adresi', placeholder: 'Sorgulamak istediğiniz IP adresi' }],
  github: [{ key: 'owner', label: 'Depo sahibi', placeholder: 'public-apis' }, { key: 'repo', label: 'Depo adı', placeholder: 'public-apis' }],
  unsplash: [{ key: 'q', label: 'Görsel arama sözcüğü', placeholder: 'solar panels' }],
  tmdb: [{ key: 'q', label: 'Film arama sözcüğü', placeholder: 'Film adı' }],
  newsapi: [{ key: 'q', label: 'Haber arama sözcüğü', placeholder: 'güneş enerjisi' }],
  jsonplaceholder: [{ key: 'limit', label: 'Örnek kayıt sayısı', placeholder: '5–20' }],
  dummyjson: [{ key: 'limit', label: 'Örnek kayıt sayısı', placeholder: '5–20' }],
};
function initialFields(): Record<string, string> {
  const date = new Date();
  return { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, ip: '', owner: 'public-apis', repo: 'public-apis', q: '', limit: '5' };
}

export default function ConnectedDataScreen() {
  const { profile } = useAuth();
  const [service, setService] = useState<ConnectedDataService>('epias');
  const [status, setStatus] = useState<ConnectedDataStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [fields, setFields] = useState(initialFields);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ service: ConnectedDataService; params: Record<string, string>; data: ConnectedDataResult } | null>(null);
  const alive = useRef(true), statusRequest = useRef(0), dataRequest = useRef(0), busy = useRef(false);
  const load = useCallback(async () => {
    const id = ++statusRequest.current; setLoading(true); setStatusError('');
    try { const next = await getConnectedDataStatus(); if (alive.current && id === statusRequest.current) setStatus(next); }
    catch (e: any) { if (alive.current && id === statusRequest.current) { setStatus(null); setStatusError(e?.message || 'Bağlantı durumu alınamadı.'); } }
    finally { if (alive.current && id === statusRequest.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    const off = onPortalReset(() => {
      ++statusRequest.current; ++dataRequest.current; busy.current = false;
      if (alive.current) { setFields(initialFields()); setResult(null); setStatus(null); setError(''); setPending(false); setLoading(false); setStatusError('Çalışan oturumu değişti. Ekranı yeniden açın.'); }
    });
    void load();
    return () => { alive.current = false; ++statusRequest.current; ++dataRequest.current; off(); };
  }, [load]);
  const selected = status?.[service];
  const authorized = service === 'epias' || profile?.role === 'admin';
  const enabled = !!selected?.available && authorized;
  const run = async () => {
    if (busy.current || !enabled) return;
    let params: Record<string, string>;
    try { params = connectedDataParams(service, fields); } catch (e: any) { setError(e?.message || 'Sorgu alanlarını kontrol edin.'); return; }
    const id = ++dataRequest.current; busy.current = true; setPending(true); setError('');
    try {
      const data = await requestConnectedData(service, params);
      if (alive.current && id === dataRequest.current) setResult({ service, params, data });
    } catch (e: any) { if (alive.current && id === dataRequest.current) setError(e?.message || 'Veri alınamadı.'); }
    finally { if (alive.current && id === dataRequest.current) { busy.current = false; setPending(false); } }
  };
  return <SafeAreaView style={styles.root} edges={['bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Veri servisleri laboratuvarı</Text>
      <Text style={styles.body}>Enerji piyasası verilerini ve geliştirme amaçlı veri kaynaklarını sorgulayın. Her sorgu yalnızca seçtiğiniz kaynağa gönderilir.</Text>
      <View style={styles.card}>
        <Text style={styles.heading}>Veri kaynağı</Text>
        {CONNECTED_DATA_SERVICES.map(item => <TouchableOpacity key={item} accessibilityRole="radio" accessibilityLabel={labels[item]} accessibilityState={{ checked: service === item, disabled: pending }} disabled={pending}
          onPress={() => { setService(item); setError(''); }} style={[styles.choice, service === item && styles.selected]}>
          <Text style={styles.heading}>{service === item ? '● ' : '○ '}{labels[item]}</Text>
          <Text style={styles.small}>{status ? (!status[item].configured ? 'Sunucu ayarı gerekiyor' : status[item].available ? 'Sorgu yapılabilir' : 'Kullanıma kapalı') : 'Durum bekleniyor'}</Text>
        </TouchableOpacity>)}
        {loading && <ActivityIndicator accessibilityLabel="Veri servislerinin durumu yükleniyor" color={colors.indigo.default} />}
        {!!statusError && <Text accessibilityRole="alert" style={styles.error}>{statusError}</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Veri servislerinin durumunu yenile" disabled={loading || pending} onPress={() => { void load(); }} style={styles.secondaryButton}><Text style={styles.link}>Bağlantı durumunu yenile</Text></TouchableOpacity>
        {selected && <Text style={styles.body}>{selected.notice}</Text>}
        {service !== 'epias' && <Text style={styles.small}>Bu laboratuvar sorgusu yönetici hesabı gerektirir.</Text>}
        {service === 'ipinfo' && <Text style={styles.small}>Yalnızca yazdığınız genel IP adresi sorgulanır. Konum yaklaşık olabilir.</Text>}
        {(service === 'jsonplaceholder' || service === 'dummyjson') && <Text style={styles.body}>Bu kaynak sentetik örnek veri döndürür. Sonuçlar şirket kaydı olarak kaydedilmez.</Text>}
      </View>
      {(service === 'tmdb' || result?.service === 'tmdb') && <View style={styles.card}>
        <Text style={styles.heading}>Hakkında ve kaynakça · TMDB</Text>
        <TouchableOpacity accessibilityRole="link" accessibilityLabel="TMDB resmi sitesini aç" style={styles.logoLink}
          onPress={() => { void Linking.openURL('https://www.themoviedb.org').catch(() => setError('TMDB bağlantısı açılamadı.')); }}>
          <Image source={{ uri: '/assets/tmdb-logo.svg' }} accessibilityLabel="TMDB logosu" resizeMode="contain" style={styles.tmdbLogo} />
        </TouchableOpacity>
        <Text style={styles.body}>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text>
        <TouchableOpacity accessibilityRole="link" accessibilityLabel="The Movie Database veri kaynağı"
          onPress={() => { void Linking.openURL('https://www.themoviedb.org').catch(() => setError('TMDB bağlantısı açılamadı.')); }}>
          <Text style={styles.link}>The Movie Database (TMDB)</Text>
        </TouchableOpacity>
        <Text style={styles.small}>{status?.tmdb.notice || 'TMDB kullanımı bağlantı ayarına ve ticari lisans koşullarına bağlıdır.'}</Text>
      </View>}
      <View style={styles.card}>
        <Text style={styles.heading}>{labels[service]}</Text>
        {fieldsByService[service].map(field => <View key={field.key} style={styles.field}>
          <Text style={styles.small}>{field.label}</Text>
          <TextInput accessibilityLabel={field.label} value={fields[field.key]} onChangeText={value => setFields(current => ({ ...current, [field.key]: value }))}
            placeholder={field.placeholder} placeholderTextColor={colors.text.muted} autoCapitalize="none" style={styles.input} />
        </View>)}
        {!authorized && <Text accessibilityRole="alert" style={styles.error}>Bu sorgu için yönetici yetkisi gerekiyor.</Text>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Seçili veri kaynağını sorgula" disabled={pending || !enabled} accessibilityState={{ disabled: pending || !enabled }} onPress={() => { void run(); }} style={[styles.button, (pending || !enabled) && styles.disabled]}>
          {pending ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Sorgula</Text>}
        </TouchableOpacity>
      </View>
      {result && <View style={styles.card}>
        <Text style={styles.heading}>Son sorgu · {labels[result.service]}</Text>
        <Text style={styles.small}>{Object.entries(result.params).map(([key, value]) => `${key}: ${value}`).join(' · ')}</Text>
        <Text style={styles.small}>Alınma zamanı: {new Date(result.data.retrievedAt).toLocaleString('tr-TR')}</Text>
        <TouchableOpacity accessibilityRole="link" accessibilityLabel="Veri kaynağını aç" onPress={() => { void Linking.openURL(result.data.source.url).catch(() => setError('Kaynak bağlantısı açılamadı.')); }}><Text style={styles.link}>{result.data.source.name}</Text></TouchableOpacity>
        <Text selectable style={styles.result}>{JSON.stringify(result.data, null, 2)}</Text>
      </View>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  title: { color: colors.text.primary, fontSize: typography.xl, fontWeight: '700' },
  heading: { color: colors.text.primary, fontSize: typography.sm, fontWeight: '600' },
  body: { color: colors.text.secondary, fontSize: typography.sm, lineHeight: 21 },
  small: { color: colors.text.muted, fontSize: typography.xs, lineHeight: 19 },
  card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.md },
  choice: { padding: spacing.sm, gap: 3, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.sm },
  selected: { backgroundColor: colors.bg.secondary, borderColor: colors.indigo.default },
  field: { gap: spacing.xs },
  input: { padding: spacing.md, color: colors.text.primary, fontSize: typography.sm, backgroundColor: colors.bg.primary, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.sm },
  secondaryButton: { paddingVertical: spacing.sm },
  link: { color: colors.indigo.foreground, fontSize: typography.sm, textDecorationLine: 'underline' },
  error: { color: colors.rose.foreground, fontSize: typography.sm, lineHeight: 21 },
  button: { padding: spacing.md, alignItems: 'center', backgroundColor: colors.indigo.default, borderRadius: radius.sm },
  buttonText: { color: '#ffffff', fontSize: typography.sm, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  result: { color: colors.text.primary, fontSize: typography.xs, lineHeight: 20 },
  logoLink: { alignSelf: 'flex-start', padding: spacing.sm, backgroundColor: '#0a1628', borderRadius: radius.sm },
  tmdbLogo: { width: 112, height: 112 * 35.52 / 273.42 },
});
