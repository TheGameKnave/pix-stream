<?php
/**
 * POST   /api/logo — upload a site logo (requires auth)
 * DELETE /api/logo — remove the site logo (requires auth)
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
$logoDir = $storageDir . '/logo';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!isset($_FILES['logo'])) {
        http_response_code(400);
        echo json_encode(['error' => 'No file provided']);
        exit;
    }

    $file = $_FILES['logo'];
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

    // Remove any existing logo
    if (!is_dir($logoDir)) {
        mkdir($logoDir, 0755, true);
    }
    foreach (glob($logoDir . '/site-logo.*') as $old) {
        unlink($old);
    }

    $dest = $logoDir . '/site-logo.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save file']);
        exit;
    }

    $url = '/storage/logo/site-logo.' . $ext;

    // Update config
    $configPath = __DIR__ . '/../config/site.json';
    $config = file_exists($configPath) ? json_decode(file_get_contents($configPath), true) : [];
    $config['siteLogo'] = $url;
    file_put_contents($configPath, json_encode($config, JSON_PRETTY_PRINT));

    echo json_encode(['url' => $url]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    // Remove logo files
    if (is_dir($logoDir)) {
        foreach (glob($logoDir . '/site-logo.*') as $old) {
            unlink($old);
        }
    }

    // Clear from config
    $configPath = __DIR__ . '/../config/site.json';
    $config = file_exists($configPath) ? json_decode(file_get_contents($configPath), true) : [];
    $config['siteLogo'] = '';
    file_put_contents($configPath, json_encode($config, JSON_PRETTY_PRINT));

    echo json_encode(['removed' => true]);
    exit;
}

http_response_code(405);
