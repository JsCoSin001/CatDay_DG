(function (global) {
  "use strict";

  const DEFAULT_MESSAGES = Object.freeze({
    preparing: "Đang chuẩn bị camera sau...",
    fallback: "Không mở được camera sau theo chế độ tự động. Đang thử cấu hình khác...",
    retrying: "Đang thử camera khác...",
    ready: "",
    stopped: "Đã đóng camera quét QR.",
    torchOn: "Đã bật đèn hỗ trợ.",
    torchOff: "Đã tắt đèn hỗ trợ.",
    torchUnavailable: "Camera này không hỗ trợ bật đèn.",
    libraryMissing: "Chưa nạp thư viện html5-qrcode.",
    startFailed: "Không mở được camera quét QR. Hãy kiểm tra quyền Camera và HTTPS.",
    targetMissing: "Không tìm thấy vùng hiển thị camera.",
  });

  class QrCameraScanner {
    constructor(options) {
      const opts = options || {};
      this.options = {
        element: opts.element || null,
        elementId: opts.elementId || null,
        mode: opts.mode === "continuous" ? "continuous" : "single",
        duplicateDelay: Number.isFinite(Number(opts.duplicateDelay))
          ? Math.max(0, Number(opts.duplicateDelay))
          : 1500,
        optimizeCamera: opts.optimizeCamera !== false,
        formats: Array.isArray(opts.formats) && opts.formats.length
          ? opts.formats.slice()
          : ["QR_CODE"],
        fps: Number.isFinite(Number(opts.fps)) ? Math.max(1, Number(opts.fps)) : 14,
        qrboxRatio: Number.isFinite(Number(opts.qrboxRatio))
          ? Math.min(1, Math.max(0.2, Number(opts.qrboxRatio)))
          : 0.82,
        aspectRatio: Number.isFinite(Number(opts.aspectRatio))
          ? Number(opts.aspectRatio)
          : 1,
        emitEvents: opts.emitEvents !== false,
        eventTarget: opts.eventTarget || (typeof document !== "undefined" ? document : null),
        onResult: typeof opts.onResult === "function" ? opts.onResult : null,
        onStatus: typeof opts.onStatus === "function" ? opts.onStatus : null,
        onError: typeof opts.onError === "function" ? opts.onError : null,
        onStateChange: typeof opts.onStateChange === "function" ? opts.onStateChange : null,
        messages: Object.assign({}, DEFAULT_MESSAGES, opts.messages || {}),
      };

      this.html5QrCode = null;
      this.running = false;
      this.starting = false;
      this.resultBusy = false;
      this.torchSupported = false;
      this.torchEnabled = false;
      this.lastResults = new Map();
      this.elementId = this.resolveElementId();
    }

    resolveElementId() {
      let element = this.options.element;

      if (typeof element === "string" && typeof document !== "undefined") {
        element = document.querySelector(element);
      }

      if (!element && this.options.elementId && typeof document !== "undefined") {
        element = document.getElementById(this.options.elementId);
      }

      if (!element) {
        return this.options.elementId || null;
      }

      if (!element.id) {
        element.id = `qr-camera-region-${Math.random().toString(36).slice(2, 10)}`;
      }

      this.options.element = element;
      return element.id;
    }

    getState() {
      return {
        running: this.running,
        starting: this.starting,
        mode: this.options.mode,
        torchSupported: this.torchSupported,
        torchEnabled: this.torchEnabled,
        elementId: this.elementId,
      };
    }

    async start() {
      if (this.running || this.starting) {
        return this.getState();
      }

      if (typeof global.Html5Qrcode !== "function") {
        const error = this.createError("LIBRARY_MISSING", this.options.messages.libraryMissing);
        this.emitError(error);
        throw error;
      }

      if (!this.elementId || (typeof document !== "undefined" && !document.getElementById(this.elementId))) {
        const error = this.createError("TARGET_MISSING", this.options.messages.targetMissing);
        this.emitError(error);
        throw error;
      }

      this.starting = true;
      this.emitState();
      this.emitStatus("preparing", this.options.messages.preparing, "info");
      this.clearTarget();

      const constructorConfig = { verbose: false };
      const formatsToSupport = this.resolveFormats();
      if (formatsToSupport.length) {
        constructorConfig.formatsToSupport = formatsToSupport;
      }

      this.html5QrCode = new global.Html5Qrcode(this.elementId, constructorConfig);

      const onSuccess = async (decodedText, decodedResult) => {
        await this.handleDecodedResult(decodedText, decodedResult);
      };

      const scannerConfig = {
        fps: this.options.fps,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const edge = Math.floor(
            Math.min(viewfinderWidth, viewfinderHeight) * this.options.qrboxRatio,
          );
          return { width: edge, height: edge };
        },
        disableFlip: false,
        aspectRatio: this.options.aspectRatio,
      };

      const relaxedScannerConfig = {
        fps: Math.min(this.options.fps, 12),
        disableFlip: false,
      };

      const tryStartScanner = async (cameraConfig, config) => {
        await this.html5QrCode.start(
          cameraConfig,
          config || scannerConfig,
          onSuccess,
          function () {},
        );
      };

      try {
        try {
          await tryStartScanner({ facingMode: "environment" });
        } catch (primaryError) {
          this.emitStatus("fallback", this.options.messages.fallback, "info");

          try {
            await tryStartScanner(
              { facingMode: { ideal: "environment" } },
              relaxedScannerConfig,
            );
          } catch (_) {
            this.emitStatus("retrying", this.options.messages.retrying, "info");
            const cameras = typeof global.Html5Qrcode.getCameras === "function"
              ? await global.Html5Qrcode.getCameras()
              : [];

            const backCamera =
              cameras.find((camera) => /back|rear|environment|sau/iu.test(camera.label || "")) ||
              cameras[cameras.length - 1];

            if (!backCamera || !backCamera.id) {
              throw primaryError;
            }

            try {
              await tryStartScanner(
                { deviceId: { exact: backCamera.id } },
                relaxedScannerConfig,
              );
            } catch (_) {
              await tryStartScanner(backCamera.id, relaxedScannerConfig);
            }
          }
        }

        this.running = true;
        this.starting = false;
        await this.optimizeActiveCameraTrack();
        this.emitState();
        this.emitStatus("ready", this.options.messages.ready, "info");
        return this.getState();
      } catch (cause) {
        this.starting = false;
        await this.stop({ emitStatus: false });
        const detail = cause && cause.message
          ? `${this.options.messages.startFailed} (${cause.message})`
          : this.options.messages.startFailed;
        const error = this.createError("CAMERA_START_FAILED", detail, cause);
        this.emitError(error);
        throw error;
      }
    }

    async stop(options) {
      const opts = options || {};
      const emitStatus = opts.emitStatus !== false;
      const instance = this.html5QrCode;
      const shouldStop = Boolean(instance && (this.running || this.starting));

      this.running = false;
      this.starting = false;
      this.torchSupported = false;
      this.torchEnabled = false;

      if (shouldStop && typeof instance.stop === "function") {
        try {
          await instance.stop();
        } catch (_) {
          // Camera may already have been released by the browser.
        }
      }

      if (instance && typeof instance.clear === "function") {
        try {
          await instance.clear();
        } catch (_) {
          // Clearing a released scanner is safe to ignore.
        }
      }

      this.html5QrCode = null;
      this.clearTarget();
      this.emitState();

      if (emitStatus) {
        this.emitStatus("stopped", this.options.messages.stopped, "info");
      }

      return this.getState();
    }

    async destroy() {
      await this.stop({ emitStatus: false });
      this.lastResults.clear();
    }

    async toggleTorch(forceValue) {
      if (
        !this.running ||
        !this.html5QrCode ||
        !this.torchSupported ||
        typeof this.html5QrCode.applyVideoConstraints !== "function"
      ) {
        const error = this.createError("TORCH_UNAVAILABLE", this.options.messages.torchUnavailable);
        this.emitError(error);
        throw error;
      }

      const nextValue = typeof forceValue === "boolean" ? forceValue : !this.torchEnabled;

      try {
        await this.html5QrCode.applyVideoConstraints({
          advanced: [{ torch: nextValue }],
        });
        this.torchEnabled = nextValue;
        this.emitState();
        this.emitStatus(
          nextValue ? "torch-on" : "torch-off",
          nextValue ? this.options.messages.torchOn : this.options.messages.torchOff,
          "info",
        );
        return this.torchEnabled;
      } catch (cause) {
        const error = this.createError("TORCH_UNAVAILABLE", this.options.messages.torchUnavailable, cause);
        this.emitError(error);
        throw error;
      }
    }

    async optimizeActiveCameraTrack() {
      if (
        !this.running ||
        !this.html5QrCode ||
        typeof this.html5QrCode.applyVideoConstraints !== "function"
      ) {
        this.emitState();
        return;
      }

      const capabilities = typeof this.html5QrCode.getRunningTrackCapabilities === "function"
        ? this.html5QrCode.getRunningTrackCapabilities()
        : null;
      const settings = typeof this.html5QrCode.getRunningTrackSettings === "function"
        ? this.html5QrCode.getRunningTrackSettings()
        : null;

      this.torchSupported = Boolean(capabilities && capabilities.torch);
      this.torchEnabled = Boolean(settings && settings.torch);
      this.emitState();

      if (!this.options.optimizeCamera) {
        return;
      }

      const advanced = [
        { focusMode: "continuous" },
        { focusMode: "single-shot" },
        { exposureMode: "continuous" },
      ];

      if (capabilities && capabilities.zoom && capabilities.zoom.max && capabilities.zoom.max >= 1.5) {
        const preferredZoom = Math.min(2, Math.max(1, capabilities.zoom.max * 0.45));
        advanced.push({ zoom: preferredZoom });
      }

      try {
        await this.html5QrCode.applyVideoConstraints({
          advanced,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        });
      } catch (_) {
        try {
          await this.html5QrCode.applyVideoConstraints({
            advanced,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          });
        } catch (_) {
          // Camera tuning is best-effort and must never block scanning.
        }
      }

      const refreshedSettings = typeof this.html5QrCode.getRunningTrackSettings === "function"
        ? this.html5QrCode.getRunningTrackSettings()
        : null;
      this.torchEnabled = Boolean(refreshedSettings && refreshedSettings.torch);
      this.emitState();
    }

    async handleDecodedResult(decodedText, decodedResult) {
      if (this.resultBusy) {
        return;
      }

      const text = String(decodedText == null ? "" : decodedText).trim();
      if (!text || this.isDuplicate(text)) {
        return;
      }

      this.resultBusy = true;
      const metadata = {
        source: "camera",
        scannedAt: new Date().toISOString(),
        mode: this.options.mode,
        format: this.extractFormat(decodedResult),
      };

      try {
        if (this.options.mode === "single") {
          await this.stop({ emitStatus: false });
        }
        await this.emitResult(text, metadata);
      } catch (cause) {
        const error = this.createError(
          "RESULT_HANDLER_FAILED",
          cause && cause.message ? cause.message : "Lỗi khi xử lý kết quả quét QR.",
          cause,
        );
        this.emitError(error);
      } finally {
        this.resultBusy = false;
      }
    }

    isDuplicate(text) {
      if (this.options.mode !== "continuous" || this.options.duplicateDelay <= 0) {
        return false;
      }

      const now = Date.now();
      const last = this.lastResults.get(text) || 0;
      this.lastResults.set(text, now);

      for (const [value, timestamp] of this.lastResults.entries()) {
        if (now - timestamp > Math.max(this.options.duplicateDelay * 4, 10000)) {
          this.lastResults.delete(value);
        }
      }

      return now - last < this.options.duplicateDelay;
    }

    resolveFormats() {
      const enumObject = global.Html5QrcodeSupportedFormats;
      if (!enumObject) {
        return [];
      }

      return this.options.formats
        .map((format) => {
          if (typeof format === "number") {
            return format;
          }
          const key = String(format || "").trim().toUpperCase();
          return Object.prototype.hasOwnProperty.call(enumObject, key)
            ? enumObject[key]
            : null;
        })
        .filter((format) => format !== null && format !== undefined);
    }

    extractFormat(decodedResult) {
      return (
        decodedResult?.result?.format?.formatName ||
        decodedResult?.result?.format?.format ||
        decodedResult?.format?.formatName ||
        null
      );
    }

    clearTarget() {
      if (typeof document === "undefined" || !this.elementId) {
        return;
      }
      const target = document.getElementById(this.elementId);
      if (target) {
        target.innerHTML = "";
      }
    }

    async emitResult(text, metadata) {
      if (this.options.onResult) {
        await Promise.resolve(this.options.onResult(text, metadata));
      }
      this.dispatch("qrscanner:result", { text, metadata });
    }

    emitStatus(code, message, level) {
      const status = { code, message: String(message || ""), level: level || "info" };
      if (this.options.onStatus) {
        this.options.onStatus(status);
      }
      this.dispatch("qrscanner:status", status);
    }

    emitError(error) {
      if (this.options.onError) {
        this.options.onError(error);
      }
      this.dispatch("qrscanner:error", {
        code: error.code || "UNKNOWN",
        message: error.message || String(error),
      });
    }

    emitState() {
      const state = this.getState();
      if (this.options.onStateChange) {
        this.options.onStateChange(state);
      }
      this.dispatch("qrscanner:state", state);
    }

    dispatch(name, detail) {
      if (!this.options.emitEvents || !this.options.eventTarget || typeof CustomEvent !== "function") {
        return;
      }
      try {
        this.options.eventTarget.dispatchEvent(new CustomEvent(name, { detail }));
      } catch (_) {
        // Event dispatch is optional; callbacks remain the primary API.
      }
    }

    createError(code, message, cause) {
      const error = new Error(message);
      error.code = code;
      if (cause) {
        error.cause = cause;
      }
      return error;
    }
  }

  global.QrCameraScanner = QrCameraScanner;
})(typeof window !== "undefined" ? window : globalThis);
