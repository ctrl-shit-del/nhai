export interface ImageFrame {
  width: number;
  height: number;
  data: Uint8Array;
  channels: 1 | 3 | 4;
}

export interface CLAHEOptions {
  tileSize?: number;
  clipLimit?: number;
}

export class CLAHEPreprocessor {
  constructor(private readonly options: CLAHEOptions = {}) {}

  preprocess(frame: ImageFrame): ImageFrame {
    const tileSize = this.options.tileSize ?? 8;
    const clipLimit = this.options.clipLimit ?? 2.0;

    if (frame.channels !== 1) {
      return this.normalizeRgb(frame, tileSize, clipLimit);
    }

    return {
      ...frame,
      data: this.equalizeGrayscale(frame.data, tileSize, clipLimit)
    };
  }

  private normalizeRgb(frame: ImageFrame, tileSize: number, clipLimit: number): ImageFrame {
    const output = new Uint8Array(frame.data);
    const luminance = new Uint8Array(frame.width * frame.height);

    for (let pixel = 0; pixel < luminance.length; pixel += 1) {
      const offset = pixel * frame.channels;
      luminance[pixel] = Math.round(
        0.299 * frame.data[offset] +
          0.587 * frame.data[offset + 1] +
          0.114 * frame.data[offset + 2]
      );
    }

    const adjusted = this.equalizeGrayscale(luminance, tileSize, clipLimit);

    for (let pixel = 0; pixel < adjusted.length; pixel += 1) {
      const offset = pixel * frame.channels;
      const gain = luminance[pixel] === 0 ? 1 : adjusted[pixel] / luminance[pixel];
      output[offset] = Math.min(255, Math.round(frame.data[offset] * gain));
      output[offset + 1] = Math.min(255, Math.round(frame.data[offset + 1] * gain));
      output[offset + 2] = Math.min(255, Math.round(frame.data[offset + 2] * gain));
    }

    return { ...frame, data: output };
  }

  private equalizeGrayscale(data: Uint8Array, tileSize: number, clipLimit: number): Uint8Array {
    const histogram = new Array<number>(256).fill(0);
    for (const value of data) histogram[value] += 1;

    const maxBin = Math.max(1, Math.floor((data.length / 256) * clipLimit * tileSize));
    let clipped = 0;
    for (let index = 0; index < histogram.length; index += 1) {
      if (histogram[index] > maxBin) {
        clipped += histogram[index] - maxBin;
        histogram[index] = maxBin;
      }
    }

    const redistribute = Math.floor(clipped / 256);
    for (let index = 0; index < histogram.length; index += 1) {
      histogram[index] += redistribute;
    }

    const cdf = new Array<number>(256).fill(0);
    cdf[0] = histogram[0];
    for (let index = 1; index < cdf.length; index += 1) {
      cdf[index] = cdf[index - 1] + histogram[index];
    }

    const cdfMin = cdf.find((value) => value > 0) ?? 0;
    const output = new Uint8Array(data.length);
    const denominator = Math.max(1, data.length - cdfMin);

    for (let index = 0; index < data.length; index += 1) {
      output[index] = Math.max(0, Math.min(255, Math.round(((cdf[data[index]] - cdfMin) / denominator) * 255)));
    }

    return output;
  }
}
