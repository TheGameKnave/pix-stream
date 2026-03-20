<?php
/**
 * GET /api/status — server capabilities and stats (public)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$origDir = realpath(__DIR__ . '/../../storage/originals');
$thumbDir = realpath(__DIR__ . '/../../storage/thumbnails');

$imageCount = 0;
if ($origDir) {
    $imageCount = count(glob($origDir . '/*.{jpg,jpeg,JPG,JPEG,gif,GIF}', GLOB_BRACE) ?: []);
}

$thumbCount = 0;
if ($thumbDir) {
    $thumbCount = count(glob($thumbDir . '/*.{jpg,jpeg,JPG,JPEG,gif,GIF}', GLOB_BRACE) ?: []);
}

echo json_encode([
    'php' => PHP_VERSION,
    'imagick' => extension_loaded('imagick'),
    'imagickVersion' => extension_loaded('imagick') ? Imagick::getVersion()['versionString'] : null,
    'gd' => extension_loaded('gd'),
    'maxUpload' => ini_get('upload_max_filesize'),
    'maxPost' => ini_get('post_max_size'),
    'imageCount' => $imageCount,
    'thumbCount' => $thumbCount,
]);
