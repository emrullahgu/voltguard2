import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme';

export default function AppUpdateScreen() {
  return <View style={styles.page}><Text style={styles.title}>Web uygulaması güncellemeleri</Text><Text style={styles.text}>Çalışan modülleri VoltGuard web sitesiyle birlikte güncellenir. Ayrıca uygulama indirmeniz veya kurmanız gerekmez.</Text><Text style={styles.text}>Yeni yayın sonrasında açık çalışmalarınızı kaydedip sayfayı yenileyin. Böylece son sürümle devam edebilirsiniz.</Text></View>;
}
const styles = StyleSheet.create({ page: { flex: 1, padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.bg.primary }, title: { ...typography.h2, color: colors.text.primary }, text: { ...typography.body, lineHeight: 23, color: colors.text.secondary, maxWidth: 720 } });
