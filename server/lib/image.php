<?php
/**
 * Image processing: converts formats and generates thumbnails.
 *
 * Supported inputs: jpg, jpeg, png, gif, webp, bmp, tiff, tif, psd.
 * Outputs: JPG → JPG, GIF → GIF, everything else → PNG.
 */

define('THUMB_MAX_WIDTH', 600);
define('THUMB_MAX_HEIGHT', 600);
define('FULL_MAX_WIDTH', 2400);
define('FULL_MAX_HEIGHT', 2400);
define('PNG_COMPRESSION', 6);  // 0-9, higher = smaller file / slower
define('JPEG_QUALITY', 85);    // 0-100
define('NSFW_BLUR_RADIUS', 30); // Gaussian blur radius for NSFW thumbnails

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
 * Save a GD resource as JPEG.
 */
function saveJpeg(\GdImage $img, string $destPath): bool {
    ensureDir($destPath);
    return imagejpeg($img, $destPath, JPEG_QUALITY);
}

/**
 * Generate a thumbnail. JPG → JPG, GIF → GIF, everything else → PNG.
 *
 * $destBase should NOT include an extension — this function appends the appropriate one.
 * Returns the actual output path on success, or false on failure.
 */
function generateThumbnail(string $sourcePath, string $destBase): string|false {
    $ext = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));

    if ($ext === 'gif') {
        return generateGifThumbnail($sourcePath, $destBase . '.gif');
    }
    if (in_array($ext, ['jpg', 'jpeg'])) {
        return generateResized($sourcePath, $destBase . '.jpg', THUMB_MAX_WIDTH, THUMB_MAX_HEIGHT, 'jpeg');
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

/**
 * Resize a GD-loadable image to fit within maxW×maxH, saving as the given format.
 * $format: 'jpeg' or 'png'. If the image already fits, converts in place without resize.
 */
function generateResized(string $sourcePath, string $destPath, int $maxW, int $maxH, string $format): string|false {
    $source = loadImage($sourcePath);
    if (!$source) return false;

    $origW = imagesx($source);
    $origH = imagesy($source);
    $ratio = min($maxW / $origW, $maxH / $origH);

    if ($ratio >= 1) {
        // No resize needed, just convert format
        $save = $format === 'jpeg' ? saveJpeg($source, $destPath) : savePng($source, $destPath);
        imagedestroy($source);
        return $save ? $destPath : false;
    }

    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);

    $dest = imagecreatetruecolor($newW, $newH);
    if ($format === 'png') {
        imagealphablending($dest, false);
        imagesavealpha($dest, true);
        $transparent = imagecolorallocatealpha($dest, 0, 0, 0, 127);
        imagefill($dest, 0, 0, $transparent);
        imagealphablending($dest, true);
    }
    imagecopyresampled($dest, $source, 0, 0, 0, 0, $newW, $newH, $origW, $origH);

    $save = $format === 'jpeg' ? saveJpeg($dest, $destPath) : savePng($dest, $destPath);
    imagedestroy($source);
    imagedestroy($dest);
    return $save ? $destPath : false;
}

/**
 * Generate a processed full-size image. JPG → JPG, GIF → GIF, everything else → PNG.
 * Resizes to fit within FULL_MAX_WIDTH × FULL_MAX_HEIGHT.
 *
 * $destBase should NOT include an extension.
 * Returns the actual output path on success, or false on failure.
 */
function generateProcessed(string $sourcePath, string $destBase): string|false {
    $ext = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));

    if ($ext === 'gif') {
        return generateGifResized($sourcePath, $destBase . '.gif', FULL_MAX_WIDTH, FULL_MAX_HEIGHT);
    }
    if (in_array($ext, ['jpg', 'jpeg'])) {
        return generateResized($sourcePath, $destBase . '.jpg', FULL_MAX_WIDTH, FULL_MAX_HEIGHT, 'jpeg');
    }

    return generateResized($sourcePath, $destBase . '.png', FULL_MAX_WIDTH, FULL_MAX_HEIGHT, 'png');
}

/**
 * Resize a GIF (preserving animation via Imagick) to fit within maxW×maxH.
 */
function generateGifResized(string $sourcePath, string $destPath, int $maxW, int $maxH): string|false {
    $info = @getimagesize($sourcePath);
    if (!$info) return false;

    [$origW, $origH] = $info;
    $ratio = min($maxW / $origW, $maxH / $origH);

    if ($ratio >= 1) {
        ensureDir($destPath);
        return copy($sourcePath, $destPath) ? $destPath : false;
    }

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

    // No Imagick — static PNG fallback
    $pngDest = preg_replace('/\.gif$/', '.png', $destPath);
    $source = @imagecreatefromgif($sourcePath);
    if (!$source) {
        ensureDir($destPath);
        return copy($sourcePath, $destPath) ? $destPath : false;
    }

    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);
    $dest = imagecreatetruecolor($newW, $newH);
    imagecopyresampled($dest, $source, 0, 0, 0, 0, $newW, $newH, $origW, $origH);

    $ok = savePng($dest, $pngDest);
    imagedestroy($source);
    imagedestroy($dest);
    return $ok ? $pngDest : false;
}

/**
 * Generate a blurred variant of an existing thumbnail for NSFW work-safe mode.
 * Uses Imagick if available (true Gaussian blur), falls back to GD box blur.
 * Returns the output path on success, or false on failure.
 */
function generateBlurredThumbnail(string $thumbPath, string $destPath): string|false {
    $ext = strtolower(pathinfo($thumbPath, PATHINFO_EXTENSION));

    // Imagick path: true Gaussian blur, handles GIF frames too
    if (extension_loaded('imagick')) {
        try {
            $im = new Imagick($thumbPath);
            if ($ext === 'gif') {
                $im = $im->coalesceImages();
                foreach ($im as $frame) {
                    $frame->blurImage(NSFW_BLUR_RADIUS, NSFW_BLUR_RADIUS / 2);
                }
                $im = $im->deconstructImages();
                ensureDir($destPath);
                $im->writeImages($destPath, true);
            } else {
                $im->blurImage(NSFW_BLUR_RADIUS, NSFW_BLUR_RADIUS / 2);
                ensureDir($destPath);
                $im->writeImage($destPath);
            }
            $im->clear();
            $im->destroy();
            return $destPath;
        } catch (Exception $e) {}
    }

    // GD fallback: repeated box blur (approximates Gaussian)
    if ($ext === 'gif') {
        $source = @imagecreatefromgif($thumbPath);
    } else {
        $source = @imagecreatefrompng($thumbPath);
    }
    if (!$source) return false;

    // Downscale → upscale for a fast, heavy blur effect
    $w = imagesx($source);
    $h = imagesy($source);
    $smallW = max(1, (int)($w / 10));
    $smallH = max(1, (int)($h / 10));

    $small = imagecreatetruecolor($smallW, $smallH);
    imagecopyresampled($small, $source, 0, 0, 0, 0, $smallW, $smallH, $w, $h);

    $blurred = imagecreatetruecolor($w, $h);
    imagecopyresampled($blurred, $small, 0, 0, 0, 0, $w, $h, $smallW, $smallH);

    imagedestroy($source);
    imagedestroy($small);

    ensureDir($destPath);
    $ok = savePng($blurred, $destPath);
    imagedestroy($blurred);
    return $ok ? $destPath : false;
}
