<?php
/**
 * POST /api/auth/login    — authenticate with password
 * POST /api/auth/setup    — set password on first use
 * POST /api/auth/logout   — destroy session
 * GET  /api/auth/status   — check if authenticated
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

$action = basename($_SERVER['PATH_INFO'] ?? '');

switch ($action) {
    case 'status':
        echo json_encode([
            'authenticated' => isAuthenticated(),
            'setupRequired' => !passwordExists(),
        ]);
        break;

    case 'setup':
        if (passwordExists()) {
            http_response_code(403);
            echo json_encode(['error' => 'Password already set']);
            break;
        }
        $input = json_decode(file_get_contents('php://input'), true);
        $password = $input['password'] ?? '';
        if (strlen($password) < 8) {
            http_response_code(400);
            echo json_encode(['error' => 'Password must be at least 8 characters']);
            break;
        }
        setPassword($password);
        startSession();
        echo json_encode(['success' => true]);
        break;

    case 'login':
        $input = json_decode(file_get_contents('php://input'), true);
        $password = $input['password'] ?? '';
        if (verifyPassword($password)) {
            startSession();
            echo json_encode(['success' => true]);
        } else {
            http_response_code(401);
            echo json_encode(['error' => 'Invalid password']);
        }
        break;

    case 'logout':
        destroySession();
        echo json_encode(['success' => true]);
        break;

    default:
        http_response_code(404);
        echo json_encode(['error' => 'Unknown action']);
}
