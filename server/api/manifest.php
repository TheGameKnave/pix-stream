<?php
/**
 * GET /api/manifest
 * Returns JSON array of all images with EXIF/IPTC data.
 * Generates thumbnails and processed full images on first request.
 * Cleans up stale generated files that no longer have a matching original.
 */

// Suppress warnings so they don't corrupt JSON output
error_reporting(E_ERROR);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once __DIR__ . '/../lib/scanner.php';
require_once __DIR__ . '/../lib/image.php';

$storageDir   = realpath(__DIR__ . '/../../storage/originals');
$thumbDir     = realpath(__DIR__ . '/../../storage/thumbnails');
$processedDir = realpath(__DIR__ . '/../../storage/processed');
$configPath   = __DIR__ . '/../config/site.json';

if (!$storageDir) {
    echo json_encode(['version' => '', 'images' => []]);
    exit;
}

// Read site config for banner info
$siteConfig = file_exists($configPath) ? json_decode(file_get_contents($configPath), true) : [];
$contactEmail = $siteConfig['contactEmail'] ?? '';
$bannerConfig = [];
if ($contactEmail) {
    $bannerConfig = [
        'email' => $contactEmail,
        'title' => $siteConfig['title'] ?? 'Photo Stream',
        'subtitle' => $siteConfig['subtitle'] ?? '',
        'fontBody' => $siteConfig['fontBody'] ?? 'Raleway',
        'siteLogo' => $siteConfig['siteLogo'] ?? '',
    ];
    // Track banner config hash — if it changes, nuke processed images to regenerate
    $bannerHash = md5(json_encode($bannerConfig));
    $bannerHashFile = $processedDir . '/.banner_hash';
    $oldHash = file_exists($bannerHashFile) ? trim(file_get_contents($bannerHashFile)) : '';
    if ($bannerHash !== $oldHash) {
        // Config changed — clear all processed images so they regenerate with new banner
        $existing = @scandir($processedDir);
        if ($existing) {
            foreach ($existing as $f) {
                if ($f[0] === '.') continue;
                @unlink($processedDir . '/' . $f);
            }
        }
        file_put_contents($bannerHashFile, $bannerHash);
    }
} else {
    // No email — clear banner hash so removing email triggers regeneration too
    $bannerHashFile = $processedDir . '/.banner_hash';
    if (file_exists($bannerHashFile)) {
        @unlink($bannerHashFile);
        $existing = @scandir($processedDir);
        if ($existing) {
            foreach ($existing as $f) {
                if ($f[0] === '.') continue;
                @unlink($processedDir . '/' . $f);
            }
        }
    }
}

$images = scanImages($storageDir);
$manifest = [];
$validThumbFiles = [];
$validProcessedFiles = [];

foreach ($images as $image) {
    if ($image['width'] <= 0 || $image['height'] <= 0) continue;

    $ext = strtolower(pathinfo($image['filename'], PATHINFO_EXTENSION));
    $isGif = $ext === 'gif';
    $isJpeg = in_array($ext, ['jpg', 'jpeg']);

    // --- Thumbnail ---
    $thumbBase = $thumbDir . '/' . $image['id'];
    $expectedThumb = $isGif ? $thumbBase . '.gif' : ($isJpeg ? $thumbBase . '.jpg' : $thumbBase . '.png');
    $fallbackExts = $isGif ? ['.png'] : ($isJpeg ? ['.png', '.gif'] : ['.jpg', '.gif']);
    $fallbackThumb = null;
    foreach ($fallbackExts as $fe) {
        if (file_exists($thumbBase . $fe)) { $fallbackThumb = $thumbBase . $fe; break; }
    }

    $thumbExists = file_exists($expectedThumb) || $fallbackThumb;

    if (!$thumbExists) {
        $result = generateThumbnail($image['path'], $thumbBase);
        if (!$result) continue;
        $validThumbFiles[] = basename($result);
    } else {
        if (file_exists($expectedThumb)) $validThumbFiles[] = basename($expectedThumb);
        if ($fallbackThumb) $validThumbFiles[] = basename($fallbackThumb);
    }

    $thumbFilename = file_exists($expectedThumb) ? basename($expectedThumb) : ($fallbackThumb ? basename($fallbackThumb) : '');
    $thumbPath = $thumbDir . '/' . $thumbFilename;

    // --- Processed full image ---
    $procBase = $processedDir . '/' . $image['id'];
    $expectedProc = $isGif ? $procBase . '.gif' : ($isJpeg ? $procBase . '.jpg' : $procBase . '.png');
    $fallbackProc = null;
    foreach (($isGif ? ['.png'] : ($isJpeg ? ['.png', '.gif'] : ['.jpg', '.gif'])) as $fe) {
        if (file_exists($procBase . $fe)) { $fallbackProc = $procBase . $fe; break; }
    }

    $procExists = file_exists($expectedProc) || $fallbackProc;

    if (!$procExists) {
        $imgBanner = $bannerConfig;
        if ($imgBanner && $image['copyright']) {
            $imgBanner['copyright'] = $image['copyright'];
        }
        $result = generateProcessed($image['path'], $procBase, $imgBanner);
        if ($result) {
            $validProcessedFiles[] = basename($result);
        }
    } else {
        if (file_exists($expectedProc)) $validProcessedFiles[] = basename($expectedProc);
        if ($fallbackProc) $validProcessedFiles[] = basename($fallbackProc);
    }

    $procFilename = file_exists($expectedProc) ? basename($expectedProc) : ($fallbackProc ? basename($fallbackProc) : basename($image['filename']));

    // --- Blurred thumbnail for NSFW images ---
    $blurFilename = null;
    if ($image['nsfw']) {
        $blurBase = $thumbDir . '/' . $image['id'] . '_blur';
        $blurExt = pathinfo($thumbFilename, PATHINFO_EXTENSION);
        $blurPath = $blurBase . '.' . $blurExt;
        if (!file_exists($blurPath)) {
            generateBlurredThumbnail($thumbPath, $blurPath);
        }
        if (file_exists($blurPath)) {
            $blurFilename = basename($blurPath);
            $validThumbFiles[] = $blurFilename;
        }
    }

    $entry = [
        'id' => $image['id'],
        'filename' => $image['filename'],
        'type' => $image['type'],
        'thumb' => '/api/image/thumb/' . rawurlencode($thumbFilename),
        'full' => '/api/image/full/' . rawurlencode($procFilename),
        'tags' => $image['tags'],
        'width' => $image['width'],
        'height' => $image['height'],
        'nsfw' => $image['nsfw'],
        'bannerHeight' => $contactEmail ? BANNER_HEIGHT : 0,
        'copyright' => $image['copyright'],
        'captureDate' => $image['captureDate'] ?? '',
        'title' => $image['title'] ?? '',
    ];
    if ($blurFilename) {
        $entry['thumbBlur'] = '/api/image/thumb/' . rawurlencode($blurFilename);
    }
    $manifest[] = $entry;
}

// Clean up stale thumbnails
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

// Clean up stale processed images
if ($processedDir) {
    $procFiles = @scandir($processedDir);
    if ($procFiles) {
        foreach ($procFiles as $f) {
            if ($f[0] === '.' || $f === '.gitkeep') continue;
            if (!in_array($f, $validProcessedFiles)) {
                @unlink($processedDir . '/' . $f);
            }
        }
    }
}

// Version hash so the client can detect manifest changes
$version = md5(json_encode(array_column($manifest, 'id')));

echo json_encode(['version' => $version, 'images' => $manifest]);
