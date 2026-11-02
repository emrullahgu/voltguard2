import { colors } from '../theme';

// The imported screens also run outside the employee portal. Only the hosted
// web workspace uses the site's visual language; navigation and data stay local
// to each screen.
const hosted = typeof window !== 'undefined' && !!(window as any).VoltGuardEmployeeModules;
const accent = 'var(--vg-module-accent, #b45309)';
const accentSoft = 'var(--vg-module-accent-soft, #fff6df)';

export function siteHubIconColor(original: string): string { return hosted ? accent : original; }
export function siteHubIconSize(original: number): number { return hosted ? 22 : original; }
export function siteHubIconStyle() {
  return hosted ? { backgroundColor: accentSoft, borderRadius: 8, width: 36, height: 36 } : {};
}
export function siteHubCardStyle() {
  return hosted ? {
    backgroundColor: colors.bg.card, borderColor: colors.border.primary,
    borderLeftWidth: 1, borderRadius: 10, padding: 18,
    minHeight: 112, alignItems: 'flex-start' as const,
    justifyContent: 'flex-start' as const,
  } : {};
}

function statusColor(color: string): string | null {
  const normalized = color.toLowerCase().slice(0, 7);
  if (['#ef4444', '#dc2626', '#f43f5e', '#e11d48'].includes(normalized)) return normalized;
  if (['#f59e0b', '#f97316', '#d97706'].includes(normalized)) return accent;
  return null;
}
export function siteHubStatColor(original: string): string {
  return hosted ? statusColor(original) || colors.text.secondary : original;
}
export function siteHubStatStyle(original: string) {
  if (!hosted) return {};
  const semantic = statusColor(original);
  return { borderColor: semantic || colors.border.primary, backgroundColor: colors.bg.card };
}

export function siteHubStyles<T extends Record<string, any>>(source: T, options: { hideHero?: boolean } = {}): T {
  if (!hosted) return source;
  const styles: Record<string, any> = { ...source };
  const patch = (keys: string[], values: Record<string, any>) => {
    for (const key of keys) if (styles[key]) styles[key] = { ...styles[key], ...values };
  };
  patch(['safe'], { backgroundColor: colors.bg.primary });
  // There is no mobile tab bar to reserve space for in the website.
  patch(['content', 'scroll'], { paddingBottom: 24 });
  patch(['hero', 'heroCard'], options.hideHero ? { display: 'none' } : {
    backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0,
    padding: 0, paddingVertical: 0, alignItems: 'flex-start',
  });
  patch(['heroTitle', 'heroT', 'title'], { fontFamily: 'Outfit', color: colors.text.primary, fontSize: 20, fontWeight: '600', lineHeight: 28 });
  patch(['heroSub', 'heroS', 'heroD', 'sub'], { fontFamily: 'Inter', color: colors.text.muted, fontSize: 14, lineHeight: 22, textAlign: 'left' });
  patch(['tile'], siteHubCardStyle());
  patch(['tileIcon'], { ...siteHubIconStyle(), marginBottom: 10 });
  patch(['tileLabel', 'tileT', 'tileL'], { fontFamily: 'Outfit', color: colors.text.primary, fontSize: 16, fontWeight: '600', lineHeight: 22, textAlign: 'left' });
  patch(['tileDesc', 'tileD', 'desc'], { fontFamily: 'Inter', color: colors.text.muted, fontSize: 14, lineHeight: 22, textAlign: 'left', minHeight: 0 });
  patch(['pill'], { backgroundColor: colors.bg.card, borderColor: colors.border.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 });
  patch(['pillText'], { fontFamily: 'Inter', fontSize: 13, lineHeight: 20, fontWeight: '500' });
  patch(['kpi', 'stat'], { backgroundColor: colors.bg.card, borderColor: colors.border.primary, borderRadius: 10, padding: 14, minWidth: 0 });
  patch(['kpiV', 'statV', 'sumV'], { fontFamily: 'Outfit', fontSize: 24, fontWeight: '600', lineHeight: 30 });
  patch(['kpiL', 'statL', 'sumL', 'sumLabel', 'sectionLabel', 'sectionT', 'sectionTitle', 'tipText'], { fontFamily: 'Inter', fontSize: 14, lineHeight: 22 });
  patch(['countBox'], { backgroundColor: accentSoft, borderRadius: 6 });
  patch(['countT'], { fontFamily: 'Inter', color: accent, fontSize: 14, fontWeight: '600' });
  return styles as T;
}
