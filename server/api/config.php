<?php
/**
 * GET  /api/config — returns site configuration (public)
 * PUT  /api/config — updates site configuration (requires auth)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$configPath = __DIR__ . '/../config/site.json';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (file_exists($configPath)) {
        readfile($configPath);
    } else {
        echo json_encode(getDefaultConfig());
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    require_once __DIR__ . '/../lib/auth.php';
    requireAuth();

    $input = json_decode(file_get_contents('php://input'), true);
    if (!$input) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON']);
        exit;
    }

    $config = file_exists($configPath) ? json_decode(file_get_contents($configPath), true) : getDefaultConfig();
    $config = array_merge($config, $input);
    file_put_contents($configPath, json_encode($config, JSON_PRETTY_PRINT));
    echo json_encode($config);
    exit;
}

http_response_code(405);

function getDefaultConfig(): array {
    return [
        'title' => 'Photo Stream',
        'subtitle' => 'A floating photo gallery',
        'headerColor' => '#01ddb1',
        'paletteMode' => 'mono',
        'bgColor' => '#808080',
        'fontBody' => 'Raleway',
        'nsfwBlurDefault' => false,
        'enabledTags' => [],
        'tagDisplayMode' => 'nav',
        'enableShare' => true,
        'enableDownload' => true,
        'enableQr' => true,
        'enableKiosk' => true,
        'flowDirection' => 'rtl',
        'flowSpeed' => 'med',
        'contactEmail' => '',
        'pageHeadTitle' => '',
        'description' => '',
        'siteLogo' => '',
        'siteFavicon' => '',
        'watermark' => '',
        'sortOrder' => 'random',
    ];
}
