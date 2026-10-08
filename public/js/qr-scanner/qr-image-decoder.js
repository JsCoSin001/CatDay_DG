(function (global) {
  "use strict";

  class QrImageDecoder {
    constructor(options) {
      const opts = options || {};
      this.formats = Array.isArray(opts.formats) && opts.formats.length
        ? opts.formats.slice()
        : ["qr_code"];
      this.detector = this.createNativeDetector();
    }

    isSupported() {
      return this.detector !== null || typeof global.jsQR === "function";
    }

    async decodeFile(file) {
      if (!(file instanceof Blob)) {
        throw new Error("Không đọc được ảnh QR đã chọn.");
      }

      if (this.detector) {
        const nativeValue = await this.decodeWithNativeDetector(file);
        if (nativeValue) {
          return nativeValue.trim();
        }
      }

      const fallbackValue = await this.decodeWithJsQr(file);
      if (!fallbackValue) {
        throw new Error("Không tìm thấy QR hợp lệ trong ảnh vừa chọn.");
      }

      return fallbackValue.trim();
    }

    createNativeDetector() {
      if (typeof global.BarcodeDetector !== "function") {
        return null;
      }

      try {
        return new global.BarcodeDetector({ formats: this.formats });
      } catch (_) {
        return null;
      }
    }

    async decodeWithNativeDetector(file) {
      if (!this.detector || typeof global.createImageBitmap !== "function") {
        return null;
      }

      const bitmap = await global.createImageBitmap(file);
      try {
        const results = await this.detector.detect(bitmap);
        const value = results && results[0] ? results[0].rawValue : null;
        return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
      } catch (_) {
        return null;
      } finally {
        if (typeof bitmap.close === "function") {
          bitmap.close();
        }
      }
    }

    async decodeWithJsQr(file) {
      if (typeof global.jsQR !== "function") {
        throw new Error(
          "Chưa nạp jsQR cục bộ. Hãy chạy tools/install-vendor-dependencies trước khi dùng đọc QR từ ảnh.",
        );
      }

      const imageData = await this.readImageData(file);
      return this.tryDecodeCandidates(imageData);
    }

    async readImageData(file) {
      const image = await this.loadImage(file);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });

      if (!context) {
        throw new Error("Trình duyệt không hỗ trợ đọc dữ liệu ảnh QR.");
      }

      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    }

    tryDecodeCandidates(imageData) {
      const candidates = this.buildCandidates(imageData);
      for (const candidate of candidates) {
        const value = this.tryDecodeImageData(candidate);
        if (value) {
          return value;
        }
      }
      return null;
    }

    buildCandidates(imageData) {
      const candidates = [];
      const seen = new Set();
      const pushCandidate = (candidate) => {
        const sampleIndexes = [
          0,
          Math.max(0, Math.floor(candidate.data.length / 4)),
          Math.max(0, Math.floor(candidate.data.length / 2)),
          Math.max(0, candidate.data.length - 4),
        ];
        const signature = sampleIndexes
          .map((index) => `${candidate.data[index] || 0}-${candidate.data[index + 1] || 0}-${candidate.data[index + 2] || 0}`)
          .join("|");
        const key = `${candidate.width}x${candidate.height}:${candidate.data.length}:${signature}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(candidate);
        }
      };

      pushCandidate(imageData);
      for (const region of this.buildRegions(imageData.width, imageData.height)) {
        pushCandidate(this.cropImageData(imageData, region));
      }

      const baseCandidates = candidates.slice();
      for (const candidate of baseCandidates) {
        if (candidate.width < 1400) {
          [1.25, 1.5, 1.75, 2, 2.5].forEach((scale) => {
            pushCandidate(this.scaleImageData(candidate, scale));
          });
        }
      }
      return candidates;
    }

    buildRegions(width, height) {
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const makeRegion = (x, y, w, h) => ({
        x: clamp(Math.round(x), 0, width - 1),
        y: clamp(Math.round(y), 0, height - 1),
        width: clamp(Math.round(w), 1, width),
        height: clamp(Math.round(h), 1, height),
      });

      return [
        makeRegion(0, 0, width, height),
        makeRegion(width * 0.08, height * 0.08, width * 0.84, height * 0.84),
        makeRegion(width * 0.16, height * 0.16, width * 0.68, height * 0.68),
        makeRegion(width * 0.22, height * 0.22, width * 0.56, height * 0.56),
        makeRegion(width * 0.1, height * 0.22, width * 0.58, height * 0.42),
        makeRegion(width * 0.32, height * 0.22, width * 0.58, height * 0.42),
        makeRegion(width * 0.18, height * 0.08, width * 0.64, height * 0.44),
        makeRegion(width * 0.18, height * 0.34, width * 0.64, height * 0.44),
        makeRegion(0, 0, width * 0.7, height * 0.7),
        makeRegion(width * 0.3, 0, width * 0.7, height * 0.7),
        makeRegion(0, height * 0.3, width * 0.7, height * 0.7),
        makeRegion(width * 0.3, height * 0.3, width * 0.7, height * 0.7),
      ];
    }

    cropImageData(imageData, region) {
      const width = Math.min(region.width, imageData.width - region.x);
      const height = Math.min(region.height, imageData.height - region.y);
      const data = new Uint8ClampedArray(width * height * 4);

      for (let y = 0; y < height; y += 1) {
        const sourceStart = ((region.y + y) * imageData.width + region.x) * 4;
        const targetStart = y * width * 4;
        data.set(imageData.data.subarray(sourceStart, sourceStart + width * 4), targetStart);
      }
      return new ImageData(data, width, height);
    }

    scaleImageData(imageData, scale) {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = imageData.width;
      sourceCanvas.height = imageData.height;
      const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!sourceContext) {
        return imageData;
      }
      sourceContext.putImageData(imageData, 0, 0);

      const targetCanvas = document.createElement("canvas");
      targetCanvas.width = Math.max(1, Math.round(imageData.width * scale));
      targetCanvas.height = Math.max(1, Math.round(imageData.height * scale));
      const targetContext = targetCanvas.getContext("2d", { willReadFrequently: true });
      if (!targetContext) {
        return imageData;
      }
      targetContext.imageSmoothingEnabled = false;
      targetContext.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
      return targetContext.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
    }

    tryDecodeImageData(imageData) {
      const variants = [
        imageData,
        this.createGrayscaleBoostVariant(imageData),
        this.createHighContrastVariant(imageData),
        this.createThresholdVariant(imageData, 110),
        this.createThresholdVariant(imageData, 140),
        this.createThresholdVariant(imageData, 200),
      ];

      for (const variant of variants) {
        const result = global.jsQR(variant.data, variant.width, variant.height, {
          inversionAttempts: "attemptBoth",
        });
        if (result && typeof result.data === "string" && result.data.trim() !== "") {
          return result.data.trim();
        }
      }
      return null;
    }

    createGrayscaleBoostVariant(imageData) {
      const data = new Uint8ClampedArray(imageData.data);
      for (let index = 0; index < data.length; index += 4) {
        const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
        const boosted = Math.max(0, Math.min(255, (luminance - 128) * 1.35 + 128));
        data[index] = boosted;
        data[index + 1] = boosted;
        data[index + 2] = boosted;
        data[index + 3] = 255;
      }
      return new ImageData(data, imageData.width, imageData.height);
    }

    createHighContrastVariant(imageData) {
      const data = new Uint8ClampedArray(imageData.data);
      for (let index = 0; index < data.length; index += 4) {
        const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
        const value = luminance > 170 ? 255 : 0;
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
        data[index + 3] = 255;
      }
      return new ImageData(data, imageData.width, imageData.height);
    }

    createThresholdVariant(imageData, threshold) {
      const data = new Uint8ClampedArray(imageData.data);
      for (let index = 0; index < data.length; index += 4) {
        const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
        const value = luminance >= threshold ? 255 : 0;
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
        data[index + 3] = 255;
      }
      return new ImageData(data, imageData.width, imageData.height);
    }

    loadImage(file) {
      return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Không mở được ảnh QR đã chọn."));
        };
        image.src = objectUrl;
      });
    }
  }

  global.QrImageDecoder = QrImageDecoder;
})(typeof window !== "undefined" ? window : globalThis);
