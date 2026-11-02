// EmptyState.tsx — POZ-DEV-317 Standart boş durum bileşeni (modern)
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, brand } from '../theme';
import { a11yButton } from '../utils/a11y';
import FadeInView from './FadeInView';
import PressableScale from './PressableScale';

interface Props {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /** Alias for `subtitle` (some legacy screens use this name) */
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  iconColor?: string;
}

export default function EmptyState({
  icon = 'document-outline',
  title,
  subtitle,
  description,
  actionLabel,
  onAction,
  iconColor = colors.emerald.foreground,
}: Props) {
  const sub = subtitle ?? description;
  return (
    <FadeInView style={s.container}>
      <View style={s.iconWrap}>
        <Ionicons name={icon} size={22} color={iconColor} />
      </View>
      <Text style={s.title}>{title}</Text>
      {sub ? <Text style={s.subtitle}>{sub}</Text> : null}
      {actionLabel && onAction ? (
        <PressableScale style={s.button} onPress={onAction} {...a11yButton(actionLabel)}>
          <Ionicons name="add" size={18} color={brand.onAmber} />
          <Text style={s.buttonText}>{actionLabel.replace(/^\+\s*/, '')}</Text>
        </PressableScale>
      ) : null}
    </FadeInView>
  );
}

const s = StyleSheet.create({
  container: { padding: spacing.xxl, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.md },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.emerald.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text.primary,
    fontFamily: 'Outfit',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.text.muted,
    fontFamily: 'Inter',
    fontSize: 14,
    marginTop: spacing.xs,
    textAlign: 'center',
    maxWidth: 560,
    lineHeight: 22,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.sm,
    backgroundColor: brand.amber,
    maxWidth: '100%',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: { flexShrink: 1, color: brand.onAmber, fontFamily: 'Outfit', fontWeight: '600', fontSize: 14, lineHeight: 20 },
});
