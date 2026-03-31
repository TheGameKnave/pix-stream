<?php
/**
 * Favicon utilities — convert images to ICO format.
 */

/**
 * Convert a raster image (GD resource) to a minimal ICO file (32x32 PNG-in-ICO).
 */
function gdToIco(GdImage $src): string {
    $ico32 = imagecreatetruecolor(32, 32);
    imagealphablending($ico32, false);
    imagesavealpha($ico32, true);
    $transparent = imagecolorallocatealpha($ico32, 0, 0, 0, 127);
    imagefill($ico32, 0, 0, $transparent);
    imagecopyresampled($ico32, $src, 0, 0, 0, 0, 32, 32, imagesx($src), imagesy($src));

    ob_start();
    imagepng($ico32);
    $pngData = ob_get_clean();

    // Build minimal ICO file: ICONDIR + ICONDIRENTRY + PNG data
    $icoData = pack('vvv', 0, 1, 1);
    $entryOffset = 6 + 16;
    $icoData .= pack('CCCCvvVV', 32, 32, 0, 0, 1, 32, strlen($pngData), $entryOffset);
    $icoData .= $pngData;

    return $icoData;
}

/**
 * Convert an SVG file to ICO by rasterizing via GD.
 * Falls back to a simple 32x32 placeholder if Imagick is unavailable.
 */
/**
 * Copy an SVG to the favicon location as-is (browsers support SVG favicons).
 */
function svgToFavicon(string $svgPath, string $destDir): string {
    $dest = $destDir . '/favicon.svg';
    copy($svgPath, $dest);
    return $dest;
}

/**
 * Write the default favicon.ico from the source SVG.
 * @param string $destPath Full path to write favicon.ico
 */
/**
 * Write the default favicon (both SVG and ICO) to the server root.
 * The SVG is copied as-is. The ICO is a minimal 1x1 transparent placeholder
 * so /favicon.ico always resolves — browsers that support SVG will prefer the
 * <link rel="icon" type="image/svg+xml"> tag instead.
 * @param string $destDir Directory to write favicons into (e.g. server/)
 */
function writeDefaultFavicon(string $destDir): void {
    $candidates = [
        __DIR__ . '/../../client/src/favicon.svg',
        __DIR__ . '/../../client/dist/pix-stream/browser/favicon.svg',
    ];
    foreach ($candidates as $c) {
        $resolved = realpath($c);
        if ($resolved && is_file($resolved)) {
            copy($resolved, $destDir . '/favicon.svg');
            return;
        }
    }
}

