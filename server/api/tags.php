<?php
/**
 * GET /api/tags — list all tags (from IPTC keywords in originals)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once __DIR__ . '/../lib/scanner.php';
require_once __DIR__ . '/../lib/storage.php';

$originalsDir = storagePath('originals');

$tags = getAllTags($originalsDir ?: '');
echo json_encode($tags);
