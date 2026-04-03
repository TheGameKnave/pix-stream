<?php

use PHPUnit\Framework\TestCase;

/**
 * Integration tests that start a PHP dev server and hit endpoints via curl.
 * @group api
 */
class ApiTest extends TestCase
{
    /** @var resource|null */
    private static $serverProc = null;
    private static int $port = 0;

    public static function setUpBeforeClass(): void
    {
        self::$port = 9100 + (getmypid() % 900);

        // Create storage dirs and test image if needed
        $originals = __DIR__ . '/../../storage/originals';
        $thumbnails = __DIR__ . '/../../storage/thumbnails';
        if (!is_dir($originals)) mkdir($originals, 0755, true);
        if (!is_dir($thumbnails)) mkdir($thumbnails, 0755, true);
        $originals = realpath($originals);
        if (!file_exists($originals . '/_apitest.jpg')) {
            $img = imagecreatetruecolor(200, 150);
            imagejpeg($img, $originals . '/_apitest.jpg');
            imagedestroy($img);
        }

        $projectRoot = realpath(__DIR__ . '/../..');
        $serverDir = realpath(__DIR__ . '/..');

        $cmd = sprintf(
            'php -S 127.0.0.1:%d -t %s %s/router.php',
            self::$port,
            escapeshellarg($serverDir),
            escapeshellarg($serverDir),
        );

        $pipes = [];
        self::$serverProc = proc_open(
            $cmd, [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes,
            $projectRoot,
        );

        if (!is_resource(self::$serverProc)) {
            self::fail('Could not start PHP dev server');
        }

        // Wait for server to accept connections
        for ($i = 0; $i < 50; $i++) {
            $sock = @fsockopen('127.0.0.1', self::$port, $errno, $errstr, 0.1);
            if ($sock) { fclose($sock); return; }
            usleep(100_000);
        }
        self::fail('PHP dev server did not start on port ' . self::$port);
    }

    public static function tearDownAfterClass(): void
    {
        if (is_resource(self::$serverProc)) {
            $status = proc_get_status(self::$serverProc);
            if ($status['running'] && $status['pid']) {
                posix_kill($status['pid'], SIGTERM);
            }
            proc_close(self::$serverProc);
        }
        // Clean up test image
        $originals = __DIR__ . '/../../storage/originals';
        $testImg = $originals . '/_apitest.jpg';
        if (file_exists($testImg)) @unlink($testImg);
        // Clean up its thumbnail
        $thumbDir = __DIR__ . '/../../storage/thumbnails';
        if (is_dir($thumbDir)) @unlink($thumbDir . '/_apitest.png');
    }

    private function get(string $path): array
    {
        $ch = curl_init('http://127.0.0.1:' . self::$port . $path);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ['code' => $code, 'body' => $body, 'json' => json_decode($body, true)];
    }

    public function testManifestReturnsJsonWithVersionAndImages(): void
    {
        $res = $this->get('/api/manifest');
        $this->assertEquals(200, $res['code']);
        $this->assertArrayHasKey('version', $res['json']);
        $this->assertArrayHasKey('images', $res['json']);
        $this->assertNotEmpty($res['json']['version']);
    }

    public function testManifestImagesHaveRequiredFields(): void
    {
        $res = $this->get('/api/manifest');
        $this->assertNotEmpty($res['json']['images']);
        $image = $res['json']['images'][0];
        foreach (['id', 'filename', 'type', 'thumb', 'full', 'tags', 'width', 'height', 'nsfw', 'copyright'] as $field) {
            $this->assertArrayHasKey($field, $image, "Missing field: $field");
        }
    }

    public function testManifestImageDimensionsArePositive(): void
    {
        $res = $this->get('/api/manifest');
        foreach ($res['json']['images'] as $image) {
            $this->assertGreaterThan(0, $image['width'], "Image {$image['id']} has zero width");
            $this->assertGreaterThan(0, $image['height'], "Image {$image['id']} has zero height");
        }
    }

    public function testStatusReturnsServerCapabilities(): void
    {
        $res = $this->get('/api/status');
        $this->assertEquals(200, $res['code']);
        $this->assertArrayHasKey('php', $res['json']);
        $this->assertArrayHasKey('gd', $res['json']);
    }

    public function testAuthStatusReturnsAuthState(): void
    {
        $res = $this->get('/api/auth/status');
        $this->assertEquals(200, $res['code']);
        $this->assertArrayHasKey('authenticated', $res['json']);
        $this->assertArrayHasKey('setupRequired', $res['json']);
    }

    public function testConfigReturnsJson(): void
    {
        $res = $this->get('/api/config');
        $this->assertEquals(200, $res['code']);
        $this->assertIsArray($res['json']);
    }

    public function testTagsReturnsArray(): void
    {
        $res = $this->get('/api/tags');
        $this->assertEquals(200, $res['code']);
        $this->assertIsArray($res['json']);
    }

    public function testThumbnailUrlIsAccessible(): void
    {
        $manifest = $this->get('/api/manifest');
        $this->assertNotEmpty($manifest['json']['images']);

        $thumbUrl = $manifest['json']['images'][0]['thumb'];
        $res = $this->get($thumbUrl);
        $this->assertEquals(200, $res['code']);
        $this->assertNotEmpty($res['body']);
    }
}
