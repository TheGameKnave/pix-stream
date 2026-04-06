<?php
/**
 * Router for PHP built-in development server.
 * Maps clean URLs to PHP scripts (replaces .htaccess for dev).
 *
 * Usage: php -S localhost:8080 -t server/ server/router.php
 */

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// API routes
$routes = [
    '/api/manifest'   => '/api/manifest.php',
    '/api/config'     => '/api/config.php',
    '/api/upload'     => '/api/upload.php',
    '/api/tags'       => '/api/tags.php',
    '/api/status'     => '/api/status.php',
    '/api/logo'       => '/api/logo.php',
    '/api/favicon'    => '/api/favicon.php',
    '/api/watermark'  => '/api/watermark.php',
    '/api/delete'     => '/api/delete.php',
    '/api/update'     => '/api/update.php',
];

// Exact match
if (isset($routes[$uri])) {
    require __DIR__ . $routes[$uri];
    return true;
}

// Auth routes: /api/auth/login, /api/auth/setup, etc.
if (preg_match('#^/api/auth/(.+)$#', $uri, $matches)) {
    $_SERVER['PATH_INFO'] = '/' . $matches[1];
    require __DIR__ . '/api/auth.php';
    return true;
}

// Serve images from storage
function serveImage(string $filePath): bool {
    $file = realpath($filePath);
    if ($file && is_file($file)) {
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'gif' => 'image/gif',
            'png' => 'image/png',
            'webp' => 'image/webp',
            default => 'image/jpeg',
        };
        header('Content-Type: ' . $mime);
        header('Cache-Control: public, max-age=2592000');
        readfile($file);
        return true;
    }
    return false;
}

if (preg_match('#^/api/image/thumb/(.+)$#', $uri, $matches)) {
    $name = basename(urldecode($matches[1]));
    if (!serveImage(__DIR__ . '/../storage/thumbnails/' . $name)) {
        if (!serveImage(__DIR__ . '/../storage/thumbnails/' . $name . '.jpg')) {
            http_response_code(404);
        }
    }
    return true;
}

if (preg_match('#^/api/image/full/(.+)$#', $uri, $matches)) {
    $name = basename(urldecode($matches[1]));
    if (!serveImage(__DIR__ . '/../storage/processed/' . $name)) {
        // Fall back to originals if processed version doesn't exist yet
        if (!serveImage(__DIR__ . '/../storage/originals/' . $name)) {
            http_response_code(404);
        }
    }
    return true;
}

// Serve files from /storage/ (logo, favicon, watermark)
if (preg_match('#^/storage/(.+)$#', $uri, $matches)) {
    $file = realpath(__DIR__ . '/../storage/' . $matches[1]);
    if ($file && is_file($file)) {
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $mimes = [
            'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
            'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml',
            'ico' => 'image/x-icon',
        ];
        header('Content-Type: ' . ($mimes[$ext] ?? 'application/octet-stream'));
        header('Cache-Control: public, max-age=2592000');
        readfile($file);
        return true;
    }
    http_response_code(404);
    return true;
}

// Photo deep-link: inject OG meta tags for social-media previews
if (preg_match('#^/photo/(.+)$#', $uri, $matches)) {
    $_GET['slug'] = urldecode($matches[1]);
    require __DIR__ . '/lib/photo-og.php';
    return true;
}

// Serve favicon at domain root — browsers request this automatically for every page
if ($uri === '/favicon.ico' || $uri === '/favicon.svg') {
    require __DIR__ . '/api/serve-favicon.php';
    return true;
}

// Block access to config/lib
if (preg_match('#^/(config|lib)/#', $uri)) {
    http_response_code(403);
    return true;
}

// Let PHP built-in server handle static files
return false;
