<?php
/**
 * GET  /api/update?check=1 — check if updates are available
 * POST /api/update          — pull latest from GitHub and update
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/../lib/auth.php';
requireAuth();

// Version file tracks the current deployed commit
$versionFile = __DIR__ . '/../config/.version';
$currentVersion = file_exists($versionFile) ? trim(file_get_contents($versionFile)) : 'unknown';

// GitHub repo info
$repo = 'TheGameKnave/pix-stream';
$branch = 'main';
$apiUrl = "https://api.github.com/repos/$repo/commits/$branch";

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['check'])) {
    // Check for updates by comparing local version to latest GitHub commit
    $ctx = stream_context_create(['http' => [
        'header' => "User-Agent: PixStream\r\n",
        'timeout' => 10,
    ]]);
    $response = @file_get_contents($apiUrl, false, $ctx);
    if (!$response) {
        echo json_encode(['available' => false, 'current' => $currentVersion, 'latest' => 'unknown', 'error' => 'Could not reach GitHub']);
        exit;
    }
    $data = json_decode($response, true);
    $latestSha = substr($data['sha'] ?? '', 0, 7);
    $available = $currentVersion !== $latestSha && $latestSha !== '';

    echo json_encode(['available' => $available, 'current' => $currentVersion, 'latest' => $latestSha]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    set_time_limit(120);

    // Download the latest archive from GitHub
    $zipUrl = "https://github.com/$repo/archive/refs/heads/$branch.zip";
    $tmpZip = tempnam(sys_get_temp_dir(), 'pixstream_update_');
    $ctx = stream_context_create(['http' => [
        'header' => "User-Agent: PixStream\r\n",
        'timeout' => 60,
    ]]);
    $zipData = @file_get_contents($zipUrl, false, $ctx);
    if (!$zipData) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Failed to download update from GitHub']);
        exit;
    }
    file_put_contents($tmpZip, $zipData);

    // Extract the zip
    $zip = new ZipArchive();
    if ($zip->open($tmpZip) !== true) {
        unlink($tmpZip);
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Failed to open downloaded archive']);
        exit;
    }

    $tmpDir = $tmpZip . '_extracted';
    mkdir($tmpDir, 0755, true);
    $zip->extractTo($tmpDir);
    $zip->close();
    unlink($tmpZip);

    // Find the build output directory inside the archive
    // The archive contains: pix-stream-main/public_html/
    $archiveRoot = glob($tmpDir . '/pix-stream-*')[0] ?? null;
    $buildDir = $archiveRoot ? $archiveRoot . '/public_html' : null;

    if (!$buildDir || !is_dir($buildDir)) {
        // Clean up
        exec('rm -rf ' . escapeshellarg($tmpDir));
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Build output not found in archive. Build public_html/ before pushing to GitHub.']);
        exit;
    }

    // Copy build files to public_html, skipping storage/ and config/
    $publicHtml = realpath(__DIR__ . '/..');
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($buildDir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iterator as $item) {
        $relativePath = substr($item->getPathname(), strlen($buildDir) + 1);

        // Skip storage and config directories
        if (str_starts_with($relativePath, 'storage/') || str_starts_with($relativePath, 'config/')) {
            continue;
        }

        $destPath = $publicHtml . '/' . $relativePath;

        if ($item->isDir()) {
            if (!is_dir($destPath)) {
                mkdir($destPath, 0755, true);
            }
        } else {
            // Ensure parent directory exists
            $parentDir = dirname($destPath);
            if (!is_dir($parentDir)) {
                mkdir($parentDir, 0755, true);
            }
            copy($item->getPathname(), $destPath);
        }
    }

    // Clean up temp files
    exec('rm -rf ' . escapeshellarg($tmpDir));

    // Update version file
    $latestCtx = stream_context_create(['http' => [
        'header' => "User-Agent: PixStream\r\n",
        'timeout' => 10,
    ]]);
    $commitData = @file_get_contents($apiUrl, false, $latestCtx);
    if ($commitData) {
        $commit = json_decode($commitData, true);
        $sha = substr($commit['sha'] ?? 'unknown', 0, 7);
        file_put_contents($versionFile, $sha);
    }

    echo json_encode(['success' => true, 'message' => 'Updated successfully!']);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
