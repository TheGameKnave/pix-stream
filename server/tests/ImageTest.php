<?php

use PHPUnit\Framework\TestCase;

class ImageTest extends TestCase
{
    private string $originals;
    private string $thumbnails;

    protected function setUp(): void
    {
        $this->originals = TEST_ORIGINALS;
        $this->thumbnails = TEST_THUMBNAILS;

        array_map('unlink', glob($this->thumbnails . '/*'));
    }

    private function createTestJpeg(int $w = 800, int $h = 600): string
    {
        $img = imagecreatetruecolor($w, $h);
        $path = $this->originals . '/test_' . uniqid() . '.jpg';
        imagejpeg($img, $path);
        unset($img);
        return $path;
    }

    private function createTestPng(int $w = 800, int $h = 600): string
    {
        $img = imagecreatetruecolor($w, $h);
        imagesavealpha($img, true);
        $path = $this->originals . '/test_' . uniqid() . '.png';
        imagepng($img, $path);
        unset($img);
        return $path;
    }

    private function createTestGif(int $w = 800, int $h = 600): string
    {
        $img = imagecreatetruecolor($w, $h);
        $path = $this->originals . '/test_' . uniqid() . '.gif';
        imagegif($img, $path);
        unset($img);
        return $path;
    }

    public function testLoadImageLoadsJpeg(): void
    {
        $path = $this->createTestJpeg();
        $gd = loadImage($path);
        $this->assertInstanceOf(\GdImage::class, $gd);
        $this->assertEquals(800, imagesx($gd));
        $this->assertEquals(600, imagesy($gd));
        imagedestroy($gd);
    }

    public function testLoadImageLoadsPng(): void
    {
        $path = $this->createTestPng();
        $gd = loadImage($path);
        $this->assertInstanceOf(\GdImage::class, $gd);
        imagedestroy($gd);
    }

    public function testLoadImageReturnsFalseForInvalidFile(): void
    {
        $path = $this->originals . '/fake.jpg';
        file_put_contents($path, 'not an image');
        $result = loadImage($path);
        $this->assertFalse($result);
    }

    public function testSavePngCreatesPngFile(): void
    {
        $img = imagecreatetruecolor(100, 100);
        $dest = $this->thumbnails . '/save_test.png';
        $ok = savePng($img, $dest);
        unset($img);

        $this->assertTrue($ok);
        $this->assertFileExists($dest);

        $info = getimagesize($dest);
        $this->assertEquals(IMAGETYPE_PNG, $info[2]);
    }

    public function testGenerateThumbnailCreatesResizedImage(): void
    {
        $source = $this->createTestJpeg(1200, 900);
        $destBase = $this->thumbnails . '/thumb_test';

        $result = generateThumbnail($source, $destBase);

        $this->assertNotFalse($result);
        $this->assertFileExists($result);
        $this->assertStringEndsWith('.jpg', $result); // JPG stays JPG

        $info = getimagesize($result);
        // Should be within 600x600 bounds
        $this->assertLessThanOrEqual(THUMB_MAX_WIDTH, $info[0]);
        $this->assertLessThanOrEqual(THUMB_MAX_HEIGHT, $info[1]);
    }

    public function testGenerateThumbnailPreservesAspectRatio(): void
    {
        $source = $this->createTestJpeg(1600, 800); // 2:1 aspect
        $destBase = $this->thumbnails . '/aspect_test';

        $result = generateThumbnail($source, $destBase);
        $info = getimagesize($result);

        $ratio = $info[0] / $info[1];
        $this->assertEqualsWithDelta(2.0, $ratio, 0.05);
    }

    public function testGenerateThumbnailSkipsResizeForSmallImages(): void
    {
        $source = $this->createTestJpeg(200, 150); // Already smaller than max
        $destBase = $this->thumbnails . '/small_test';

        $result = generateThumbnail($source, $destBase);
        $info = getimagesize($result);

        // Should keep original size
        $this->assertEquals(200, $info[0]);
        $this->assertEquals(150, $info[1]);
    }

    public function testGenerateThumbnailHandlesGif(): void
    {
        $source = $this->createTestGif(800, 600);
        $destBase = $this->thumbnails . '/gif_test';

        $result = generateThumbnail($source, $destBase);
        $this->assertNotFalse($result);
        $this->assertFileExists($result);
    }

    public function testGenerateThumbnailReturnsFalseForInvalidSource(): void
    {
        $fakePath = $this->originals . '/doesnotexist.jpg';
        $destBase = $this->thumbnails . '/fail_test';

        $result = generateThumbnail($fakePath, $destBase);
        $this->assertFalse($result);
    }

    public function testEnsureDirCreatesNestedDirectories(): void
    {
        $nested = TEST_ROOT . '/ensuredir_test/a/b/c/file.txt';
        ensureDir($nested);
        $this->assertDirectoryExists(dirname($nested));
        // cleanup
        rmdir(TEST_ROOT . '/ensuredir_test/a/b/c');
        rmdir(TEST_ROOT . '/ensuredir_test/a/b');
        rmdir(TEST_ROOT . '/ensuredir_test/a');
        rmdir(TEST_ROOT . '/ensuredir_test');
    }

}
