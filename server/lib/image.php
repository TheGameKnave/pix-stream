<?php
/**
 * Image processing: converts all formats to PNG (preserving alpha) or GIF
 * (preserving animation), generates thumbnails, and composes banners.
 *
 * Supported inputs: jpg, jpeg, png, gif, webp, bmp, tiff, tif, psd.
 * Outputs: GIF → GIF, everything else → PNG.
 */

define('THUMB_MAX_WIDTH', 600);
define('THUMB_MAX_HEIGHT', 600);
define('PNG_COMPRESSION', 6); // 0-9, higher = smaller file / slower

function ensureDir(string $path): void {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
}

/**
 * Load any supported image format into a GD resource.
 * For formats GD can't handle natively (PSD, TIFF), falls back to Imagick.
 * Returns the GD resource or false on failure.
 */
function loadImage(string $sourcePath): \GdImage|false {
    $info = @getimagesize($sourcePath);

    // Try GD native loaders first
    if ($info) {
        $source = match ($info[2]) {
            IMAGETYPE_JPEG => @imagecreatefromjpeg($sourcePath),
            IMAGETYPE_PNG => @imagecreatefrompng($sourcePath),
            IMAGETYPE_GIF => @imagecreatefromgif($sourcePath),
            IMAGETYPE_WEBP => @imagecreatefromwebp($sourcePath),
            IMAGETYPE_BMP => @imagecreatefrombmp($sourcePath),
            default => false,
        };
        if ($source) return $source;
    }

    // Fallback: Imagick for TIFF, PSD, and anything GD can't read
    if (extension_loaded('imagick')) {
        try {
            $im = new Imagick($sourcePath);
            $im->setImageFormat('png');
            // Write to temp file and load into GD
            $tmp = tempnam(sys_get_temp_dir(), 'img_');
            $im->writeImage($tmp);
            $im->clear();
            $im->destroy();
            $gd = @imagecreatefrompng($tmp);
            @unlink($tmp);
            return $gd ?: false;
        } catch (Exception $e) {}
    }

    return false;
}

/**
 * Save a GD resource as PNG with alpha preservation.
 */
function savePng(\GdImage $img, string $destPath): bool {
    ensureDir($destPath);
    imagealphablending($img, false);
    imagesavealpha($img, true);
    return imagepng($img, $destPath, PNG_COMPRESSION);
}

/**
 * Generate a thumbnail. GIFs get resized as animated GIFs (via Imagick)
 * or as a static PNG fallback. Everything else becomes a PNG thumbnail.
 *
 * $destPath should NOT include an extension — this function appends .png or .gif.
 * Returns the actual output path on success, or false on failure.
 */
function generateThumbnail(string $sourcePath, string $destBase): string|false {
    $ext = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));

    if ($ext === 'gif') {
        return generateGifThumbnail($sourcePath, $destBase . '.gif');
    }

    return generatePngThumbnail($sourcePath, $destBase . '.png');
}

function generatePngThumbnail(string $sourcePath, string $destPath): string|false {
    $source = loadImage($sourcePath);
    if (!$source) return false;

    $origW = imagesx($source);
    $origH = imagesy($source);
    $ratio = min(THUMB_MAX_WIDTH / $origW, THUMB_MAX_HEIGHT / $origH);

    if ($ratio >= 1) {
        // No resize needed, just convert to PNG
        $ok = savePng($source, $destPath);
        imagedestroy($source);
        return $ok ? $destPath : false;
    }

    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);

    $thumb = imagecreatetruecolor($newW, $newH);
    // Preserve alpha in the new canvas
    imagealphablending($thumb, false);
    imagesavealpha($thumb, true);
    $transparent = imagecolorallocatealpha($thumb, 0, 0, 0, 127);
    imagefill($thumb, 0, 0, $transparent);
    imagealphablending($thumb, true);

    imagecopyresampled($thumb, $source, 0, 0, 0, 0, $newW, $newH, $origW, $origH);

    $ok = savePng($thumb, $destPath);
    imagedestroy($source);
    imagedestroy($thumb);
    return $ok ? $destPath : false;
}

function generateGifThumbnail(string $sourcePath, string $destPath): string|false {
    $info = @getimagesize($sourcePath);
    if (!$info) return false;

    [$origW, $origH] = $info;
    $ratio = min(THUMB_MAX_WIDTH / $origW, THUMB_MAX_HEIGHT / $origH);

    if ($ratio >= 1) {
        ensureDir($destPath);
        return copy($sourcePath, $destPath) ? $destPath : false;
    }

    // Imagick: resize all frames preserving animation
    if (extension_loaded('imagick')) {
        try {
            $im = new Imagick($sourcePath);
            $im = $im->coalesceImages();
            foreach ($im as $frame) {
                $frame->resizeImage(
                    (int)($origW * $ratio),
                    (int)($origH * $ratio),
                    Imagick::FILTER_LANCZOS,
                    1
                );
                $frame->setImagePage(0, 0, 0, 0);
            }
            $im = $im->deconstructImages();
            ensureDir($destPath);
            $im->writeImages($destPath, true);
            $im->clear();
            $im->destroy();
            return $destPath;
        } catch (Exception $e) {}
    }

    // No Imagick — static PNG fallback from first frame
    $pngDest = preg_replace('/\.gif$/', '.png', $destPath);
    $source = @imagecreatefromgif($sourcePath);
    if (!$source) {
        ensureDir($destPath);
        return copy($sourcePath, $destPath) ? $destPath : false;
    }

    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);
    $thumb = imagecreatetruecolor($newW, $newH);
    imagecopyresampled($thumb, $source, 0, 0, 0, 0, $newW, $newH, $origW, $origH);

    $ok = savePng($thumb, $pngDest);
    imagedestroy($source);
    imagedestroy($thumb);
    return $ok ? $pngDest : false;
}
