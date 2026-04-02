<?php
/**
 * Filesystem image scanner.
 * Scans originals directory and reads EXIF/IPTC data.
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

        // Output type after processing: JPG → JPG, GIF → GIF, everything else → PNG
        $isJpeg = in_array($ext, ['jpg', 'jpeg']);
        $outType = $isGif ? 'image/gif' : ($isJpeg ? 'image/jpeg' : 'image/png');

        $canReadExif = in_array($ext, ['jpg', 'jpeg', 'tiff', 'tif']);
        $exifTags = $canReadExif ? readExifTags($file) : [];

        $tags = array_values(array_filter($exifTags, fn($t) => strtolower($t) !== 'nsfw'));
        $nsfw = in_array('nsfw', array_map('strtolower', $exifTags));

        $images[] = [
            'id' => $id,
            'filename' => $filename,
            'path' => $file,
            'type' => $outType,
            'width' => $width,
            'height' => $height,
            'tags' => $tags,
            'nsfw' => $nsfw,
            'copyright' => $canReadExif ? readExifCopyright($file) : '',
            'captureDate' => $canReadExif ? readExifDate($file) : '',
            'title' => $canReadExif ? readExifTitle($file) : '',
            'description' => $canReadExif ? readExifDescription($file) : '',
        ];
    }

    return $images;
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

function readExifDate(string $file): string {
    $exif = @exif_read_data($file, 'EXIF');
    return $exif['DateTimeOriginal'] ?? $exif['DateTime'] ?? '';
}

function readExifTitle(string $file): string {
    getimagesize($file, $info);
    if (!empty($info['APP13'])) {
        $iptcData = iptcparse($info['APP13']);
        // 2#005 = Object Name (Title)
        if (isset($iptcData['2#005'][0])) {
            return trim($iptcData['2#005'][0]);
        }
    }
    return '';
}

function readExifDescription(string $file): string {
    getimagesize($file, $info);
    if (!empty($info['APP13'])) {
        $iptcData = iptcparse($info['APP13']);
        // 2#120 = Caption/Abstract (Description)
        if (isset($iptcData['2#120'][0])) {
            return trim($iptcData['2#120'][0]);
        }
    }
    // Fall back to EXIF ImageDescription
    $exif = @exif_read_data($file, 'IFD0');
    return $exif['ImageDescription'] ?? '';
}

function getAllTags(string $originalsDir): array {
    $tags = [];

    if ($originalsDir && is_dir($originalsDir)) {
        $scanned = scanImages($originalsDir);
        foreach ($scanned as $img) {
            foreach ($img['tags'] as $tag) {
                $tags[$tag] = true;
            }
        }
    }

    $result = array_keys($tags);
    sort($result);
    return $result;
}
