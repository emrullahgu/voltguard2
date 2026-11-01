import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, PROVIDER_GOOGLE, PROVIDER_DEFAULT, Region } from 'react-native-maps';

import { colors, spacing, radius, typography, brand } from '../theme';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { requestAndGetPosition, GeoPosition } from '../services/location';
import { locationsRepo, LocationRow } from '../services/data/locationsRepo';

// İzmir merkez varsayılan
const DEFAULT_REGION: Region = {
  latitude: 38.4192,
  longitude: 27.1287,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

function validCoordinate(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export default function MapScreen() {
  const { workOrders, employees } = useAppContext();
  const { hasPermission } = useAuth();
  // Saha ekip konumları YALNIZ yönetici/müdüre (employees:R) gösterilir; field
  // kullanıcı yalnız kendi konumunu görür. (RLS de DB'de aynı sınırı uygular.)
  const canSeeStaff = hasPermission('employees', 'R');
  const mapRef = useRef<MapView | null>(null);
  const [me, setMe] = useState<GeoPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const mounted = useRef(true);
  const [staffLocs, setStaffLocs] = useState<LocationRow[]>([]);
  const [showStaff, setShowStaff] = useState(canSeeStaff);
  // Canlılık tick'i: "N dk önce" etiketlerinin ekranda otomatik tazelenmesi için
  // 30 sn'de bir re-render (ağ çağrısı yapmaz). Aksi halde etiket donar.
  const [, setNowTick] = useState(0);

  const ensureLocation = useCallback(async () => {
    setLoading(true);
    setLocationError(null);
    try {
      const pos = await requestAndGetPosition();
      if (!mounted.current) return;
      if (!pos) {
        setMe(null);
        setLocationError('Haritada konumunuzu göstermek için konum izni gerekiyor. İzin verdikten sonra konum düğmesiyle yeniden deneyin.');
        return;
      }
      if (!validCoordinate(pos.latitude, pos.longitude)) throw new Error('Cihaz geçerli bir konum döndürmedi.');
      setMe(pos);
      mapRef.current?.animateToRegion(
        {
          latitude: pos.latitude,
          longitude: pos.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        },
        700
      );
    } catch (error: any) {
      if (mounted.current) {
        setMe(null);
        setLocationError('Cihaz konumu alınamadı: ' + (error?.message || 'Yeniden deneyin.'));
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void ensureLocation();
    return () => { mounted.current = false; };
  }, [ensureLocation]);

  // POZ-DEV-015 — Canlı personel konumları. Her odaklanmada latestAll ile TAZELE
  // (realtime kopması/arka plandan dönüş sonrası kayıp güncellemeleri toparlar).
  useFocusEffect(
    useCallback(() => {
      if (!canSeeStaff) return;
      let alive = true;
      (async () => {
        try {
          const list = await locationsRepo.latestAll();
          if (alive) { setStaffLocs(list); setStaffError(null); }
        } catch (error: any) {
          if (alive) { setStaffLocs([]); setStaffError('Personel konumları alınamadı: ' + (error?.message || 'Yeniden açıp deneyin.')); }
        }
      })();
      return () => { alive = false; };
    }, [canSeeStaff]),
  );

  // Realtime INSERT aboneliği (yalnız yönetici) — yeni konum gelince marker güncellenir.
  useEffect(() => {
    if (!canSeeStaff) return;
    try {
      const unsub = locationsRepo.subscribeRealtime(loc => {
        setStaffLocs(prev => {
          const filtered = prev.filter(p => p.userId !== loc.userId);
          return [loc, ...filtered];
        });
      });
      return () => { unsub(); };
    } catch (error: any) {
      setStaffError('Canlı personel konumları başlatılamadı: ' + (error?.message || 'Yeniden açıp deneyin.'));
    }
  }, [canSeeStaff]);

  // 30 sn'lik canlılık tick'i — tazelik etiketlerini güncel tutar.
  useEffect(() => {
    if (!canSeeStaff) return;
    const t = setInterval(() => setNowTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, [canSeeStaff]);

  const activeOrders = workOrders.filter(w => !['Tamamlandı', 'İptal', 'Faturalandırıldı'].includes(w.status));
  const validStaffLocs = staffLocs.filter(loc => validCoordinate(loc.lat, loc.lng));

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
          style={styles.map}
          initialRegion={
            me
              ? {
                  latitude: me.latitude,
                  longitude: me.longitude,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }
              : DEFAULT_REGION
          }
          showsUserLocation={!!me}
          showsMyLocationButton={false}
        >
          {/* İş emri modelinde doğrulanmış bir saha koordinatı bulunmuyor.
              Müşteri adından veya listedeki sırasından konum türetilmez. */}

          {/* POZ-DEV-015 — Canlı personel pinleri (yalnız yönetici) */}
          {showStaff && canSeeStaff &&
            validStaffLocs.map(loc => {
              const emp = employees.find(e => e.id === loc.employeeId || e.id === loc.userId);
              const label = emp?.name ?? 'Personel';
              const now = Date.now();
              const age = (now - new Date(loc.recordedAt).getTime()) / 60000; // dakika
              const isFresh = Number.isFinite(age) && age >= 0 && age < 5;
              const clock = new Date(loc.recordedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
              return (
                <Marker
                  key={'staff-' + loc.userId}
                  coordinate={{ latitude: loc.lat, longitude: loc.lng }}
                  title={`👤 ${label}`}
                  description={
                    !Number.isFinite(age) ? 'Konum zamanı bilinmiyor' : isFresh
                      ? `🟢 Canlı · ${age.toFixed(0)} dk önce (${clock})`
                      : `Son görülme: ${age.toFixed(0)} dk önce (${clock})`
                  }
                  pinColor={isFresh ? '#10b981' : '#64748b'}
                />
              );
            })}
        </MapView>

        {loading && (
          <View style={styles.overlay}>
            <ActivityIndicator color={brand.green} size="large" />
            <Text style={styles.overlayText}>Konum alınıyor...</Text>
          </View>
        )}

        {/* My location FAB */}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Konumumu göster" disabled={loading} style={styles.fab} onPress={ensureLocation} activeOpacity={0.85}>
          <Ionicons name="locate" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Personel toggle FAB — yalnız yönetici */}
        {canSeeStaff && (
          <TouchableOpacity
            style={[styles.fab, styles.fabStaff, !showStaff && styles.fabStaffOff]}
            onPress={() => setShowStaff(s => !s)}
            activeOpacity={0.85}
          >
            <Ionicons name={showStaff ? 'people' : 'people-outline'} size={20} color="#fff" />
          </TouchableOpacity>
        )}

        {/* Personel konumlarının tazeliği; iş emri konumu gösterilmez. */}
        {canSeeStaff && showStaff && <View style={styles.legend}>
          <View style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: '#10b981' }]} />
            <Text style={styles.legendText}>Canlı personel</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: '#64748b' }]} />
            <Text style={styles.legendText}>Son bilinen personel konumu</Text>
          </View>
        </View>}
      </View>

      <View style={styles.notice}>
        {activeOrders.length > 0 ? (
          <Text style={styles.noticeText}>{activeOrders.length} iş emrinin doğrulanmış konumu yok; haritada gösterilmedi.</Text>
        ) : <Text style={styles.noticeText}>Aktif iş emri yok.</Text>}
        {locationError && <Text accessibilityRole="alert" style={styles.noticeText}>{locationError}</Text>}
        {canSeeStaff && staffError && <Text accessibilityRole="alert" style={styles.noticeText}>{staffError}</Text>}
        {canSeeStaff && validStaffLocs.length < staffLocs.length && (
          <Text style={styles.noticeText}>{staffLocs.length - validStaffLocs.length} personel konumu geçersiz olduğu için haritada gösterilmedi.</Text>
        )}
      </View>

      {/* Bottom bar — özet */}
      <View style={styles.bottomBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bbLabel}>Aktif İş Emri</Text>
          <Text style={styles.bbValue}>{activeOrders.length} adet</Text>
        </View>
        {me && (
          <View style={styles.coordBox}>
            <Ionicons name="navigate-outline" size={14} color={brand.green} />
            <Text style={styles.coordText}>
              {me.latitude.toFixed(4)}, {me.longitude.toFixed(4)}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  notice: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 4, backgroundColor: colors.bg.secondary },
  noticeText: { color: colors.text.muted, fontSize: typography.xs },
  mapWrap: { flex: 1, position: 'relative' },
  map: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(2,6,23,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  overlayText: { color: '#fff', fontWeight: '600' },
  fab: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.lg,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: brand.green,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: brand.green,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabStaff: {
    bottom: spacing.lg + 60,
    backgroundColor: brand.blueLight,
    shadowColor: brand.blueLight,
  },
  fabStaffOff: { backgroundColor: colors.text.muted, shadowOpacity: 0 },
  legend: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    backgroundColor: 'rgba(15,23,42,0.88)',
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 4,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.bg.secondary,
    borderTopWidth: 1,
    borderTopColor: colors.border.primary,
  },
  bbLabel: { color: colors.text.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  bbValue: { color: colors.text.primary, fontSize: typography.md, fontWeight: '900', marginTop: 2 },
  coordBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bg.card,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  coordText: { color: colors.text.muted, fontSize: 10, fontWeight: '600' },
});
