// SearchFilterBar — POZ-DEV-097 reusable advanced search + filter chips
import React from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, brand } from '../theme';
import { a11yButton, a11yInput, HIT_SLOP_8 } from '../utils/a11y';

export interface FilterChip {
  key: string;
  label: string;
  count?: number;
}

interface Props {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  chips?: FilterChip[];
  activeKey?: string;
  onChipPress?: (key: string) => void;
}

export default function SearchFilterBar({ value, onChange, placeholder = 'Ara…', chips, activeKey, onChipPress }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={16} color={colors.text.faint} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.text.faint}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="never"
          {...a11yInput(placeholder, value)}
        />
        {value.length > 0 && (
          <TouchableOpacity onPress={() => onChange('')} hitSlop={HIT_SLOP_8} {...a11yButton('Aramayı temizle')}>
            <Ionicons name="close-circle" size={16} color={colors.text.faint} />
          </TouchableOpacity>
        )}
      </View>
      {chips && chips.length > 0 && (
        <View style={styles.filters} accessibilityLabel="Kayıt filtreleri">
          {chips.map(c => {
            const active = c.key === activeKey;
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => onChipPress?.(c.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={typeof c.count === 'number' ? `${c.label}, ${c.count} kayıt` : c.label}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                {typeof c.count === 'number' && (
                  <View style={[styles.countPill, active && styles.countPillActive]}>
                    <Text style={[styles.countText, active && styles.countTextActive]}>{c.count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, gap: spacing.sm },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.primary, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  input: { flex: 1, minWidth: 0, color: colors.text.primary, fontFamily: 'Inter', fontSize: 14, lineHeight: 22, padding: 0 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, maxWidth: '100%', minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border.primary, backgroundColor: colors.bg.card },
  chipActive: { backgroundColor: brand.amber, borderColor: brand.amber },
  chipText: { flexShrink: 1, color: colors.text.secondary, fontFamily: 'Inter', fontSize: 13, lineHeight: 20, fontWeight: '600' },
  chipTextActive: { color: brand.onAmber },
  countPill: { backgroundColor: colors.bg.secondary, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, minWidth: 22, alignItems: 'center' },
  countPillActive: { backgroundColor: 'rgba(10,22,40,0.1)' },
  countText: { color: colors.text.muted, fontFamily: 'Inter', fontSize: 12, lineHeight: 18, fontWeight: '600' },
  countTextActive: { color: brand.onAmber },
});
