<?php
/**
 * GET /api/health — lightweight liveness check (public)
 *
 * Proves PHP is executing, not just that static files are served.
 * The client connectivity service polls this endpoint.
 */

header('Content-Type: application/json');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');

echo json_encode(['ok' => true]);
