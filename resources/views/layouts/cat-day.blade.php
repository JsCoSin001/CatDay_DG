<!doctype html>
<html lang="vi">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="light">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Công đoạn cắt/lấy dây')</title>

    {{-- Bootstrap 5.3.8: dùng cho layout/form responsive. Prototype UI không phụ thuộc Vite. --}}
    <link
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css"
        rel="stylesheet"
        integrity="sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB"
        crossorigin="anonymous"
    >

    <link rel="stylesheet" href="{{ asset('css/qr-scanner/qr-camera-modal.css') }}">
    <link rel="stylesheet" href="{{ asset('css/cat-day/cat-day-ui.css') }}">
    @stack('styles')
</head>
<body>
    @yield('content')

    {{-- QR reusable library: giữ đúng thứ tự nạp của package hiện có. --}}
    <script src="{{ asset('js/qr-scanner/lib/html5-qrcode.min.js') }}" defer></script>
    <script src="{{ asset('js/qr-scanner/lib/jsQR.js') }}" defer></script>
    <script src="{{ asset('js/qr-scanner/qr-image-decoder.js') }}" defer></script>
    <script src="{{ asset('js/qr-scanner/qr-camera-scanner.js') }}" defer></script>
    <script src="{{ asset('js/qr-scanner/qr-camera-modal.js') }}" defer></script>
    <script src="{{ asset('js/cat-day/b3-api.js') }}" defer></script>
    <script src="{{ asset('js/cat-day/b3-state.js') }}" defer></script>
    <script src="{{ asset('js/cat-day/cat-day-ui.js') }}" defer></script>
    @stack('scripts')
</body>
</html>
