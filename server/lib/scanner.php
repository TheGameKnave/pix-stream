<?php
/**
 * Filesystem image scanner.
 * Scans originals directory and reads metadata.
 */

/** Supported original extensions (case-insensitive). */
const SCAN_EXTENSIONS = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'psd',
];

function scanImages(string $dir): array {
    $images = [];

    // Glob doesn't handle case-insensitive matching well across all platforms,
    // so scan directory and filter by extension.
    $all = @scandir($dir);
    if (!$all) return $images;

    foreach ($all as $filename) {
        if ($filename[0] === '.') continue;
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        if (!in_array($ext, SCAN_EXTENSIONS)) continue;

        $file = $dir . '/' . $filename;
        if (!is_file($file)) continue;

        $id = pathinfo($filename, PATHINFO_FILENAME);
        $isGif = $ext === 'gif';

        // For formats GD can read, get dimensions directly
        $info = @getimagesize($file);
        $width = $info ? $info[0] : 0;
        $height = $info ? $info[1] : 0;

        // For PSD/TIFF that getimagesize may not support, try Imagick
        if (($width <= 0 || $height <= 0) && extension_loaded('imagick')) {
            try {
                $im = new Imagick($file);
                $width = $im->getImageWidth();
                $height = $im->getImageHeight();
                $im->clear();
                $im->destroy();
            } catch (Exception $e) {}
        }

        // Output type after processing: GIF stays GIF, everything else becomes PNG
        $outType = $isGif ? 'image/gif' : 'image/png';

        $meta = loadMetadata($id);
        $canReadExif = in_array($ext, ['jpg', 'jpeg', 'tiff', 'tif']);
        $exifTags = $canReadExif ? readExifTags($file) : [];

        // Tags: prefer metadata JSON, fall back to IPTC keywords (excluding 'nsfw')
        $tags = $meta['tags'] ?? array_values(array_filter($exifTags, fn($t) => strtolower($t) !== 'nsfw'));
        // NSFW: metadata JSON takes precedence, then check IPTC keywords
        $nsfw = $meta['nsfw'] ?? in_array('nsfw', array_map('strtolower', $exifTags));

        $images[] = [
            'id' => $id,
            'filename' => $filename,
            'path' => $file,
            'type' => $outType,
            'width' => $width,
            'height' => $height,
            'tags' => $tags,
            'nsfw' => $nsfw,
            'copyright' => $meta['copyright'] ?? ($canReadExif ? readExifCopyright($file) : ''),
        ];
    }

    return $images;
}

function loadMetadata(string $imageId): array {
    $metaFile = realpath(__DIR__ . '/../../storage/metadata') . '/' . $imageId . '.json';
    if (file_exists($metaFile)) {
        $data = json_decode(file_get_contents($metaFile), true);
        return is_array($data) ? $data : [];
    }
    return [];
}

function readExifTags(string $file): array {
    $exif = @exif_read_data($file, 'IFD0', true);
    if (!$exif) return [];

    // Try to extract keywords from IPTC
    $iptc = [];
    getimagesize($file, $info);
    if (isset($info['APP13'])) {
        $iptcData = iptcparse($info['APP13']);
        if (isset($iptcData['2#025'])) {
            $iptc = $iptcData['2#025'];
        }
    }

    return $iptc;
}

function readExifCopyright(string $file): string {
    $exif = @exif_read_data($file, 'IFD0');
    return $exif['Copyright'] ?? '';
}

function getAllTags(string $metadataDir, string $originalsDir = ''): array {
    $tags = [];

    // Collect from metadata JSON files
    $files = glob($metadataDir . '/*.json');
    if ($files) {
        foreach ($files as $file) {
            $meta = json_decode(file_get_contents($file), true);
            if (isset($meta['tags']) && is_array($meta['tags'])) {
                foreach ($meta['tags'] as $tag) {
                    $tags[$tag] = true;
                }
            }
        }
    }

    // Collect from IPTC keywords in originals (for images without metadata JSON)
    if ($originalsDir && is_dir($originalsDir)) {
        $scanned = scanImages($originalsDir);
        foreach ($scanned as $img) {
            foreach ($img['tags'] as $tag) {
                $tags[$tag] = true;
            }
        }
    }

    // Exclude 'nsfw' — it's a flag, not a filter category
    unset($tags['nsfw']);

    $result = array_keys($tags);
    sort($result);
    return $result;
}
