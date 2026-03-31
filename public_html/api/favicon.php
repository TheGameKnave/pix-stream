<?php
/**
 * POST   /api/favicon — upload a site favicon (requires auth)
 *        SVG files are copied as-is. PNG/GIF are converted to ICO. ICO files are copied as-is.
 * DELETE /api/favicon — remove custom favicon, restore default SVG (requires auth)
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
require_once __DIR__ . '/../lib/favicon.php';
requireAuth();

$serverRoot = __DIR__ . '/..';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!isset($_FILES['favicon'])) {
        http_response_code(400);
        echo json_encode(['error' => 'No file provided']);
        exit;
    }

    $file = $_FILES['favicon'];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['error' => 'Upload error: ' . $file['error']]);
        exit;
    }

    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['svg', 'png', 'ico', 'gif'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Supported formats: SVG, PNG, ICO, GIF']);
        exit;
    }

    // Remove any existing favicon at server root
    foreach (glob($serverRoot . '/favicon.*') as $old) {
        unlink($old);
    }

    $tmpPath = $file['tmp_name'];

    if ($ext === 'svg') {
        copy($tmpPath, $serverRoot . '/favicon.svg');
        $url = '/favicon.svg';
    } elseif ($ext === 'ico') {
        copy($tmpPath, $serverRoot . '/favicon.ico');
        $url = '/favicon.ico';
    } else {
        // Convert PNG/GIF to ICO
        $src = $ext === 'gif' ? imagecreatefromgif($tmpPath) : imagecreatefrompng($tmpPath);
        if (!$src) {
            $src = imagecreatefromstring(file_get_contents($tmpPath));
        }
        if (!$src) {
            http_response_code(400);
            echo json_encode(['error' => 'Could not read image']);
            exit;
        }
        file_put_contents($serverRoot . '/favicon.ico', gdToIco($src));
        $url = '/favicon.ico';
    }

    // Update config
    $configPath = __DIR__ . '/../config/site.json';
    $config = file_exists($configPath) ? json_decode(file_get_contents($configPath), true) : [];
    $config['siteFavicon'] = $url;
    file_put_contents($configPath, json_encode($config, JSON_PRETTY_PRINT));

    echo json_encode(['url' => $url]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    // Remove custom favicon
    foreach (glob($serverRoot . '/favicon.*') as $old) {
        unlink($old);
    }

    // Restore default SVG
    writeDefaultFavicon($serverRoot);

    // Clear from config
    $configPath = __DIR__ . '/../config/site.json';
    $config = file_exists($configPath) ? json_decode(file_get_contents($configPath), true) : [];
    $config['siteFavicon'] = '';
    file_put_contents($configPath, json_encode($config, JSON_PRETTY_PRINT));

    echo json_encode(['removed' => true]);
    exit;
}

http_response_code(405);
