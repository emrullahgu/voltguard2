<?php
/* VoltHaber API: sektor haberleri, editor islemleri ve bulten aboneligi. Ayrintilar: api/VOLTHABER.md */
declare(strict_types=1);

define('VG_API', 1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/validate.php';
require __DIR__ . '/lib/mailer.php';
require __DIR__ . '/lib/volthaber.php';
require __DIR__ . '/lib/volthaber-registry.php';
require __DIR__ . '/lib/volthaber-fetch.php';
require __DIR__ . '/lib/volthaber-api.php';

vh_api_run();
