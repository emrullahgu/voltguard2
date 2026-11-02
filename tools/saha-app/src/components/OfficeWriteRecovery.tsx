import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';

type Props = {
  checking: boolean;
  current: { title: string; summary: string } | null;
  onCheck: () => void;
  onOpen: () => void;
  onApply: () => void;
};

export default function OfficeWriteRecovery({ checking, current, onCheck, onOpen, onApply }: Props) {
  return <View style={styles.panel} accessibilityRole="alert">
    <Text style={styles.message}>Kayıt doğrulanamadı. Taslak bu ekranda duruyor. Yeniden göndermeden önce güncel kaydı kontrol edin.</Text>
    <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={onCheck} disabled={checking}>
      <Text style={styles.buttonText}>{checking ? 'Güncel kayıt yükleniyor…' : 'Güncel kaydı kontrol et'}</Text>
    </TouchableOpacity>
    {current && <>
      <Text style={styles.title}>Sunucudaki kayıt: {current.title || 'Adsız'}</Text>
      <Text selectable style={styles.summary}>{current.summary || 'İçerik boş.'}</Text>
      <Text style={styles.message}>Mevcut taslağınız yukarıdaki kayıtla değiştirilmedi. Güncel kaydı açabilir veya taslağınızı bu kaydın üzerine kaydetmeyi seçebilirsiniz.</Text>
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={onOpen} disabled={checking}><Text style={styles.buttonText}>Güncel kaydı aç</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={onApply} disabled={checking}><Text style={styles.buttonText}>Taslağı güncel kaydın üzerine kaydet</Text></TouchableOpacity>
      </View>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: spacing.md, gap: 10, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.rose.default, borderRadius: radius.sm },
  message: { color: colors.text.primary, fontSize: 14, lineHeight: 21 },
  title: { color: colors.text.primary, fontWeight: '700', fontSize: 15 },
  summary: { color: colors.text.secondary, fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.sm },
  buttonText: { color: colors.text.primary, fontWeight: '600', fontSize: 13 },
});
