(function (global) {
  "use strict";

  let modalCounter = 0;

  class QrCameraModal {
    constructor(options) {
      if (typeof global.QrCameraScanner !== "function") {
        throw new Error("QrCameraModal cần qr-camera-scanner.js được nạp trước.");
      }

      const opts = options || {};
      this.options = {
        title: opts.title || "Quét QR",
        subtitle: opts.subtitle || "Đưa QR vào khung camera",
        mode: opts.mode === "continuous" ? "continuous" : "single",
        duplicateDelay: Number.isFinite(Number(opts.duplicateDelay))
          ? Number(opts.duplicateDelay)
          : 1500,
        optimizeCamera: opts.optimizeCamera !== false,
        formats: Array.isArray(opts.formats) && opts.formats.length ? opts.formats : ["QR_CODE"],
        allowImage: opts.allowImage !== false,
        captureImageFromCamera: opts.captureImageFromCamera !== false,
        onResult: typeof opts.onResult === "function" ? opts.onResult : null,
        onStatus: typeof opts.onStatus === "function" ? opts.onStatus : null,
        onError: typeof opts.onError === "function" ? opts.onError : null,
        messages: opts.messages || {},
      };

      this.id = `qr-camera-modal-${++modalCounter}`;
      this.regionId = `${this.id}-region`;
      this.isOpen = false;
      this.previousBodyOverflow = "";
      this.imageBusy = false;
      this.boundKeydown = (event) => {
        if (event.key === "Escape" && this.isOpen) {
          this.close();
        }
      };

      this.buildDom();
      this.imageDecoder = this.options.allowImage && typeof global.QrImageDecoder === "function"
        ? new global.QrImageDecoder()
        : null;

      this.scanner = new global.QrCameraScanner({
        elementId: this.regionId,
        mode: this.options.mode,
        duplicateDelay: this.options.duplicateDelay,
        optimizeCamera: this.options.optimizeCamera,
        formats: this.options.formats,
        messages: this.options.messages,
        onResult: async (text, metadata) => {
          if (this.options.mode === "single") {
            this.hideOnly();
          }
          if (this.options.onResult) {
            await Promise.resolve(this.options.onResult(text, metadata));
          }
        },
        onStatus: (status) => {
          this.setStatus(status.message, status.level);
          if (this.options.onStatus) {
            this.options.onStatus(status);
          }
        },
        onError: (error) => {
          this.setStatus(error.message || String(error), "error");
          if (this.options.onError) {
            this.options.onError(error);
          }
        },
        onStateChange: (state) => this.syncState(state),
      });

      this.bindEvents();
      this.syncState(this.scanner.getState());
    }

    buildDom() {
      const wrapper = document.createElement("div");
      wrapper.id = this.id;
      wrapper.className = "qr-lib-modal";
      wrapper.hidden = true;
      wrapper.innerHTML = `
        <div class="qr-lib-dialog" role="dialog" aria-modal="true" aria-labelledby="${this.id}-title">
          <div class="qr-lib-header">
            <div>
              <div class="qr-lib-kicker">Quét realtime</div>
              <h2 class="qr-lib-title" id="${this.id}-title"></h2>
              <p class="qr-lib-subtitle"></p>
            </div>
            <button type="button" class="qr-lib-icon-button" data-role="close" aria-label="Đóng">&times;</button>
          </div>
          <div class="qr-lib-body">
            <div class="qr-lib-status" data-role="status">Đang chuẩn bị camera...</div>
            <div class="qr-lib-region" id="${this.regionId}"></div>
            <div class="qr-lib-actions">
              <button type="button" class="qr-lib-button qr-lib-button-torch" data-role="torch" hidden>Bật đèn</button>
              <button type="button" class="qr-lib-button" data-role="image">Chọn ảnh QR</button>
            </div>
            <input type="file" data-role="image-input" accept="image/*" hidden>
          </div>
        </div>`;

      wrapper.querySelector(".qr-lib-title").textContent = this.options.title;
      wrapper.querySelector(".qr-lib-subtitle").textContent = this.options.subtitle;
      document.body.appendChild(wrapper);

      this.root = wrapper;
      this.statusElement = wrapper.querySelector('[data-role="status"]');
      this.closeButton = wrapper.querySelector('[data-role="close"]');
      this.torchButton = wrapper.querySelector('[data-role="torch"]');
      this.imageButton = wrapper.querySelector('[data-role="image"]');
      this.imageInput = wrapper.querySelector('[data-role="image-input"]');

      if (this.options.captureImageFromCamera) {
        this.imageInput.setAttribute("capture", "environment");
      }
      if (!this.options.allowImage) {
        this.imageButton.hidden = true;
      }
    }

    bindEvents() {
      this.closeButton.addEventListener("click", () => this.close());
      this.root.addEventListener("click", (event) => {
        if (event.target === this.root) {
          this.close();
        }
      });
      this.torchButton.addEventListener("click", async () => {
        try {
          await this.scanner.toggleTorch();
        } catch (_) {
          // Error already surfaced by scanner callback.
        }
      });
      this.imageButton.addEventListener("click", () => {
        if (!this.imageDecoder) {
          this.setStatus(
            "Chức năng đọc ảnh chưa sẵn sàng. Hãy nạp qr-image-decoder.js và jsQR cục bộ.",
            "error",
          );
          return;
        }
        this.imageInput.click();
      });
      this.imageInput.addEventListener("change", () => this.handleImageSelection());
      document.addEventListener("keydown", this.boundKeydown);
    }

    async open() {
      if (this.isOpen) {
        return;
      }
      this.isOpen = true;
      this.root.hidden = false;
      this.previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      this.setStatus("Đang chuẩn bị camera...", "info");

      try {
        await this.scanner.start();
      } catch (_) {
        // Scanner callback already shows the concrete error in the modal.
      }
    }

    async close() {
      await this.scanner.stop({ emitStatus: false });
      this.hideOnly();
    }

    hideOnly() {
      this.isOpen = false;
      this.root.hidden = true;
      document.body.style.overflow = this.previousBodyOverflow;
      this.imageInput.value = "";
    }

    async destroy() {
      await this.scanner.destroy();
      document.removeEventListener("keydown", this.boundKeydown);
      this.root.remove();
    }

    setStatus(message, level) {
      const normalized = String(message || "").trim();
      this.statusElement.textContent = normalized;
      this.statusElement.hidden = normalized === "";
      this.statusElement.dataset.level = level || "info";
    }

    syncState(state) {
      const showTorch = Boolean(state && state.running && state.torchSupported);
      this.torchButton.hidden = !showTorch;
      this.torchButton.textContent = state && state.torchEnabled ? "Tắt đèn" : "Bật đèn";
    }

    async handleImageSelection() {
      if (this.imageBusy) {
        return;
      }
      const file = this.imageInput.files && this.imageInput.files[0];
      if (!file || !this.imageDecoder) {
        return;
      }

      this.imageBusy = true;
      this.setStatus("Đang đọc QR từ ảnh...", "info");

      try {
        const text = String(await this.imageDecoder.decodeFile(file)).trim();
        const metadata = {
          source: "image",
          scannedAt: new Date().toISOString(),
          mode: this.options.mode,
          format: "QR_CODE",
        };

        if (this.options.mode === "single") {
          await this.scanner.stop({ emitStatus: false });
          this.hideOnly();
        }

        if (this.options.onResult) {
          await Promise.resolve(this.options.onResult(text, metadata));
        }
        document.dispatchEvent(new CustomEvent("qrscanner:result", {
          detail: { text, metadata },
        }));
      } catch (error) {
        this.setStatus(error.message || String(error), "error");
        if (this.options.onError) {
          this.options.onError(error);
        }
      } finally {
        this.imageInput.value = "";
        this.imageBusy = false;
      }
    }
  }

  global.QrCameraModal = QrCameraModal;
})(typeof window !== "undefined" ? window : globalThis);
