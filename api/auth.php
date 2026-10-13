<?php
/*
 * VoltGuard Tools hesap API'si (JSON).
 *
 *   GET  /api/auth.php?action=me | data_get | export
 *   POST /api/auth.php?action=register | login | logout | update_profile | change_password |
 *        delete_account | forgot_password | reset_password | data_put
 *   (PATH_INFO bicimi de calisir: /api/auth.php/login)
 *
 * Kurulum, veri klasoru ve curl ile test: api/README.md (web'den erisilemez).
 * Calisma verisi docroot DISINDA tutulur; api/ klasoru her deploy'da silinip yeniden kopyalanir.
 */
declare(strict_types=1);

define('VG_API', 1);

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/validate.php';
require __DIR__ . '/lib/mailer.php';
require __DIR__ . '/lib/handlers.php';

vg_run();
