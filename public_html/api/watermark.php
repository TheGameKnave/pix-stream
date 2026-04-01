<?php
/**
 * POST   /api/watermark — upload a watermark image (requires auth)
 * DELETE /api/watermark — remove the watermark (requires auth)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/storage.php';
requireAuth();

$storageDir = storagePath();
$wmDir = $storageDir . '/watermark';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!isset($_FILES['watermark'])) {
        http_response_code(400);
        echo json_encode(['error' => 'No file provided']);
        exit;
    }

    $file = $_FILES['watermark'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['error' => 'Upload error: ' . $file['error']]);
        exit;
    }

    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['png', 'jpg', 'jpeg', 'svg', 'webp'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Supported formats: PNG, JPG, SVG, WebP']);
        exit;
    }

    if (!is_dir($wmDir)) {
        mkdir($wmDir, 0755, true);
    }
    foreach (glob($wmDir . '/watermark.*') as $old) {
        unlink($old);
    }

    $dest = $wmDir . '/watermark.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save file']);
        exit;
    }

    $url = '/storage/watermark/watermark.' . $ext;

    $configPath = __DIR__ . '/../config/site.json';
    $config = file_exists($configPath) ? json_decode(file_get_contents($configPath), true) : [];
    $config['watermark'] = $url;
    file_put_contents($configPath, json_encode($config, JSON_PRETTY_PRINT));

    echo json_encode(['url' => $url]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    if (is_dir($wmDir)) {
        foreach (glob($wmDir . '/watermark.*') as $old) {
            unlink($old);
        }
    }

    $configPath = __DIR__ . '/../config/site.json';
    $config = file_exists($configPath) ? json_decode(file_get_contents($configPath), true) : [];
    $config['watermark'] = '';
    file_put_contents($configPath, json_encode($config, JSON_PRETTY_PRINT));

    echo json_encode(['removed' => true]);
    exit;
}

http_response_code(405);
