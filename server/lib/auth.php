<?php
/**
 * Simple password-based admin auth.
 * Password set on first admin visit, stored as bcrypt hash.
 */

$passwordFile = __DIR__ . '/../config/.password';

function passwordExists(): bool {
    global $passwordFile;
    return file_exists($passwordFile) && strlen(trim(file_get_contents($passwordFile))) > 0;
}

function setPassword(string $password): void {
    global $passwordFile;
    file_put_contents($passwordFile, password_hash($password, PASSWORD_DEFAULT));
}

function verifyPassword(string $password): bool {
    global $passwordFile;
    if (!passwordExists()) return false;
    $hash = trim(file_get_contents($passwordFile));
    return password_verify($password, $hash);
}

function startSession(): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    $_SESSION['admin'] = true;
}

function destroySession(): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    $_SESSION = [];
    session_destroy();
}

function isAuthenticated(): bool {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    return !empty($_SESSION['admin']);
}

function requireAuth(): void {
    if (!isAuthenticated()) {
        http_response_code(401);
        echo json_encode(['error' => 'Authentication required']);
        exit;
    }
}
