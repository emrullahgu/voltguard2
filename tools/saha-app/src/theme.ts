// VoltGuard site palette. Legacy "green" names remain for imported screens.
// Slogan: SAHADA · TAKİPTE · KONTROLDE
export const brand = {
  blue: '#0a1628',
  blueLight: '#1e3a5f',
  blueDark: '#07111f',
  amber: '#f59e0b',
  onAmber: '#0a1628',
  // Imported controls often pair this token with white labels. The site's
  // dark amber keeps that contrast readable; new amber controls use onAmber.
  green: '#b45309',
  greenLight: '#fbbf24',
  greenDark: '#92400e',
};

// ─────────────────────────────────────────────────────────────
// Tema modu: ekranlar StyleSheet.create ile module-scope'ta
// renkleri donduruyor. Bu yüzden mod, modül yüklenmeden ÖNCE
// senkron olarak tespit edilmeli (çalışan bootstrap'ındaki tercih ve
// global stamp). Mod değişimi themeMode.setThemeMode() içinden
// yeniden yüklemeyle uygulanır.
// ─────────────────────────────────────────────────────────────
export const THEME_STORAGE_KEY = 'sahatakip.themeMode';

function readInitialMode(): 'light' | 'dark' {
  try {
    const g: any = typeof globalThis !== 'undefined' ? globalThis : undefined;
    if (g && (g.__SAHATAKIP_THEME__ === 'light' || g.__SAHATAKIP_THEME__ === 'dark')) {
      return g.__SAHATAKIP_THEME__;
    }
  } catch {
    /* sessiz */
  }
  // Varsayılan: açık renk tema (kullanıcı sonradan seçtiyse o tercih kaydedilip yüklenir)
  return 'light';
}

export const __activeThemeMode: 'light' | 'dark' = readInitialMode();

try {
  (globalThis as any).__SAHATAKIP_THEME__ = __activeThemeMode;
} catch {
  /* sessiz */
}

const DARK_TOKENS = {
  bg: { primary: '#0a1628', secondary: '#0d1f3c', card: '#15283f' },
  border: { primary: '#29405a', secondary: '#425772' },
  text: { primary: '#f1f5f9', secondary: '#cbd5e1', muted: '#94a3b8', faint: '#64748b' },
};

const LIGHT_TOKENS = {
  bg: { primary: '#f8fafc', secondary: '#f1f5f9', card: '#ffffff' },
  border: { primary: '#e2e8f0', secondary: '#cbd5e1' },
  text: { primary: '#0a1628', secondary: '#334155', muted: '#475569', faint: '#64748b' },
};

export function getThemeTokens(mode: 'light'|'dark') { return mode === 'light' ? LIGHT_TOKENS : DARK_TOKENS; }
const __TOKENS = getThemeTokens(__activeThemeMode);

export const colors = {
  bg: { ...__TOKENS.bg, tertiary: __TOKENS.bg.secondary },
  border: { ...__TOKENS.border, default: __TOKENS.border.primary },
  text: __TOKENS.text,
  // Compatibility accent token — VoltGuard amber.
  emerald: {
    default: brand.green,
    light: brand.greenLight,
    dark: brand.greenDark,
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.30)',
  },
  // SECONDARY (lacivert) — logo mavisi
  indigo: {
    default: brand.blue,
    dark: brand.blueDark,
    light: brand.blueLight,
    bg: 'rgba(10, 22, 40, 0.15)',
    border: 'rgba(10, 22, 40, 0.35)',
  },
  blue: {
    default: brand.blueLight,
    bg: 'rgba(30, 58, 95, 0.12)',
    border: 'rgba(30, 58, 95, 0.30)',
  },
  amber: {
    default: '#fbbf24',
    bg: 'rgba(251, 191, 36, 0.12)',
    border: 'rgba(251, 191, 36, 0.30)',
  },
  rose: {
    default: '#f43f5e',
    bg: 'rgba(244, 63, 94, 0.12)',
    border: 'rgba(244, 63, 94, 0.30)',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
};

export const typography = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 28,
  // Semantic style objects (spread into StyleSheet entries)
  h1: { fontFamily: 'Outfit', fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  h2: { fontFamily: 'Outfit', fontSize: 24, fontWeight: '700' as const, lineHeight: 30 },
  h3: { fontFamily: 'Outfit', fontSize: 20, fontWeight: '700' as const, lineHeight: 26 },
  h4: { fontFamily: 'Outfit', fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  title: { fontFamily: 'Outfit', fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  body: { fontFamily: 'Inter', fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  caption: { fontFamily: 'Inter', fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
};
