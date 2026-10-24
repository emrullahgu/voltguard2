<?php
/*
 * VoltGuard birinci taraf ölçüm API'si (çerezsiz, anonim günlük toplamlar).
 *
 *   POST /api/metrics.php?action=collect    js/vg-metrics.js olayları (sendBeacon, text/plain JSON)
 *   GET  /api/metrics.php?action=popular    son 30 günün en çok kullanılan araçları (herkese açık, toplam veri)
 *   GET  /api/metrics.php?action=dashboard  büyüme paneli verisi (yetkili yönetici + oturum + CSRF)
 *
 * Ayrıntılar ve gizlilik ilkeleri: api/lib/metrics.php ve api/METRICS.md (web'den erişilemez).
 */
declare(strict_types=1);

define('VG_API', 1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/validate.php';
require __DIR__ . '/lib/metrics.php';

vg_metrics_run();
