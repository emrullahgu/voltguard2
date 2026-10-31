import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, typography } from '../theme';

type Status = 'Onay Bekliyor' | 'Teklif Gönderildi' | 'Faturalandırıldı' | 'Gecikti' | 'Tamamlandı';

interface StatusBadgeProps {
  status: Status | string;
  small?: boolean;
}

const statusConfig: Record<string, { bg: string; color: string }> = {
  'Faturalandırıldı': { bg: colors.emerald.bg, color: colors.emerald.foreground },
  'Tamamlandı': { bg: colors.emerald.bg, color: colors.emerald.foreground },
  'Onay Bekliyor': { bg: colors.amber.bg, color: colors.amber.foreground },
  'Teklif Gönderildi': { bg: colors.blue.bg, color: colors.blue.foreground },
  'Gecikti': { bg: colors.rose.bg, color: colors.rose.foreground },
};

export default function StatusBadge({ status, small = false }: StatusBadgeProps) {
  const config = statusConfig[status] ?? { bg: colors.border.primary, color: colors.text.muted };
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text
        style={[
          styles.text,
          { color: config.color, fontSize: small ? Math.max(12, typography.xs - 1) : typography.xs },
        ]}
      >
        {status.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
