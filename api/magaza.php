<?php
/** VoltGuard Magaza JSON API (api/MAGAZA.md). PHP 7.4+, harici kutuphane gerektirmez. */
declare(strict_types=1);
define('VG_API', 1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/validate.php';
require __DIR__ . '/lib/mailer.php';
require __DIR__ . '/lib/turnstile.php';
require __DIR__ . '/lib/magaza.php';
require __DIR__ . '/lib/magaza-belge.php';
require __DIR__ . '/lib/magaza-siparis.php';
require __DIR__ . '/lib/magaza-kaynak.php';
require __DIR__ . '/lib/magaza-api.php';
vgm_api_run();
