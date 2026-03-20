<?php
/**
 * GET /api/manifest
 * Returns JSON array of all images with metadata.
 * Generates thumbnails on first request if they don't exist.
 * Cleans up stale thumbnails that no longer have a matching original.
 */

// Suppress warnings so they don't corrupt JSON output
error_reporting(E_ERROR);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once __DIR__ . '/../lib/scanner.php';
require_once __DIR__ . '/../lib/image.php';

$storageDir = realpath(__DIR__ . '/../../storage/originals');
$thumbDir   = realpath(__DIR__ . '/../../storage/thumbnails');

if (!$storageDir) {
    echo json_encode(['version' => '', 'images' => []]);
    exit;
}

$images = scanImages($storageDir);
$manifest = [];
$validThumbFiles = []; // Track which thumb files belong to current originals

foreach ($images as $image) {
    if ($image['width'] <= 0 || $image['height'] <= 0) continue;

    // Thumbnail base name matches original's id (no extension — generateThumbnail appends it)
    $thumbBase = $thumbDir . '/' . $image['id'];
    $isGif = strtolower(pathinfo($image['filename'], PATHINFO_EXTENSION)) === 'gif';
    $expectedThumb = $isGif ? $thumbBase . '.gif' : $thumbBase . '.png';

    // Also accept the opposite format as a fallback (e.g. gif without Imagick → .png)
    $fallbackThumb = $isGif ? $thumbBase . '.png' : $thumbBase . '.gif';

    $thumbExists = file_exists($expectedThumb) || file_exists($fallbackThumb);

    if (!$thumbExists) {
        $result = generateThumbnail($image['path'], $thumbBase);
        if (!$result) continue;
        // result is the actual path that was written
        $validThumbFiles[] = basename($result);
    } else {
        if (file_exists($expectedThumb)) $validThumbFiles[] = basename($expectedThumb);
        if (file_exists($fallbackThumb)) $validThumbFiles[] = basename($fallbackThumb);
    }

    // Determine the actual thumb filename for the URL
    $thumbFilename = file_exists($expectedThumb) ? basename($expectedThumb) : basename($fallbackThumb);

    $manifest[] = [
        'id' => $image['id'],
        'filename' => $image['filename'],
        'type' => $image['type'],
        'thumb' => '/api/image/thumb/' . rawurlencode($thumbFilename),
        'full' => '/api/image/full/' . rawurlencode($image['filename']),
        'tags' => $image['tags'],
        'width' => $image['width'],
        'height' => $image['height'],
        'nsfw' => $image['nsfw'],
        'copyright' => $image['copyright'],
    ];
}

// Clean up stale thumbnails that don't match any current original
if ($thumbDir) {
    $thumbFiles = @scandir($thumbDir);
    if ($thumbFiles) {
        foreach ($thumbFiles as $f) {
            if ($f[0] === '.' || $f === '.gitkeep') continue;
            if (!in_array($f, $validThumbFiles)) {
                @unlink($thumbDir . '/' . $f);
            }
        }
    }
}

// Version hash so the client can detect manifest changes
$version = md5(json_encode(array_column($manifest, 'id')));

echo json_encode(['version' => $version, 'images' => $manifest]);
