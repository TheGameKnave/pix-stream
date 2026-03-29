<?php
/**
 * Serves the favicon from the site root.
 * Handles both /favicon.ico and /favicon.svg requests.
 * Prefers ICO if it exists, otherwise serves SVG with correct content type.
 */

$serverRoot = __DIR__ . '/..';
$icoPath = $serverRoot . '/favicon.ico';
$svgPath = $serverRoot . '/favicon.svg';

// Prefer ICO (uploaded raster favicons)
if (file_exists($icoPath)) {
    header('Content-Type: image/x-icon');
    header('Cache-Control: public, max-age=86400');
    readfile($icoPath);
    exit;
}

// Fall back to SVG (default or uploaded SVG)
if (file_exists($svgPath)) {
    header('Content-Type: image/svg+xml');
    header('Cache-Control: public, max-age=86400');
    readfile($svgPath);
    exit;
}

// Nothing exists — generate default SVG
require_once __DIR__ . '/../lib/favicon.php';
writeDefaultFavicon($serverRoot);

if (file_exists($svgPath)) {
    header('Content-Type: image/svg+xml');
    header('Cache-Control: public, max-age=86400');
    readfile($svgPath);
    exit;
}

http_response_code(404);
