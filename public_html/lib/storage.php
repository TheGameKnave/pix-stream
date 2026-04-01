<?php
/**
 * Resolve the storage directory path.
 *
 * In dev:  server/api/ → server/lib/ → ../../storage  (project root)
 * In prod: public_html/api/ → public_html/lib/ → ../storage  (inside public_html)
 *
 * We try ../storage first (prod layout), then ../../storage (dev layout).
 */

function storagePath(string $subdir = ''): string {
    $suffix = $subdir ? '/' . ltrim($subdir, '/') : '';

    // Detect environment: in dev, lib/ is inside server/ which has a sibling client/ dir.
    // In prod, lib/ is inside public_html/ with no client/ sibling.
    $isDev = is_dir(__DIR__ . '/../../client');

    if ($isDev) {
        // Dev: storage is at project root, two levels up from server/lib/
        $path = realpath(__DIR__ . '/../../storage' . $suffix);
        if ($path) return $path;
        // Create if missing
        $path = __DIR__ . '/../../storage' . $suffix;
        mkdir($path, 0755, true);
        return $path;
    }

    // Prod: storage is a sibling of lib/ (inside public_html)
    $path = realpath(__DIR__ . '/../storage' . $suffix);
    if ($path) return $path;
    // Create if missing
    $path = __DIR__ . '/../storage' . $suffix;
    mkdir($path, 0755, true);
    return $path;
}
