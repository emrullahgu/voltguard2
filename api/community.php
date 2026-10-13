<?php
/* Public community API. No company or payroll data is handled here. */
declare(strict_types=1);

define('VG_API', 1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/validate.php';
require __DIR__ . '/lib/community.php';

vg_community_run();
