<?php
/**
 * GET    /api/tags         — list all tags
 * PUT    /api/tags/:image  — update tags for an image (requires auth)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../lib/scanner.php';

$metadataDir = realpath(__DIR__ . '/../../storage/metadata');
$originalsDir = realpath(__DIR__ . '/../../storage/originals');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $tags = getAllTags($metadataDir, $originalsDir ?: '');
    echo json_encode($tags);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    require_once __DIR__ . '/../lib/auth.php';
    requireAuth();

    $imageId = basename($_SERVER['PATH_INFO'] ?? '');
    $input = json_decode(file_get_contents('php://input'), true);
    $tags = $input['tags'] ?? [];

    $metaFile = $metadataDir . '/' . $imageId . '.json';
    $meta = file_exists($metaFile) ? json_decode(file_get_contents($metaFile), true) : [];
    $meta['tags'] = $tags;
    file_put_contents($metaFile, json_encode($meta, JSON_PRETTY_PRINT));

    echo json_encode(['success' => true, 'tags' => $tags]);
    exit;
}

http_response_code(405);
