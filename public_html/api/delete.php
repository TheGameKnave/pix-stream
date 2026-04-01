<?php
/**
 * DELETE /api/delete?id=<filename> — delete an image (requires auth)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'DELETE') {
    http_response_code(405);
    exit;
}

require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/storage.php';
requireAuth();

$id = $_GET['id'] ?? '';
if (!$id) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing image id']);
    exit;
}

// Sanitize — only allow safe filename characters
$id = basename($id);
$storageDir = storagePath();
if (!$storageDir) {
    http_response_code(500);
    echo json_encode(['error' => 'Storage directory not found']);
    exit;
}

$removed = [];

// Remove original
foreach (glob($storageDir . '/originals/' . $id . '*') as $file) {
    if (basename($file) === $id || preg_match('/^' . preg_quote($id, '/') . '$/', basename($file))) {
        unlink($file);
        $removed[] = $file;
    }
}

// Remove generated thumbnails and processed versions
$base = pathinfo($id, PATHINFO_FILENAME);
foreach (['thumbnails', 'processed'] as $dir) {
    foreach (glob($storageDir . '/' . $dir . '/' . $base . '*') as $file) {
        unlink($file);
        $removed[] = $file;
    }
}

if (count($removed) === 0) {
    http_response_code(404);
    echo json_encode(['error' => 'Image not found']);
    exit;
}

echo json_encode(['deleted' => $id, 'files' => count($removed)]);
