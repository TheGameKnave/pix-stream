<?php
/**
 * Entry point for /photo/:slug requests.
 * Injects Open Graph meta tags into index.html for social-media link previews,
 * then serves the page so Angular bootstraps normally in the browser.
 */

require_once __DIR__ . '/og-inject.php';

$slug = $_GET['slug'] ?? '';
$slug = urldecode(basename($slug)); // sanitise: single path segment only

// Resolve index.html from the document root
$docRoot = rtrim($_SERVER['DOCUMENT_ROOT'] ?? __DIR__ . '/..', '/');
$indexPath = $docRoot . '/index.html';

if (!$slug || !serveWithOgTags($slug, $indexPath)) {
    // No match — serve plain index.html so Angular handles it
    header('Content-Type: text/html; charset=UTF-8');
    readfile($indexPath);
}
