<?php

use PHPUnit\Framework\TestCase;

class ScannerTest extends TestCase
{
    private string $originals;

    protected function setUp(): void
    {
        $this->originals = TEST_ORIGINALS;

        // Clean directories
        array_map('unlink', glob($this->originals . '/*'));
    }

    private function createTestJpeg(string $name, int $w = 100, int $h = 80): string
    {
        $img = imagecreatetruecolor($w, $h);
        $path = $this->originals . '/' . $name;
        imagejpeg($img, $path);
        unset($img);
        return $path;
    }

    private function createTestPng(string $name, int $w = 100, int $h = 80): string
    {
        $img = imagecreatetruecolor($w, $h);
        $path = $this->originals . '/' . $name;
        imagepng($img, $path);
        unset($img);
        return $path;
    }

    public function testScanImagesFindsJpeg(): void
    {
        $this->createTestJpeg('photo1.jpg');
        $results = scanImages($this->originals);

        $this->assertCount(1, $results);
        $this->assertEquals('photo1', $results[0]['id']);
        $this->assertEquals('photo1.jpg', $results[0]['filename']);
        $this->assertEquals('image/jpeg', $results[0]['type']); // JPG stays JPG
        $this->assertEquals(100, $results[0]['width']);
        $this->assertEquals(80, $results[0]['height']);
    }

    public function testScanImagesFindsMultipleFormats(): void
    {
        $this->createTestJpeg('a.jpg');
        $this->createTestPng('b.png');

        $results = scanImages($this->originals);
        $this->assertCount(2, $results);

        $ids = array_column($results, 'id');
        $this->assertContains('a', $ids);
        $this->assertContains('b', $ids);
    }

    public function testScanImagesSkipsHiddenFiles(): void
    {
        $this->createTestJpeg('.hidden.jpg');
        $results = scanImages($this->originals);
        $this->assertCount(0, $results);
    }

    public function testScanImagesSkipsUnsupportedExtensions(): void
    {
        file_put_contents($this->originals . '/readme.txt', 'not an image');
        $results = scanImages($this->originals);
        $this->assertCount(0, $results);
    }

    public function testScanImagesReturnsEmptyForMissingDir(): void
    {
        $results = scanImages('/nonexistent/path/xyz');
        $this->assertCount(0, $results);
    }

    public function testScanImagesIncludesDefaultFields(): void
    {
        $this->createTestJpeg('test.jpg');
        $results = scanImages($this->originals);

        $this->assertIsArray($results[0]['tags']);
        $this->assertFalse($results[0]['nsfw']);
        $this->assertIsString($results[0]['copyright']);
    }

    public function testGetAllTagsReturnsEmptyForNoImages(): void
    {
        $tags = getAllTags($this->originals);
        $this->assertEmpty($tags);
    }

    public function testGetAllTagsReturnsEmptyForMissingDir(): void
    {
        $tags = getAllTags('/nonexistent/path/xyz');
        $this->assertEmpty($tags);
    }
}
