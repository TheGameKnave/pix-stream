<?php
/**
 * File-backed per-IP rate limiting (shared hosting: no DB or cache daemon).
 *
 * Each bucket is a JSON array of failure timestamps, one file per IP, under
 * config/ratelimit/ — config/ is blocked from the web by both router.php and
 * .htaccess, unlike storage/, which is publicly served.
 */

$rateLimitDir = __DIR__ . '/../config/ratelimit';

function rateLimitFile(string $bucket): string {
    global $rateLimitDir;
    if (!is_dir($rateLimitDir)) {
        mkdir($rateLimitDir, 0755, true);
    }
    // REMOTE_ADDR, not X-Forwarded-For — the latter is caller-controlled
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    return $rateLimitDir . '/' . $bucket . '-' . hash('sha256', $ip) . '.json';
}

function rateLimitFailures(string $bucket, int $windowSeconds): array {
    $raw = @file_get_contents(rateLimitFile($bucket));
    $times = $raw ? (json_decode($raw, true) ?: []) : [];
    $cutoff = time() - $windowSeconds;
    return array_values(array_filter($times, fn ($t) => is_int($t) && $t > $cutoff));
}

function isRateLimited(string $bucket, int $maxFailures, int $windowSeconds): bool {
    return count(rateLimitFailures($bucket, $windowSeconds)) >= $maxFailures;
}

/** Seconds until the oldest failure in the window ages out. */
function rateLimitRetryAfter(string $bucket, int $windowSeconds): int {
    $times = rateLimitFailures($bucket, $windowSeconds);
    if (!$times) return 1;
    return max(1, min($times) + $windowSeconds - time());
}

function recordRateLimitFailure(string $bucket, int $windowSeconds): void {
    $times = rateLimitFailures($bucket, $windowSeconds);
    $times[] = time();
    file_put_contents(rateLimitFile($bucket), json_encode($times), LOCK_EX);
}

function clearRateLimit(string $bucket): void {
    $file = rateLimitFile($bucket);
    if (file_exists($file)) {
        unlink($file);
    }
}
