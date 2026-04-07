<?php
/**
 * Open Graph meta tag injection for /photo/:slug URLs.
 *
 * Reads index.html, looks up the matching image from the manifest cache
 * or originals directory, and injects og:title, og:description, og:image,
 * og:url, and og:type meta tags so social-media crawlers see real content.
 *
 * Falls back to the unmodified index.html if no match is found.
 */

require_once __DIR__ . '/storage.php';

function slugify(string $text): string {
    return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($text)), '-');
}

/**
 * Build a lightweight manifest from originals (no thumbnail generation).
 * Returns array of ['id' => ..., 'title' => ..., 'description' => ..., 'tags' => [...], 'thumb' => ...]
 */
function loadImageIndex(): array {
    require_once __DIR__ . '/scanner.php';

    $storageDir = storagePath('originals');
    if (!$storageDir || !is_dir($storageDir)) return [];

    $thumbDir = storagePath('thumbnails');
    $processedDir = storagePath('processed');
    $images = scanImages($storageDir);
    $result = [];

    foreach ($images as $img) {
        if ($img['width'] <= 0 || $img['height'] <= 0) continue;

        $ext = strtolower(pathinfo($img['filename'], PATHINFO_EXTENSION));
        $isJpeg = in_array($ext, ['jpg', 'jpeg']);
        $isGif = $ext === 'gif';

        // Find the thumbnail URL (same logic as manifest.php)
        $thumbBase = $thumbDir . '/' . $img['id'];
        $thumbFile = $isGif ? $thumbBase . '.gif' : ($isJpeg ? $thumbBase . '.jpg' : $thumbBase . '.png');
        if (!file_exists($thumbFile)) {
            // Try fallback extensions
            foreach ($isGif ? ['.png'] : ($isJpeg ? ['.png', '.gif'] : ['.jpg', '.gif']) as $fe) {
                if (file_exists($thumbBase . $fe)) { $thumbFile = $thumbBase . $fe; break; }
            }
        }
        $thumbUrl = file_exists($thumbFile)
            ? '/api/image/thumb/' . rawurlencode(basename($thumbFile))
            : '';

        // Find the processed/full image URL
        $procBase = $processedDir . '/' . $img['id'];
        $procFile = $isGif ? $procBase . '.gif' : ($isJpeg ? $procBase . '.jpg' : $procBase . '.png');
        if (!file_exists($procFile)) {
            foreach ($isGif ? ['.png'] : ($isJpeg ? ['.png', '.gif'] : ['.jpg', '.gif']) as $fe) {
                if (file_exists($procBase . $fe)) { $procFile = $procBase . $fe; break; }
            }
        }
        $fullUrl = file_exists($procFile)
            ? '/api/image/full/' . rawurlencode(basename($procFile))
            : '/api/image/full/' . rawurlencode($img['filename']);

        $result[] = [
            'id'          => $img['id'],
            'title'       => $img['title'] ?? '',
            'description' => $img['description'] ?? '',
            'tags'        => $img['tags'],
            'thumb'       => $thumbUrl,
            'full'        => $fullUrl,
            'width'       => $img['width'],
            'height'      => $img['height'],
        ];
    }

    return $result;
}

function findImageBySlug(string $slug, array $images): ?array {
    foreach ($images as $img) {
        $titleSlug = slugify($img['title'] ?: $img['id']);
        if ($titleSlug === $slug || $img['id'] === $slug || $img['title'] === $slug) {
            return $img;
        }
    }
    return null;
}

/**
 * Serve index.html with OG meta tags injected for the given photo slug.
 * Returns true if served, false if slug didn't match (caller should serve plain index.html).
 */
function serveWithOgTags(string $slug, string $indexPath): bool {
    $html = @file_get_contents($indexPath);
    if (!$html) return false;

    $images = loadImageIndex();
    $match = findImageBySlug($slug, $images);
    if (!$match) return false;

    // Read site config for the site title
    $isDev = is_dir(__DIR__ . '/../../client');
    $configPath = $isDev
        ? __DIR__ . '/../config/site.json'
        : __DIR__ . '/../config/site.json';
    $siteConfig = file_exists($configPath) ? json_decode(file_get_contents($configPath), true) : [];
    $siteTitle = $siteConfig['title'] ?? 'Pix Stream';

    // Build absolute URL from request
    $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $origin = $proto . '://' . $host;

    $photoTitle = $match['title'] ?: $match['id'];
    $ogTitle = htmlspecialchars($siteTitle . ' | ' . $photoTitle, ENT_QUOTES, 'UTF-8');
    $ogDescription = htmlspecialchars($match['description'] ?: $siteTitle, ENT_QUOTES, 'UTF-8');
    $ogImage = $origin . ($match['thumb'] ?: $match['full']);
    $ogUrl = $origin . '/photo/' . rawurlencode($slug);
    $keywords = !empty($match['tags']) ? htmlspecialchars(implode(', ', $match['tags']), ENT_QUOTES, 'UTF-8') : '';

    // Calculate thumbnail dimensions (max 600x600, preserving aspect ratio)
    $thumbMax = 600;
    $ratio = min($thumbMax / $match['width'], $thumbMax / $match['height'], 1);
    $thumbW = (int) round($match['width'] * $ratio);
    $thumbH = (int) round($match['height'] * $ratio);

    $ogTags = "\n"
        . '  <!-- Open Graph / Facebook -->' . "\n"
        . '  <meta property="og:type" content="article" />' . "\n"
        . '  <meta property="og:url" content="' . $ogUrl . '" />' . "\n"
        . '  <meta property="og:title" content="' . $ogTitle . '" />' . "\n"
        . '  <meta property="og:description" content="' . $ogDescription . '" />' . "\n"
        . '  <meta property="og:image" content="' . $ogImage . '" />' . "\n"
        . '  <meta property="og:image:width" content="' . $thumbW . '" />' . "\n"
        . '  <meta property="og:image:height" content="' . $thumbH . '" />' . "\n"
        . '  <meta property="og:site_name" content="' . htmlspecialchars($siteTitle, ENT_QUOTES, 'UTF-8') . '" />' . "\n"
        . "\n"
        . '  <!-- Twitter -->' . "\n"
        . '  <meta name="twitter:card" content="summary_large_image" />' . "\n"
        . '  <meta name="twitter:url" content="' . $ogUrl . '" />' . "\n"
        . '  <meta name="twitter:title" content="' . $ogTitle . '" />' . "\n"
        . '  <meta name="twitter:description" content="' . $ogDescription . '" />' . "\n"
        . '  <meta name="twitter:image" content="' . $ogImage . '" />' . "\n";

    if ($keywords) {
        $ogTags .= '  <meta name="keywords" content="' . $keywords . '" />' . "\n";
    }

    // Replace the static title and description with photo-specific ones
    $html = preg_replace('/<title>[^<]*<\/title>/', '<title>' . $ogTitle . '</title>', $html);
    $html = preg_replace(
        '/<meta name="description" content="[^"]*"[^>]*>/',
        '<meta name="description" content="' . $ogDescription . '">',
        $html
    );

    // Inject OG tags after the description meta tag
    $html = preg_replace(
        '/(<meta name="description" content="[^"]*"[^>]*>)/',
        '$1' . $ogTags,
        $html
    );

    header('Content-Type: text/html; charset=UTF-8');
    echo $html;
    return true;
}
