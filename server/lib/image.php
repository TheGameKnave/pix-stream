<?php
/**
 * Image processing: thumbnail generation and copyright banner composition.
 * Uses Imagick for animated GIFs when available, GD for JPEGs.
 */

define('THUMB_MAX_WIDTH', 600);
define('THUMB_MAX_HEIGHT', 600);
define('THUMB_QUALITY', 80);

function ensureDir(string $path): void {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
}

function generateThumbnail(string $sourcePath, string $destPath): bool {
    $info = @getimagesize($sourcePath);
    if (!$info) return false;

    $ext = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));

    if (in_array($ext, ['gif'])) {
        return generateGifThumbnail($sourcePath, $destPath, $info);
    }

    return generateJpegThumbnail($sourcePath, $destPath, $info);
}

function generateJpegThumbnail(string $sourcePath, string $destPath, array $info): bool {
    [$origW, $origH] = $info;
    $ratio = min(THUMB_MAX_WIDTH / $origW, THUMB_MAX_HEIGHT / $origH);

    if ($ratio >= 1) {
        return copy($sourcePath, $destPath);
    }

    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);

    // Detect actual image type regardless of extension
    $source = match ($info[2]) {
        IMAGETYPE_PNG => @imagecreatefrompng($sourcePath),
        IMAGETYPE_GIF => @imagecreatefromgif($sourcePath),
        IMAGETYPE_WEBP => @imagecreatefromwebp($sourcePath),
        default => @imagecreatefromjpeg($sourcePath),
    };
    if (!$source) return false;

    $thumb = imagecreatetruecolor($newW, $newH);
    imagecopyresampled($thumb, $source, 0, 0, 0, 0, $newW, $newH, $origW, $origH);

    ensureDir($destPath);
    $result = imagejpeg($thumb, $destPath, THUMB_QUALITY);

    imagedestroy($source);
    imagedestroy($thumb);

    return $result;
}

function generateGifThumbnail(string $sourcePath, string $destPath, array $info): bool {
    [$origW, $origH] = $info;
    $ratio = min(THUMB_MAX_WIDTH / $origW, THUMB_MAX_HEIGHT / $origH);

    if ($ratio >= 1) {
        return copy($sourcePath, $destPath);
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
            return true;
        } catch (Exception $e) {
            // Fall through to copy
        }
    }

    // No Imagick — extract first frame as static JPEG thumbnail via GD
    $source = imagecreatefromgif($sourcePath);
    if (!$source) {
        ensureDir($destPath);
        return copy($sourcePath, $destPath);
    }

    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);
    $thumb = imagecreatetruecolor($newW, $newH);
    imagecopyresampled($thumb, $source, 0, 0, 0, 0, $newW, $newH, $origW, $origH);

    // Save as JPEG with .gif.jpg extension so the router knows the mime type
    $jpgDest = $destPath . '.jpg';
    ensureDir($jpgDest);
    $result = imagejpeg($thumb, $jpgDest, THUMB_QUALITY);

    imagedestroy($source);
    imagedestroy($thumb);

    return $result;
}

function composeWithBanner(string $sourcePath, string $bannerPath, string $destPath): bool {
    $source = imagecreatefromjpeg($sourcePath);
    if (!$source) return false;

    $banner = imagecreatefrompng($bannerPath);
    if (!$banner) {
        $banner = imagecreatefromjpeg($bannerPath);
    }
    if (!$banner) {
        imagedestroy($source);
        return false;
    }

    $srcW = imagesx($source);
    $srcH = imagesy($source);
    $banW = imagesx($banner);
    $banH = imagesy($banner);

    // Scale banner to image width
    $scaledBanH = (int)($banH * ($srcW / $banW));
    $scaledBanner = imagecreatetruecolor($srcW, $scaledBanH);
    imagealphablending($scaledBanner, false);
    imagesavealpha($scaledBanner, true);
    imagecopyresampled($scaledBanner, $banner, 0, 0, 0, 0, $srcW, $scaledBanH, $banW, $banH);

    // Overlay banner at bottom of image
    imagealphablending($source, true);
    $y = $srcH - $scaledBanH;
    imagecopy($source, $scaledBanner, 0, $y, 0, 0, $srcW, $scaledBanH);

    ensureDir($destPath);
    $result = imagejpeg($source, $destPath, 90);

    imagedestroy($source);
    imagedestroy($banner);
    imagedestroy($scaledBanner);

    return $result;
}
