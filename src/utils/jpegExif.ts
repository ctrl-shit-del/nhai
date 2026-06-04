/** Read JPEG EXIF orientation tag (1–8). Returns 1 when absent or unknown. */
export function readJpegExifOrientation(jpegBytes: Uint8Array): number {
  if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
    return 1;
  }

  let offset = 2;
  while (offset + 4 < jpegBytes.length) {
    if (jpegBytes[offset] !== 0xff) break;

    const marker = jpegBytes[offset + 1];
    if (marker === 0xd9) break;

    const length = (jpegBytes[offset + 2] << 8) | jpegBytes[offset + 3];
    if (length < 2 || offset + 2 + length > jpegBytes.length) break;

    if (marker === 0xe1) {
      const exifStart = offset + 4;
      if (
        exifStart + 6 <= jpegBytes.length &&
        jpegBytes[exifStart] === 0x45 && // E
        jpegBytes[exifStart + 1] === 0x78 && // x
        jpegBytes[exifStart + 2] === 0x69 && // i
        jpegBytes[exifStart + 3] === 0x66 // f
      ) {
        const tiffStart = exifStart + 6;
        if (tiffStart + 8 > jpegBytes.length) return 1;

        const littleEndian =
          jpegBytes[tiffStart] === 0x49 && jpegBytes[tiffStart + 1] === 0x49;
        const readU16 = (pos: number) =>
          littleEndian
            ? jpegBytes[pos] | (jpegBytes[pos + 1] << 8)
            : (jpegBytes[pos] << 8) | jpegBytes[pos + 1];
        const readU32 = (pos: number) =>
          littleEndian
            ? (jpegBytes[pos] |
                (jpegBytes[pos + 1] << 8) |
                (jpegBytes[pos + 2] << 16) |
                (jpegBytes[pos + 3] << 24)) >>>
              0
            : ((jpegBytes[pos] << 24) |
                (jpegBytes[pos + 1] << 16) |
                (jpegBytes[pos + 2] << 8) |
                jpegBytes[pos + 3]) >>>
              0;

        const ifd0Offset = tiffStart + readU32(tiffStart + 4);
        if (ifd0Offset + 2 > jpegBytes.length) return 1;

        const numEntries = readU16(ifd0Offset);
        for (let i = 0; i < numEntries; i++) {
          const entry = ifd0Offset + 2 + i * 12;
          if (entry + 12 > jpegBytes.length) break;
          if (readU16(entry) === 0x0112) {
            return readU16(entry + 8) || 1;
          }
        }
      }
    }

    offset += 2 + length;
  }

  return 1;
}
