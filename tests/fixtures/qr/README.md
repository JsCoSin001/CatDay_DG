# Small camera QR fixture

`user-small-117x114.jpg` is an unchanged copy of the user-provided JPG:
`1792551570499_2060225016415648955_773201858416265110_5473a5b46cf742db16a1632ff00ae8c8.jpg`.

- Dimensions: 117 × 114 pixels.
- SHA-256: `500b92c6c8ae2cddbcbb403f8dee24bf5b7ba69804ba7daed23ba1fd2f6ef378`.
- Decoded text: `cuontp;265098;100;20261021;202610210959100006;GOLDCUP; TCVN 6610-3/IEC 60227-3; 450/750V Cu/PVC 70ºC 1x50 SQMM`.

`B3QrCameraDecoderTest.cjs` embeds this image into a 640 × 480 simulated frame and crops a 256- or 360-pixel guide. Its 96 cases combine six image widths (117, 108, 99, 90, 81, 72), four blur radii (0, 0.25, 0.5, 0.75 px), and two offsets (0, 0.35 px). Width below 90 or blur above 0.5 marks a stress case. Results compare the frozen original camera algorithm, nearest-neighbor 2× enlargement, smooth 2× enlargement, and the production decoder. The static file path is checked separately.

Success-rate improvement is reported, not asserted. Every successful result must equal the complete expected payload. Timings and results are written to `storage/app/verification/qr-small-camera-benchmark.json`; they are desktop Chromium measurements, not physical-camera measurements.

Run with `node --test tests/JavaScript/B3QrCameraDecoderTest.cjs`. Set `B3_PLAYWRIGHT_MODULE` to an installed Playwright module path if it is not on the normal Node module search path. Browser-dependent cases explicitly skip when Playwright is absent; the verification report records a run with no skipped tests.
