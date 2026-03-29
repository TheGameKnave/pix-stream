<?php
/**
 * POST /api/upload — upload one or more images (requires auth)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

require_once __DIR__ . '/../lib/auth.php';
requireAuth();

$uploadDir = realpath(__DIR__ . '/../../storage/originals');
if (!$uploadDir) {
    $uploadDir = __DIR__ . '/../../storage/originals';
    mkdir($uploadDir, 0755, true);
}

$uploaded = [];
$errors = [];

if (!isset($_FILES['images'])) {
    http_response_code(400);
    echo json_encode(['error' => 'No files provided']);
    exit;
}

$files = $_FILES['images'];
$count = is_array($files['name']) ? count($files['name']) : 1;

for ($i = 0; $i < $count; $i++) {
    $name = is_array($files['name']) ? $files['name'][$i] : $files['name'];
    $tmpName = is_array($files['tmp_name']) ? $files['tmp_name'][$i] : $files['tmp_name'];
    $error = is_array($files['error']) ? $files['error'][$i] : $files['error'];

    if ($error !== UPLOAD_ERR_OK) {
        $errors[] = "$name: upload error $error";
        continue;
    }

    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!in_array($ext, ['jpg', 'jpeg', 'gif', 'png', 'webp'])) {
        $errors[] = "$name: only JPG, PNG, GIF, and WebP files are supported";
        continue;
    }

    $info = @getimagesize($tmpName);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_GIF, IMAGETYPE_PNG, IMAGETYPE_WEBP])) {
        $errors[] = "$name: not a valid image file";
        continue;
    }

    $safeName = preg_replace('/[^a-zA-Z0-9._-]/', '_', $name);
    $dest = $uploadDir . '/' . $safeName;

    // Avoid overwriting
    if (file_exists($dest)) {
        $safeName = pathinfo($safeName, PATHINFO_FILENAME) . '_' . time() . '.' . $ext;
        $dest = $uploadDir . '/' . $safeName;
    }

    if (move_uploaded_file($tmpName, $dest)) {
        $uploaded[] = $safeName;
    } else {
        $errors[] = "$name: failed to save";
    }
}

echo json_encode([
    'uploaded' => $uploaded,
    'errors' => $errors,
]);
