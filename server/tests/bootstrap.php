<?php
/**
 * PHPUnit bootstrap.
 * Sets up a temporary storage tree so tests don't touch real data.
 */

define('TEST_ROOT', sys_get_temp_dir() . '/photo-stream-test-' . getmypid());
define('TEST_ORIGINALS', TEST_ROOT . '/originals');
define('TEST_THUMBNAILS', TEST_ROOT . '/thumbnails');
define('TEST_METADATA', TEST_ROOT . '/metadata');
define('TEST_CONFIG', TEST_ROOT . '/config');

// Create temp dirs
foreach ([TEST_ORIGINALS, TEST_THUMBNAILS, TEST_METADATA, TEST_CONFIG] as $d) {
    if (!is_dir($d)) mkdir($d, 0755, true);
}

// Load server libraries
require_once __DIR__ . '/../lib/image.php';
require_once __DIR__ . '/../lib/scanner.php';
require_once __DIR__ . '/../lib/auth.php';
