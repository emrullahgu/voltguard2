// ErrorState.tsx — POZ-DEV-318 Standart hata durumu bileşeni
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, brand } from '../theme';
import { a11yButton } from '../utils/a11y';

interface Props {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export default function ErrorState({
  title = 'Bir sorun oluştu',
  message,
  onRetry,
  retryLabel = 'Tekrar Dene',
}: Props) {
  return (
    <View style={s.container} accessibilityRole="alert">
      <View style={s.iconWrap}><Ionicons name="alert-circle-outline" size={22} color={colors.emerald.foreground} /></View>
      <Text style={s.title}>{title}</Text>
      {message ? <Text style={s.message}>{message}</Text> : null}
      {onRetry ? (
        <Pressable style={s.button} onPress={onRetry} {...a11yButton(retryLabel)}>
          <Ionicons name="refresh" size={16} color={brand.onAmber} />
          <Text style={s.buttonText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: spacing.xxl, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.md },
  iconWrap: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: colors.emerald.bg, alignItems: 'center', justifyContent: 'center' },
  title: {
    color: colors.text.primary,
    fontFamily: 'Outfit',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  message: {
    color: colors.text.muted,
    fontFamily: 'Inter',
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.xs,
    textAlign: 'center',
    maxWidth: 560,
  },
  button: {
    marginTop: spacing.lg,
    backgroundColor: brand.amber,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    maxWidth: '100%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  buttonText: { flexShrink: 1, color: brand.onAmber, fontFamily: 'Outfit', fontWeight: '600', fontSize: 14, lineHeight: 20 },
});
