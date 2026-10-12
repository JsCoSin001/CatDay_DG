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

  // A denied browser permission is not a camera-device failure; do not retry and prompt repeatedly.
  function cameraPermissionDenied(error) {
    const name = String(error?.name || "");
    const message = String(error?.message || error || "");
    return /^(NotAllowedError|PermissionDeniedError|PermissionDismissedError|SecurityError)$/i.test(name)
      || /permission denied|permission dismissed|notallowederror|permissiondeniederror|quyền.*(từ chối|bị chặn)|not permitted|access denied/i.test(message);
  }

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
          : 0.90,
        aspectRatio: Number.isFinite(Number(opts.aspectRatio))
          ? Number(opts.aspectRatio)
          : 1,
        adaptiveScan: opts.adaptiveScan !== false,
        adaptiveDelay: Number.isFinite(Number(opts.adaptiveDelay))
          ? Math.max(0, Number(opts.adaptiveDelay)) : 2000,
        adaptiveInterval: Number.isFinite(Number(opts.adaptiveInterval))
          ? Math.max(1000, Number(opts.adaptiveInterval)) : 1000,
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
      this.sessionId = 0;
      this.pendingStart = null;
      this.stopPromise = null;
      this.adaptiveTimer = null;
      this.adaptiveCanvas = null;
      this.adaptiveDecoder = null;
      this.resizeHandler = null;
      this.resizeTimer = null;
      this.scanViewportSize = null;
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
      // Never rebuild the video element while an older instance is releasing it.
      if (this.stopPromise) {
        await this.stopPromise;
      }
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

      const session = ++this.sessionId;
      this.starting = true;
      this.resultBusy = false;
      this.emitState();
      this.emitStatus("preparing", this.options.messages.preparing, "info");
      this.clearTarget();

      const task = this.startCameraSession(session);
      this.pendingStart = task;
      try {
        return await task;
      } finally {
        if (this.pendingStart === task) {
          this.pendingStart = null;
        }
      }
    }

    async startCameraSession(session) {
      const constructorConfig = { verbose: false };
      const formatsToSupport = this.resolveFormats();
      if (formatsToSupport.length) {
        constructorConfig.formatsToSupport = formatsToSupport;
      }
      let instance;
      try {
        instance = new global.Html5Qrcode(this.elementId, constructorConfig);
        this.html5QrCode = instance;
        const qrbox = (width, height) => {
          // Same actual crop for the primary camera AND every fallback.
          const side = Math.max(50, Math.floor(
            Math.min(width, height) * this.options.qrboxRatio,
          ));
          return { width: side, height: side };
        };
        const primaryConfig = {
          fps: this.options.fps,
          qrbox,
          disableFlip: false,
          aspectRatio: this.options.aspectRatio,
        };
        const relaxedConfig = {
          fps: Math.min(this.options.fps, 12),
          qrbox,
          disableFlip: false,
        };
        const onSuccess = (text, result) => {
          void this.handleDecodedResult(text, result, session);
        };
        const tryStart = async (camera, config) => {
          if (this.sessionId !== session) {
            throw this.createError("SCAN_CANCELLED", "Camera đã đóng.");
          }
          await instance.start(camera, config, onSuccess, function () {});
          if (this.sessionId !== session) {
            throw this.createError("SCAN_CANCELLED", "Camera đã đóng.");
          }
        };
        try {
          await tryStart({ facingMode: "environment" }, primaryConfig);
        } catch (primaryError) {
          if (this.sessionId !== session || cameraPermissionDenied(primaryError)) throw primaryError;
          this.emitStatus("fallback", this.options.messages.fallback, "info");
          try {
            // html5-qrcode 2.3.8 does not accept { facingMode: { ideal: ... } }.
            await tryStart({ facingMode: "environment" }, relaxedConfig);
          } catch (_) {
            if (this.sessionId !== session || cameraPermissionDenied(_)) throw _;
            this.emitStatus("retrying", this.options.messages.retrying, "info");
            const cameras = typeof global.Html5Qrcode.getCameras === "function"
              ? await global.Html5Qrcode.getCameras() : [];
            if (this.sessionId !== session) {
              throw this.createError("SCAN_CANCELLED", "Camera đã đóng.");
            }
            const camera = cameras.find((item) => /back|rear|environment|sau/iu.test(item.label || ""))
              || cameras[cameras.length - 1];
            if (!camera || !camera.id) throw primaryError;
            try {
              await tryStart({ deviceId: { exact: camera.id } }, relaxedConfig);
            } catch (byIdError) {
              if (this.sessionId !== session || cameraPermissionDenied(byIdError)) throw byIdError;
              await tryStart(camera.id, relaxedConfig);
            }
          }
        }

        if (this.sessionId !== session) {
          throw this.createError("SCAN_CANCELLED", "Camera đã đóng.");
        }
        this.running = true;
        this.starting = false;
        try {
          await this.optimizeActiveCameraTrack();
        } catch (_) {
          // Failure to query or tune camera capabilities must not prevent scanning.
          this.torchSupported = false;
          this.torchEnabled = false;
        }
        if (this.sessionId !== session) {
          throw this.createError("SCAN_CANCELLED", "Camera đã đóng.");
        }
        this.emitState();
        this.emitStatus("ready", this.options.messages.ready, "info");
        this.alignScanOverlay();
        this.watchViewportResize(session);
        this.startAdaptiveScanning(session);
        return this.getState();
      } catch (cause) {
        await this.releaseInstance(instance);
        if (this.html5QrCode === instance) this.html5QrCode = null;
        if (this.sessionId !== session) {
          // A user closing the modal during startup is not a camera error.
          throw cause;
        }
        this.running = false;
        this.starting = false;
        this.clearTarget();
        this.emitState();
        const denied = cameraPermissionDenied(cause);
        const detail = denied
          ? "Không thể truy cập camera do quyền bị từ chối. Vui lòng cho phép sử dụng camera trong cài đặt trang web, sau đó thử lại."
          : cause && cause.message
            ? `${this.options.messages.startFailed} (${cause.message})`
            : this.options.messages.startFailed;
        const error = this.createError(denied ? "CAMERA_PERMISSION_DENIED" : "CAMERA_START_FAILED", detail, cause);
        this.emitError(error);
        throw error;
      }
    }

    async releaseInstance(instance) {
      if (!instance) return;
      if (typeof instance.stop === "function") {
        try { await instance.stop(); } catch (_) { /* Already stopped, or never started. */ }
      }
      if (typeof instance.clear === "function") {
        try { await instance.clear(); } catch (_) { /* Scanner may already be released. */ }
      }
    }

    async stop(options) {
      const opts = options || {};
      const emitStatus = opts.emitStatus !== false;
      // Invalidate both the scanning callbacks and delayed image processing immediately.
      ++this.sessionId;
      this.clearAdaptiveScanning();
      this.clearViewportResize();
      this.running = false;
      this.starting = false;
      this.torchSupported = false;
      this.torchEnabled = false;
      this.emitState();
      if (this.stopPromise) {
        await this.stopPromise;
        return this.getState();
      }

      const pending = this.pendingStart;
      const instance = this.html5QrCode;
      const task = (async () => {
        if (pending) {
          try { await pending; } catch (_) { /* A canceled start is expected. */ }
        }
        await this.releaseInstance(instance);
        if (this.html5QrCode === instance) this.html5QrCode = null;
        this.clearTarget();
      })();
      this.stopPromise = task;
      try {
        await task;
      } finally {
        if (this.stopPromise === task) this.stopPromise = null;
      }
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

      const instance = this.html5QrCode;
      const capabilities = typeof instance.getRunningTrackCapabilities === "function"
        ? instance.getRunningTrackCapabilities() : null;
      const settings = typeof instance.getRunningTrackSettings === "function"
        ? instance.getRunningTrackSettings() : null;

      this.torchSupported = Boolean(capabilities && capabilities.torch);
      this.torchEnabled = Boolean(settings && settings.torch);
      this.emitState();

      if (!this.options.optimizeCamera) {
        return;
      }

      // Apply only verified capabilities; never request autofocus and single-shot
      // together, and never increase zoom automatically (decision 3A).
      const focusModes = capabilities && capabilities.focusMode;
      const exposureModes = capabilities && capabilities.exposureMode;
      const advanced = {};
      if (Array.isArray(focusModes) && focusModes.includes("continuous")) {
        advanced.focusMode = "continuous";
      } else if (Array.isArray(focusModes) && focusModes.includes("single-shot")) {
        advanced.focusMode = "single-shot";
      }
      if (Array.isArray(exposureModes) && exposureModes.includes("continuous")) {
        advanced.exposureMode = "continuous";
      }
      if (this.sessionId > 0 && this.running) {
        // Resolution is best-effort: ask for a supported setting, then read
        // getRunningTrackSettings() instead of assuming that it was accepted.
        const constraints = {};
        if (capabilities && capabilities.width && capabilities.height && settings) {
          const maxWidth = Number(capabilities.width.max);
          const maxHeight = Number(capabilities.height.max);
          const ratio = Number(settings.width) / Number(settings.height);
          if (maxWidth >= 640 && maxHeight >= 480 && Number.isFinite(ratio) && ratio > 0) {
            // Preserve the stream aspect ratio so html5-qrcode's existing
            // crop/overlay geometry is not invalidated by a 16:9 switch.
            const idealWidth = Math.floor(Math.min(1920, maxWidth, maxHeight * ratio));
            const idealHeight = Math.floor(idealWidth / ratio);
            if (idealHeight >= 480) {
              constraints.width = { ideal: idealWidth };
              constraints.height = { ideal: idealHeight };
            }
          }
        }
        if (Object.keys(advanced).length) constraints.advanced = [advanced];
        if (Object.keys(constraints).length) {
          try {
            await instance.applyVideoConstraints(constraints);
          } catch (_) {
            // Unsupported tuning is never a scanning failure. Retry focus alone.
            if (Object.keys(advanced).length) {
              try {
                await instance.applyVideoConstraints({ advanced: [advanced] });
              } catch (_) { /* Keep the camera's working settings. */ }
            }
          }
        }
      }

      if (this.html5QrCode !== instance || !this.running) return;
      const refreshedSettings = typeof instance.getRunningTrackSettings === "function"
        ? instance.getRunningTrackSettings() : null;
      this.torchEnabled = Boolean(refreshedSettings && refreshedSettings.torch);
      this.emitState();
    }

    async handleDecodedResult(decodedText, decodedResult, session) {
      if (session !== undefined && session !== this.sessionId) return;
      if (!this.running || this.resultBusy) {
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
          const acceptedSession = this.sessionId;
          await this.stop({ emitStatus: false });
          // Do not deliver a result after another close/reopen operation.
          if (this.sessionId !== acceptedSession + 1) return;
        } else if (session !== undefined && session !== this.sessionId) {
          return;
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

    alignScanOverlay() {
      if (typeof document === "undefined") return;
      const target = document.getElementById(this.elementId);
      if (!target) return;
      const video = target.querySelector("video");
      const shade = target.querySelector("#qr-shaded-region");
      if (!video || !shade || !video.clientWidth || !video.clientHeight) return;
      // html5-qrcode sizes shading from video.clientWidth/Height, but its
      // absolute borders otherwise stretch to our responsive square wrapper.
      // Constrain shading to the actual video surface in non-1:1 fallbacks.
      shade.style.right = "auto";
      shade.style.bottom = "auto";
      shade.style.width = `${video.clientWidth}px`;
      shade.style.height = `${video.clientHeight}px`;
    }

    watchViewportResize(session) {
      if (typeof global.addEventListener !== "function" || typeof document === "undefined") return;
      const target = document.getElementById(this.elementId);
      if (!target) return;
      this.scanViewportSize = {
        width: target.clientWidth,
        height: target.clientHeight,
      };
      this.resizeHandler = () => {
        if (this.sessionId !== session || !this.running) return;
        const box = document.getElementById(this.elementId);
        if (!box || !this.scanViewportSize) return;
        if (Math.abs(box.clientWidth - this.scanViewportSize.width) < 12
          && Math.abs(box.clientHeight - this.scanViewportSize.height) < 12) return;
        if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(async () => {
          this.resizeTimer = null;
          if (this.sessionId !== session || !this.running) return;
          // The scanner must recompute its internal crop, not merely CSS.
          await this.stop({ emitStatus: false });
          if (this.sessionId !== session + 1) return; // user also closed it
          try { await this.start(); } catch (_) { /* Normal camera error callback. */ }
        }, 400);
      };
      global.addEventListener("resize", this.resizeHandler);
    }

    clearViewportResize() {
      if (this.resizeTimer !== null) {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = null;
      }
      if (this.resizeHandler && typeof global.removeEventListener === "function") {
        global.removeEventListener("resize", this.resizeHandler);
      }
      this.resizeHandler = null;
      this.scanViewportSize = null;
    }

    startAdaptiveScanning(session) {
      this.clearAdaptiveScanning();
      if (!this.options.adaptiveScan || typeof global.jsQR !== "function"
        || typeof global.QrImageDecoder !== "function") return;
      try {
        this.adaptiveDecoder = new global.QrImageDecoder({ formats: ["qr_code"] });
      } catch (_) { return; }
      const schedule = (delay) => {
        this.adaptiveTimer = setTimeout(() => {
          this.adaptiveTimer = null;
          if (session !== this.sessionId || !this.running || this.resultBusy) return;
          try {
            const imageData = this.captureVisibleQrBox();
            const text = imageData && this.adaptiveDecoder.decodeCameraFrame(imageData);
            if (text) {
              // Shared result gate prevents double callback across both decoders.
              void this.handleDecodedResult(text, { format: { formatName: "QR_CODE" } }, session);
            }
          } catch (_) {
            // The standard html5-qrcode decoder remains active and uninterrupted.
          } finally {
            if (session === this.sessionId && this.running && !this.resultBusy) {
              schedule(this.options.adaptiveInterval);
            }
          }
        }, delay);
      };
      schedule(this.options.adaptiveDelay);
    }

    clearAdaptiveScanning() {
      if (this.adaptiveTimer !== null) {
        clearTimeout(this.adaptiveTimer);
        this.adaptiveTimer = null;
      }
      this.adaptiveDecoder = null;
      this.adaptiveCanvas = null;
    }

    captureVisibleQrBox() {
      if (typeof document === "undefined") return null;
      const target = document.getElementById(this.elementId);
      if (!target) return null;
      const video = target.querySelector("video");
      // html5-qrcode's four dark borders are the authoritative crop boundary.
      const shade = target.querySelector("#qr-shaded-region");
      if (!video || !shade || video.readyState < 2 || !video.videoWidth || !video.videoHeight
        || typeof global.getComputedStyle !== "function") return null;
      const videoRect = video.getBoundingClientRect();
      const shadeRect = shade.getBoundingClientRect();
      const style = global.getComputedStyle(shade);
      const left = shadeRect.left + (parseFloat(style.borderLeftWidth) || 0);
      const right = shadeRect.right - (parseFloat(style.borderRightWidth) || 0);
      const top = shadeRect.top + (parseFloat(style.borderTopWidth) || 0);
      const bottom = shadeRect.bottom - (parseFloat(style.borderBottomWidth) || 0);
      const size = Math.min(right - left, bottom - top);
      if (size < 50 || videoRect.width <= 0 || videoRect.height <= 0) return null;
      // Do not scan outside the guide, even when CSS/layout change unexpectedly.
      if (left < videoRect.left - 1 || top < videoRect.top - 1
        || right > videoRect.right + 1 || bottom > videoRect.bottom + 1) return null;

      const x = (left - videoRect.left) / videoRect.width * video.videoWidth;
      const y = (top - videoRect.top) / videoRect.height * video.videoHeight;
      const width = (right - left) / videoRect.width * video.videoWidth;
      const height = (bottom - top) / videoRect.height * video.videoHeight;
      if (x < 0 || y < 0 || x + width > video.videoWidth + 2
        || y + height > video.videoHeight + 2) return null;
      const outputSide = Math.max(1, Math.min(640, Math.round(Math.min(width, height))));
      if (!this.adaptiveCanvas) this.adaptiveCanvas = document.createElement("canvas");
      const canvas = this.adaptiveCanvas;
      if (canvas.width !== outputSide) canvas.width = outputSide;
      if (canvas.height !== outputSide) canvas.height = outputSide;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(video, x, y, width, height, 0, 0, outputSide, outputSide);
      return context.getImageData(0, 0, outputSide, outputSide);
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
