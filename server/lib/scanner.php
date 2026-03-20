<?php
/**
 * Filesystem image scanner.
 * Scans originals directory and reads metadata.
 */

function scanImages(string $dir): array {
    $images = [];
    $files = glob($dir . '/*.{jpg,jpeg,JPG,JPEG,gif,GIF}', GLOB_BRACE);

    if (!$files) return $images;

    foreach ($files as $file) {
        $filename = basename($file);
        $id = pathinfo($filename, PATHINFO_FILENAME);
        $info = @getimagesize($file);

        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $isJpeg = in_array($ext, ['jpg', 'jpeg']);
        $mime = $isJpeg ? 'image/jpeg' : 'image/gif';

        $meta = loadMetadata($id);
        $exifTags = $isJpeg ? readExifTags($file) : [];

        $images[] = [
            'id' => $id,
            'filename' => $filename,
            'path' => $file,
            'type' => $mime,
            'width' => $info ? $info[0] : 0,
            'height' => $info ? $info[1] : 0,
            'tags' => $meta['tags'] ?? $exifTags,
            'nsfw' => $meta['nsfw'] ?? false,
            'copyright' => $meta['copyright'] ?? ($isJpeg ? readExifCopyright($file) : ''),
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

function getAllTags(string $metadataDir): array {
    $tags = [];
    $files = glob($metadataDir . '/*.json');
    if (!$files) return $tags;

    foreach ($files as $file) {
        $meta = json_decode(file_get_contents($file), true);
        if (isset($meta['tags']) && is_array($meta['tags'])) {
            foreach ($meta['tags'] as $tag) {
                if (!in_array($tag, $tags)) {
                    $tags[] = $tag;
                }
            }
        }
    }

    sort($tags);
    return $tags;
}
