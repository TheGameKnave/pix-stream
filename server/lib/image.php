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
define('BANNER_HEIGHT', 50);   // Copyright banner height in pixels

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
 * If $bannerConfig is provided, composites a copyright banner at the bottom.
 *
 * $destBase should NOT include an extension.
 * $bannerConfig: ['email' => string, 'title' => string, 'copyright' => string]
 * Returns the actual output path on success, or false on failure.
 */
function generateProcessed(string $sourcePath, string $destBase, array $bannerConfig = []): string|false {
    $ext = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));

    if ($ext === 'gif') {
        $result = generateGifResized($sourcePath, $destBase . '.gif', FULL_MAX_WIDTH, FULL_MAX_HEIGHT);
        if ($result && !empty($bannerConfig['email']) && extension_loaded('imagick')) {
            $result = composeGifBanner($result, $bannerConfig);
        }
        return $result;
    }

    $format = in_array($ext, ['jpg', 'jpeg']) ? 'jpeg' : 'png';
    $destExt = $format === 'jpeg' ? '.jpg' : '.png';
    $result = generateResized($sourcePath, $destBase . $destExt, FULL_MAX_WIDTH, FULL_MAX_HEIGHT, $format);

    if ($result && !empty($bannerConfig['email'])) {
        $result = composeBanner($result, $bannerConfig, $format);
    }

    return $result;
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

/**
 * Resolve the TTF font path for banner text.
 * Uses the configured fontBody from site.json, falling back to Raleway.
 * Returns ['regular' => path, 'italic' => path|null] or null if no TTF found.
 */
function resolveBannerFonts(array $bannerConfig): ?array {
    $fontName = $bannerConfig['fontBody'] ?? 'Raleway';
    $fontsDir = realpath(__DIR__ . '/../../client/src/assets/fonts');
    if (!$fontsDir) return null;

    $regular = null;
    $italic = null;

    // Regular font — prefer static weight files over variable (variable defaults to weight 100)
    foreach ([
        "$fontName-Regular.ttf",
        "$fontName.ttf",
        "$fontName-VariableFont_wght.ttf",
    ] as $candidate) {
        $path = $fontsDir . '/' . $candidate;
        if (file_exists($path)) { $regular = $path; break; }
    }

    // Italic font — prefer static weight file
    foreach ([
        "$fontName-Italic.ttf",
        "$fontName-Italic-VariableFont_wght.ttf",
    ] as $candidate) {
        $path = $fontsDir . '/' . $candidate;
        if (file_exists($path)) { $italic = $path; break; }
    }

    // Fallback: any TTF in fonts dir
    if (!$regular) {
        $files = glob($fontsDir . '/*.ttf');
        if ($files) {
            foreach ($files as $f) {
                if (stripos($f, 'Italic') === false) { $regular = $f; break; }
            }
            if (!$regular) $regular = $files[0];
        }
    }

    return $regular ? ['regular' => $regular, 'italic' => $italic] : null;
}

/**
 * Load and scale the site logo to fit within the banner height.
 * Returns the GD image resource or null if not available.
 */
function loadBannerLogo(array $bannerConfig): ?\GdImage {
    $logoPath = $bannerConfig['siteLogo'] ?? '';
    if (!$logoPath) return null;

    // Strip query string (cache busters like ?t=123) before resolving filesystem path
    $logoPath = strtok($logoPath, '?');

    // Resolve relative /storage/ path to absolute
    $absPath = realpath(__DIR__ . '/../../' . ltrim($logoPath, '/'));
    if (!$absPath || !file_exists($absPath)) return null;

    $ext = strtolower(pathinfo($absPath, PATHINFO_EXTENSION));
    $logo = match ($ext) {
        'jpg', 'jpeg' => @imagecreatefromjpeg($absPath),
        'png' => @imagecreatefrompng($absPath),
        'gif' => @imagecreatefromgif($absPath),
        'webp' => @imagecreatefromwebp($absPath),
        default => null,
    };
    if (!$logo) return null;

    // Scale to fit banner height (full height, no padding)
    $lw = imagesx($logo);
    $lh = imagesy($logo);
    $targetH = BANNER_HEIGHT;
    $targetW = (int)round($lw * $targetH / $lh);

    $scaled = imagecreatetruecolor($targetW, $targetH);
    // Preserve transparency for PNG
    imagealphablending($scaled, false);
    imagesavealpha($scaled, true);
    $transparent = imagecolorallocatealpha($scaled, 0, 0, 0, 127);
    imagefilledrectangle($scaled, 0, 0, $targetW - 1, $targetH - 1, $transparent);
    imagealphablending($scaled, true);

    imagecopyresampled($scaled, $logo, 0, 0, 0, 0, $targetW, $targetH, $lw, $lh);
    imagedestroy($logo);
    return $scaled;
}

/**
 * Composite a copyright banner onto the bottom of a processed image.
 * Extends the canvas by BANNER_HEIGHT pixels.
 *
 * Left side: site logo (if available) or title+tagline. When copyright present, © precedes.
 * Right side: copyright notice or "Image created by <email>".
 * Text uses black/white for readability. © is full-height and semi-transparent.
 *
 * $bannerConfig keys: email, title, description, copyright, fontBody, siteLogo
 * Modifies the file in place, returns the path or false on failure.
 */
function composeBanner(string $imagePath, array $bannerConfig, string $format): string|false {
    $ext = strtolower(pathinfo($imagePath, PATHINFO_EXTENSION));
    $source = match ($ext) {
        'jpg', 'jpeg' => @imagecreatefromjpeg($imagePath),
        default => @imagecreatefrompng($imagePath),
    };
    if (!$source) return false;

    $origW = imagesx($source);
    $origH = imagesy($source);
    $newH = $origH + BANNER_HEIGHT;

    $canvas = imagecreatetruecolor($origW, $newH);
    imagealphablending($canvas, true);

    // Banner background: light warm grey
    $bannerBg = imagecolorallocate($canvas, 240, 238, 234);
    imagefilledrectangle($canvas, 0, 0, $origW - 1, $newH - 1, $bannerBg);

    // Copy original image onto the top portion
    imagecopy($canvas, $source, 0, 0, 0, 0, $origW, $origH);
    imagedestroy($source);

    // Text colors: black/white for readability
    $blackColor = imagecolorallocate($canvas, 30, 30, 30);
    $darkColor = imagecolorallocate($canvas, 80, 78, 74);
    $blueColor = imagecolorallocate($canvas, 30, 50, 140);
    $redColor = imagecolorallocate($canvas, 180, 30, 30);
    // © watermark: very faint, drawn behind everything else
    // GD alpha: 0=opaque, 127=fully transparent — 112 is ~12% visible
    $copyrightColor = imagecolorallocatealpha($canvas, 170, 168, 162, 112);

    $fonts = resolveBannerFonts($bannerConfig);
    $bannerY = $origH;
    $title = $bannerConfig['title'] ?? 'Pix Stream';
    $tagline = $bannerConfig['subtitle'] ?? '';
    $copyright = $bannerConfig['copyright'] ?? '';
    $email = $bannerConfig['email'] ?? '';

    if ($fonts) {
        $fontPath = $fonts['regular'];
        $italicPath = $fonts['italic'] ?? $fontPath;

        // Font sizes relative to banner height (50px)
        $titleSize = (int)round(BANNER_HEIGHT * 0.30);    // 15pt
        $bodySize = (int)round(BANNER_HEIGHT * 0.20);     // 10pt
        $taglineSize = (int)round(BANNER_HEIGHT * 0.18);  // 9pt
        $copyrightSymbolSize = (int)round(BANNER_HEIGHT * 0.75); // 37pt
        $margin = (int)round(BANNER_HEIGHT * 0.28);       // 14px
        $leftX = $margin;
        $symbolW = 0;

        if ($copyright) {
            // Draw © watermark FIRST — very faint, behind logo/text
            $symbolBox = imagettfbbox($copyrightSymbolSize, 0, $fontPath, '©');
            $symbolW = abs($symbolBox[2] - $symbolBox[0]);
            $symbolH = abs($symbolBox[1] - $symbolBox[7]);
            $symbolY = $bannerY + (int)((BANNER_HEIGHT + $symbolH) / 2);
            imagettftext($canvas, $copyrightSymbolSize, 0, $leftX, $symbolY, $copyrightColor, $fontPath, '©');
            // Offset logo/text to start ~70% of the way across the © symbol
            $leftX += (int)($symbolW * 0.7);
        }

        // Left side: logo or title+tagline, drawn ON TOP of the © watermark
        $logo = loadBannerLogo($bannerConfig);
        if ($logo) {
            $logoW = imagesx($logo);
            $logoH = imagesy($logo);
            imagecopy($canvas, $logo, $leftX, $bannerY, 0, 0, $logoW, $logoH);
            imagedestroy($logo);
        } elseif ($tagline) {
            // Measure both lines and center the block vertically
            $titleBox = imagettfbbox($titleSize, 0, $fontPath, $title);
            $titleH = abs($titleBox[7] - $titleBox[1]);
            $tagBox = imagettfbbox($taglineSize, 0, $italicPath, $tagline);
            $tagH = abs($tagBox[7] - $tagBox[1]);
            $gap = (int)round($titleSize * 0.25);
            $blockH = $titleH + $gap + $tagH;
            $topOffset = (int)((BANNER_HEIGHT - $blockH) / 2);
            $titleY = $bannerY + $topOffset + $titleH;
            $taglineY = $titleY + $gap + $tagH;
            imagettftext($canvas, $titleSize, 0, $leftX, $titleY, $blackColor, $fontPath, $title);
            imagettftext($canvas, $taglineSize, 0, $leftX, $taglineY, $darkColor, $italicPath, $tagline);
        } else {
            $titleBox = imagettfbbox($titleSize, 0, $fontPath, $title);
            $titleH = abs($titleBox[7] - $titleBox[1]);
            $titleY = $bannerY + (int)((BANNER_HEIGHT + $titleH) / 2);
            imagettftext($canvas, $titleSize, 0, $leftX, $titleY, $blackColor, $fontPath, $title);
        }

        // Right side
        if ($copyright) {
            $line1Pre = 'This image is ';
            $line1Word = 'copyrighted';
            $line1Post = '.';

            $preBox = imagettfbbox($bodySize, 0, $fontPath, $line1Pre);
            $preW = abs($preBox[2] - $preBox[0]);
            $wordBox = imagettfbbox($bodySize, 0, $fontPath, $line1Word);
            $wordW = abs($wordBox[2] - $wordBox[0]);
            $postBox = imagettfbbox($bodySize, 0, $fontPath, $line1Post);
            $postW = abs($postBox[2] - $postBox[0]);
            $line1TotalW = $preW + $wordW + $postW;

            $line2 = 'For usage, please contact';
            $line2Box = imagettfbbox($bodySize, 0, $fontPath, $line2);
            $line2W = abs($line2Box[2] - $line2Box[0]);

            $emailDot = "$email.";
            $emailDotBox = imagettfbbox($bodySize, 0, $fontPath, $emailDot);
            $emailDotW = abs($emailDotBox[2] - $emailDotBox[0]);

            // Measure actual line height for proper leading
            $sampleBox = imagettfbbox($bodySize, 0, $fontPath, 'Hg');
            $lineHeight = abs($sampleBox[1] - $sampleBox[7]);
            $totalTextH = $lineHeight * 3 + ($lineHeight * 0.3) * 2; // 3 lines + 2 gaps (30% leading)
            $startY = $bannerY + (int)((BANNER_HEIGHT - $totalTextH) / 2) + $lineHeight;
            $lineStep = (int)($lineHeight * 1.3);

            $line1Y = $startY;
            $line2Y = $startY + $lineStep;
            $line3Y = $startY + $lineStep * 2;

            // Right-align each line
            $l1X = $origW - $line1TotalW - $margin;
            imagettftext($canvas, $bodySize, 0, $l1X, $line1Y, $blackColor, $fontPath, $line1Pre);
            imagettftext($canvas, $bodySize, 0, $l1X + $preW, $line1Y, $redColor, $fontPath, $line1Word);
            imagettftext($canvas, $bodySize, 0, $l1X + $preW + $wordW, $line1Y, $blackColor, $fontPath, $line1Post);

            $l2X = $origW - $line2W - $margin;
            imagettftext($canvas, $bodySize, 0, $l2X, $line2Y, $blackColor, $fontPath, $line2);

            $l3X = $origW - $emailDotW - $margin;
            $emailOnlyBox = imagettfbbox($bodySize, 0, $fontPath, $email);
            $emailOnlyW = abs($emailOnlyBox[2] - $emailOnlyBox[0]);
            imagettftext($canvas, $bodySize, 0, $l3X, $line3Y, $blueColor, $fontPath, $email);
            imagettftext($canvas, $bodySize, 0, $l3X + $emailOnlyW, $line3Y, $blackColor, $fontPath, '.');
        } else {
            // No copyright: "Image created by <email>"
            $preText = 'Image created by ';
            $preBox = imagettfbbox($bodySize, 0, $fontPath, $preText);
            $preW = abs($preBox[2] - $preBox[0]);
            $emailBox = imagettfbbox($bodySize, 0, $fontPath, $email);
            $emailW = abs($emailBox[2] - $emailBox[0]);
            $totalW = $preW + $emailW;

            $rightX = $origW - $totalW - $margin;
            $textYPos = $bannerY + (int)(BANNER_HEIGHT * 0.5) + (int)($bodySize * 0.35);
            imagettftext($canvas, $bodySize, 0, $rightX, $textYPos, $blackColor, $fontPath, $preText);
            imagettftext($canvas, $bodySize, 0, $rightX + $preW, $textYPos, $blueColor, $fontPath, $email);
        }
    } else {
        // Fallback: no TTF font available — use built-in bitmap fonts
        $textColor = imagecolorallocate($canvas, 30, 30, 30);
        $leftX = 12;
        $titleY = $bannerY + (int)(BANNER_HEIGHT / 2) - 7;
        imagestring($canvas, 4, $leftX, $titleY, $title, $textColor);

        if ($copyright) {
            $rightText = "This image is copyrighted. For usage, please contact $email";
        } else {
            $rightText = "Image created by $email";
        }
        $rightW = strlen($rightText) * imagefontwidth(3);
        imagestring($canvas, 3, $origW - $rightW - 12, $bannerY + (int)(BANNER_HEIGHT / 2) - 6, $rightText, $textColor);
    }

    $save = $format === 'jpeg' ? saveJpeg($canvas, $imagePath) : savePng($canvas, $imagePath);
    imagedestroy($canvas);
    return $save ? $imagePath : false;
}

/**
 * Composite a copyright banner onto an animated GIF using Imagick.
 * Extends each frame's canvas by BANNER_HEIGHT pixels at the bottom.
 * Mirrors the same layout as composeBanner().
 */
function composeGifBanner(string $gifPath, array $bannerConfig): string|false {
    try {
        $im = new Imagick($gifPath);
        $im = $im->coalesceImages();

        $origW = $im->getImageWidth();
        $origH = $im->getImageHeight();
        $newH = $origH + BANNER_HEIGHT;

        $title = $bannerConfig['title'] ?? 'Pix Stream';
        $tagline = $bannerConfig['subtitle'] ?? '';
        $email = $bannerConfig['email'] ?? '';
        $copyright = $bannerConfig['copyright'] ?? '';
        $fonts = resolveBannerFonts($bannerConfig);
        $fontPath = $fonts ? $fonts['regular'] : null;
        $italicPath = $fonts ? ($fonts['italic'] ?? $fonts['regular']) : null;

        // Font sizes relative to banner height (same as composeBanner)
        $titleSize = (int)round(BANNER_HEIGHT * 0.30);
        $bodySize = (int)round(BANNER_HEIGHT * 0.20);
        $taglineSize = (int)round(BANNER_HEIGHT * 0.18);
        $copyrightSymbolSize = (int)round(BANNER_HEIGHT * 0.75);
        $margin = (int)round(BANNER_HEIGHT * 0.28);

        // Load logo once (Imagick version — composite from file)
        $logoPath = strtok($bannerConfig['siteLogo'] ?? '', '?') ?: '';
        $logoAbsPath = $logoPath ? realpath(__DIR__ . '/../../' . ltrim($logoPath, '/')) : null;
        $hasLogo = $logoAbsPath && file_exists($logoAbsPath);

        foreach ($im as $frame) {
            $frame->setImagePage($origW, $newH, 0, 0);
            $frame->extentImage($origW, $newH, 0, 0);

            // Banner background
            $draw = new ImagickDraw();
            $draw->setFillColor(new ImagickPixel('#f0eeea'));
            $draw->rectangle(0, $origH, $origW, $newH);
            $frame->drawImage($draw);

            $leftX = $margin;
            $symbolW = 0;

            if ($copyright) {
                // © watermark FIRST — very faint (~12% visible), behind logo/text
                $draw = new ImagickDraw();
                if ($fontPath) $draw->setFont($fontPath);
                $draw->setFillColor(new ImagickPixel('rgba(170, 168, 162, 0.12)'));
                $draw->setFontSize($copyrightSymbolSize);
                $metrics = $frame->queryFontMetrics($draw, '©');
                $symbolW = (int)($metrics['textWidth'] ?? 20);
                $symbolH = $metrics['ascender'] ?? $copyrightSymbolSize;
                $symbolY = $origH + (int)((BANNER_HEIGHT + $symbolH) / 2);
                $frame->annotateImage($draw, $leftX, $symbolY, 0, '©');
                // Offset logo/text ~70% across the © symbol
                $leftX += (int)($symbolW * 0.7);
            }

            // Left: logo or title+tagline, ON TOP of ©
            if ($hasLogo) {
                try {
                    $logoIm = new Imagick($logoAbsPath);
                    $lw = $logoIm->getImageWidth();
                    $lh = $logoIm->getImageHeight();
                    $targetH = BANNER_HEIGHT;
                    $targetW = (int)round($lw * $targetH / $lh);
                    $logoIm->resizeImage($targetW, $targetH, Imagick::FILTER_LANCZOS, 1);
                    $frame->compositeImage($logoIm, Imagick::COMPOSITE_OVER, $leftX, $origH);
                    $logoIm->destroy();
                } catch (Exception $e) {
                    $hasLogo = false;
                }
            }
            if (!$hasLogo) {
                if ($tagline) {
                    // Measure and center the title+tagline block vertically
                    $draw = new ImagickDraw();
                    if ($fontPath) $draw->setFont($fontPath);
                    $draw->setFillColor(new ImagickPixel('#1e1e1e'));
                    $draw->setFontSize($titleSize);
                    $titleM = $frame->queryFontMetrics($draw, $title);
                    $titleH = $titleM['ascender'] ?? $titleSize;

                    $drawTag = new ImagickDraw();
                    if ($italicPath) $drawTag->setFont($italicPath);
                    $drawTag->setFillColor(new ImagickPixel('#504e4a'));
                    $drawTag->setFontSize($taglineSize);
                    $tagM = $frame->queryFontMetrics($drawTag, $tagline);
                    $tagH = $tagM['ascender'] ?? $taglineSize;

                    $gap = (int)round($titleSize * 0.25);
                    $blockH = $titleH + $gap + $tagH;
                    $topOffset = (int)((BANNER_HEIGHT - $blockH) / 2);
                    $titleY = $origH + $topOffset + $titleH;
                    $taglineY = $titleY + $gap + $tagH;

                    $frame->annotateImage($draw, $leftX, $titleY, 0, $title);
                    $frame->annotateImage($drawTag, $leftX, $taglineY, 0, $tagline);
                } else {
                    $draw = new ImagickDraw();
                    if ($fontPath) $draw->setFont($fontPath);
                    $draw->setFillColor(new ImagickPixel('#1e1e1e'));
                    $draw->setFontSize($titleSize);
                    $titleM = $frame->queryFontMetrics($draw, $title);
                    $titleH = $titleM['ascender'] ?? $titleSize;
                    $titleY = $origH + (int)((BANNER_HEIGHT + $titleH) / 2);
                    $frame->annotateImage($draw, $leftX, $titleY, 0, $title);
                }
            }

            // Right side
            if ($copyright) {
                $draw = new ImagickDraw();
                if ($fontPath) $draw->setFont($fontPath);
                $draw->setFontSize($bodySize);

                $preText = 'This image is ';
                $copWord = 'copyrighted';
                $postText = '.';

                $draw->setFillColor(new ImagickPixel('#1e1e1e'));
                $preM = $frame->queryFontMetrics($draw, $preText);
                $copM = $frame->queryFontMetrics($draw, $copWord);
                $postM = $frame->queryFontMetrics($draw, $postText);
                $line1W = ($preM['textWidth'] ?? 0) + ($copM['textWidth'] ?? 0) + ($postM['textWidth'] ?? 0);

                $line2 = 'For usage, please contact';
                $line2M = $frame->queryFontMetrics($draw, $line2);
                $line2W = $line2M['textWidth'] ?? 0;

                $emailDot = "$email.";
                $emailDotM = $frame->queryFontMetrics($draw, $emailDot);
                $emailDotW = $emailDotM['textWidth'] ?? 0;
                $emailM = $frame->queryFontMetrics($draw, $email);
                $emailW = $emailM['textWidth'] ?? 0;

                // Proper leading using font metrics
                $sampleM = $frame->queryFontMetrics($draw, 'Hg');
                $lineHeight = $sampleM['ascender'] ?? $bodySize;
                $totalTextH = $lineHeight * 3 + ($lineHeight * 0.3) * 2;
                $startY = $origH + (int)((BANNER_HEIGHT - $totalTextH) / 2) + $lineHeight;
                $lineStep = (int)($lineHeight * 1.3);

                $line1Y = $startY;
                $line2Y = $startY + $lineStep;
                $line3Y = $startY + $lineStep * 2;

                $l1X = $origW - $line1W - $margin;
                $frame->annotateImage($draw, max(0, $l1X), $line1Y, 0, $preText);

                $draw2 = new ImagickDraw();
                if ($fontPath) $draw2->setFont($fontPath);
                $draw2->setFontSize($bodySize);
                $draw2->setFillColor(new ImagickPixel('#b41e1e'));
                $frame->annotateImage($draw2, max(0, $l1X + ($preM['textWidth'] ?? 0)), $line1Y, 0, $copWord);

                $draw3 = new ImagickDraw();
                if ($fontPath) $draw3->setFont($fontPath);
                $draw3->setFontSize($bodySize);
                $draw3->setFillColor(new ImagickPixel('#1e1e1e'));
                $frame->annotateImage($draw3, max(0, $l1X + ($preM['textWidth'] ?? 0) + ($copM['textWidth'] ?? 0)), $line1Y, 0, $postText);

                $l2X = $origW - $line2W - $margin;
                $frame->annotateImage($draw3, max(0, $l2X), $line2Y, 0, $line2);

                $l3X = $origW - $emailDotW - $margin;
                $draw4 = new ImagickDraw();
                if ($fontPath) $draw4->setFont($fontPath);
                $draw4->setFontSize($bodySize);
                $draw4->setFillColor(new ImagickPixel('#1e328c'));
                $frame->annotateImage($draw4, max(0, $l3X), $line3Y, 0, $email);

                $draw5 = new ImagickDraw();
                if ($fontPath) $draw5->setFont($fontPath);
                $draw5->setFontSize($bodySize);
                $draw5->setFillColor(new ImagickPixel('#1e1e1e'));
                $frame->annotateImage($draw5, max(0, $l3X + $emailW), $line3Y, 0, '.');
            } else {
                $draw = new ImagickDraw();
                if ($fontPath) $draw->setFont($fontPath);
                $draw->setFontSize($bodySize);

                $preText = 'Image created by ';
                $draw->setFillColor(new ImagickPixel('#1e1e1e'));
                $preM = $frame->queryFontMetrics($draw, $preText);
                $emailM = $frame->queryFontMetrics($draw, $email);
                $totalW = ($preM['textWidth'] ?? 0) + ($emailM['textWidth'] ?? 0);
                $rX = $origW - $totalW - $margin;
                $rY = $origH + (int)(BANNER_HEIGHT * 0.5) + (int)($bodySize * 0.35);

                $frame->annotateImage($draw, max(0, $rX), $rY, 0, $preText);

                $draw2 = new ImagickDraw();
                if ($fontPath) $draw2->setFont($fontPath);
                $draw2->setFontSize($bodySize);
                $draw2->setFillColor(new ImagickPixel('#1e328c'));
                $frame->annotateImage($draw2, max(0, $rX + ($preM['textWidth'] ?? 0)), $rY, 0, $email);
            }
        }

        $im = $im->deconstructImages();
        $im->writeImages($gifPath, true);
        $im->clear();
        $im->destroy();
        return $gifPath;
    } catch (Exception $e) {
        return $gifPath; // Return unbannered if Imagick fails
    }
}
