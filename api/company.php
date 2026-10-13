<?php
declare(strict_types=1);
define('VG_API', 1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/staff.php';
require __DIR__ . '/lib/company.php';
vg_company_run();
