import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '../theme';
import { onPortalReset } from '../portal/api';
import {
  CONNECTED_AI_PROVIDERS, getConnectedAiStatus, sendConnectedAi,
  type ConnectedAiProvider, type ConnectedAiReply, type ConnectedAiStatus,
} from '../services/connectedAi';

const labels: Record<ConnectedAiProvider, string> = {
  gemini: 'Google Gemini', groq: 'Groq', openrouter: 'OpenRouter', cloudflare: 'Cloudflare Workers AI',
};

export default function ConnectedAiScreen() {
  const [provider, setProvider] = useState<ConnectedAiProvider>('gemini');
  const [status, setStatus] = useState<ConnectedAiStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState<ConnectedAiReply | null>(null);
  const alive = useRef(true);
  const statusRequest = useRef(0);
  const sendRequest = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async () => {
    const request = ++statusRequest.current;
    setLoading(true); setStatusError('');
    try {
      const next = await getConnectedAiStatus();
      if (alive.current && request === statusRequest.current) setStatus(next);
    } catch (e: any) {
      if (alive.current && request === statusRequest.current) { setStatus(null); setStatusError(e?.message || 'Bağlantı durumu alınamadı.'); }
    } finally {
      if (alive.current && request === statusRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const off = onPortalReset(() => {
      ++statusRequest.current; ++sendRequest.current; busy.current = false;
      if (alive.current) {
        setPrompt(''); setReply(null); setStatus(null); setError('');
        setStatusError('Çalışan oturumu değişti. Ekranı yeniden açın.'); setPending(false); setLoading(false);
      }
    });
    void load();
    return () => { alive.current = false; ++statusRequest.current; ++sendRequest.current; off(); };
  }, [load]);

  const selected = status?.[provider];
  const send = async () => {
    if (busy.current || !selected?.configured || !prompt.trim()) return;
    if ([...prompt].length > 12000) { setError('İleti en fazla 12.000 karakter olabilir.'); return; }
    const submitted = prompt;
    const request = ++sendRequest.current;
    busy.current = true; setPending(true); setError('');
    try {
      const next = await sendConnectedAi(provider, submitted);
      if (alive.current && request === sendRequest.current) {
        setReply(next);
        setPrompt(current => current === submitted ? '' : current);
      }
    } catch (e: any) {
      if (alive.current && request === sendRequest.current) setError(e?.message || 'İleti gönderilemedi. Taslağınız korundu.');
    } finally {
      if (alive.current && request === sendRequest.current) { busy.current = false; setPending(false); }
    }
  };

  return <SafeAreaView style={styles.root} edges={['bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Teknik yapay zekâ yardımcısı</Text>
      <Text style={styles.body}>Teknik sorularınızı açıklatın, metin taslağı veya özet hazırlatın. Yanıtları uygulamadan önce doğrulayın.</Text>
      <View style={styles.card}>
        <Text style={styles.heading}>Sağlayıcı seçin</Text>
        {CONNECTED_AI_PROVIDERS.map(item => <TouchableOpacity key={item} accessibilityRole="radio" accessibilityState={{ checked: provider === item, disabled: pending }} disabled={pending}
          accessibilityLabel={labels[item]} onPress={() => { setProvider(item); setError(''); }} style={[styles.provider, provider === item && styles.selected]}>
          <Text style={styles.heading}>{provider === item ? '● ' : '○ '}{labels[item]}</Text>
          <Text style={styles.small}>{status ? (status[item].configured ? 'Sunucu ayarı mevcut' : 'Sunucu ayarı gerekiyor') : 'Durum bekleniyor'}</Text>
        </TouchableOpacity>)}
        {loading && <ActivityIndicator accessibilityLabel="Bağlantı durumu yükleniyor" color={colors.indigo.default} />}
        {!!statusError && <Text style={styles.error} accessibilityRole="alert">{statusError}</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Bağlantı durumunu yenile" disabled={loading || pending} onPress={() => { void load(); }} style={styles.secondaryButton}>
          <Text style={styles.link}>Bağlantı durumunu yenile</Text>
        </TouchableOpacity>
        {selected && <View style={styles.notice}>
          <Text style={styles.heading}>Model: {selected.model}</Text>
          <Text style={styles.body}>{selected.notice}</Text>
          <TouchableOpacity accessibilityRole="link" accessibilityLabel="Sağlayıcının veri kullanımı koşulları" onPress={() => { void Linking.openURL(selected.privacyUrl).catch(() => setError('Sağlayıcının koşulları açılamadı.')); }}>
            <Text style={styles.link}>Veri kullanımı koşulları</Text>
          </TouchableOpacity>
          <Text style={styles.small}>Ücretsiz kullanım ve kota hesabınıza bağlıdır. Sunucu ayarı, sağlayıcı erişiminin doğrulandığı anlamına gelmez.</Text>
        </View>}
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>İletiniz</Text>
        <Text style={styles.small}>Yalnızca buraya yazdığınız metin seçtiğiniz sağlayıcıya gönderilir. Önceki yanıtlar otomatik eklenmez. Müşteri bilgisi, şifre veya API anahtarı yazmayın.</Text>
        <TextInput accessibilityLabel="Yapay zekâ iletisi" value={prompt} onChangeText={setPrompt} multiline placeholder="Örneğin: Güneş panelinde eğim ve yönün üretime etkisini açıkla." placeholderTextColor={colors.text.muted} style={styles.input} textAlignVertical="top" />
        <Text style={styles.small}>{[...prompt].length.toLocaleString('tr-TR')} / 12.000 karakter</Text>
        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Seçili sağlayıcıya gönder" accessibilityState={{ disabled: pending || !selected?.configured || !prompt.trim() }}
          disabled={pending || !selected?.configured || !prompt.trim()} onPress={() => { void send(); }} style={[styles.button, (pending || !selected?.configured || !prompt.trim()) && styles.disabled]}>
          {pending ? <ActivityIndicator color={colors.bg.primary} /> : <Text style={styles.buttonText}>Seçili sağlayıcıya gönder</Text>}
        </TouchableOpacity>
        {pending && <Text style={styles.small}>Yanıt bekleniyor. İleti otomatik yeniden gönderilmez.</Text>}
      </View>
      {reply && <View style={styles.card}>
        <Text style={styles.heading}>Son yanıt · {labels[reply.provider]}</Text>
        <Text style={styles.small}>{reply.model} · {new Date(reply.generatedAt).toLocaleString('tr-TR')}</Text>
        <Text selectable style={styles.response}>{reply.text}</Text>
        {reply.truncated && <Text style={styles.error}>Yanıt uzunluk sınırında kesildi.</Text>}
        {reply.usage.totalTokens !== null && <Text style={styles.small}>Sağlayıcının bildirdiği kullanım: {reply.usage.totalTokens} token</Text>}
      </View>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  title: { fontSize: typography.xl, fontWeight: '700', color: colors.text.primary },
  body: { fontSize: typography.sm, lineHeight: 21, color: colors.text.secondary },
  small: { fontSize: typography.xs, lineHeight: 19, color: colors.text.muted },
  heading: { fontSize: typography.sm, fontWeight: '600', color: colors.text.primary },
  card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.bg.card, borderColor: colors.border.primary, borderWidth: 1, borderRadius: radius.md },
  provider: { padding: spacing.sm, gap: 3, borderColor: colors.border.primary, borderWidth: 1, borderRadius: radius.sm },
  selected: { borderColor: colors.indigo.default, backgroundColor: colors.bg.secondary },
  notice: { gap: spacing.sm, paddingTop: spacing.sm },
  input: { minHeight: 150, padding: spacing.md, color: colors.text.primary, backgroundColor: colors.bg.primary, fontSize: typography.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border.primary },
  button: { padding: spacing.md, alignItems: 'center', backgroundColor: colors.indigo.default, borderRadius: radius.sm },
  buttonText: { color: '#ffffff', fontSize: typography.sm, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  secondaryButton: { paddingVertical: spacing.sm },
  link: { color: colors.indigo.foreground, fontSize: typography.sm, textDecorationLine: 'underline' },
  error: { color: colors.rose.foreground, fontSize: typography.sm, lineHeight: 21 },
  response: { color: colors.text.primary, fontSize: typography.sm, lineHeight: 23 },
});
