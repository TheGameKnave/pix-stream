<?php
/**
 * GET /api/manifest
 * Returns JSON array of all images with metadata.
 * Generates thumbnails on first request if they don't exist.
 */

// Suppress warnings so they don't corrupt JSON output
error_reporting(E_ERROR);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once __DIR__ . '/../lib/scanner.php';
require_once __DIR__ . '/../lib/image.php';

$storageDir = realpath(__DIR__ . '/../../storage/originals');
$thumbDir = realpath(__DIR__ . '/../../storage/thumbnails');

if (!$storageDir) {
    echo json_encode([]);
    exit;
}

$images = scanImages($storageDir);
$manifest = [];

foreach ($images as $image) {
    // Skip images with no dimensions (corrupt/unreadable)
    if ($image['width'] <= 0 || $image['height'] <= 0) continue;

    $thumbPath = $thumbDir . '/' . $image['filename'];
    // Also check for .gif.jpg fallback thumbnail
    $thumbFallback = $thumbPath . '.jpg';
    if (!file_exists($thumbPath) && !file_exists($thumbFallback)) {
        $ok = generateThumbnail($image['path'], $thumbPath);
        // If thumbnail generation failed, skip this image
        if (!$ok && !file_exists($thumbPath) && !file_exists($thumbFallback)) continue;
    }

    $encodedFilename = rawurlencode($image['filename']);
    $manifest[] = [
        'id' => $image['id'],
        'filename' => $image['filename'],
        'type' => $image['type'],
        'thumb' => '/api/image/thumb/' . $encodedFilename,
        'full' => '/api/image/full/' . $encodedFilename,
        'tags' => $image['tags'],
        'width' => $image['width'],
        'height' => $image['height'],
        'nsfw' => $image['nsfw'],
        'copyright' => $image['copyright'],
    ];
}

echo json_encode($manifest);
