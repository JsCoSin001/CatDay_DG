@extends('layouts.cat-day')

@section('title', 'Công đoạn cắt/lấy dây')

@section('content')
{{-- B3 UI: vùng popup thông báo dùng Bootstrap Alert. Đây là UI chung, không chứa logic nghiệp vụ. --}}
<div id="app-alert-host" class="app-alert-host" aria-live="off" aria-atomic="false"></div>
{{-- B3: Loading hiển thị sau 500ms khi yêu cầu dữ liệu kéo dài. --}}
<div id="b3-page-loading" class="b3-page-loading" role="status" aria-live="polite" aria-atomic="true" hidden>
    <div class="b3-page-loading-card">
        <span class="b3-loading-spinner" aria-hidden="true"></span>
        <strong id="b3-page-loading-message">Đang tải dữ liệu...</strong>
        <span>Vui lòng chờ trong khi hệ thống xử lý.</span>
    </div>
</div>

<div id="login-screen" class="login-screen" aria-hidden="false">
    <div class="login-card">
        <div class="login-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
                <path d="M7 10V8a5 5 0 0 1 10 0v2"/>
                <rect x="5" y="10" width="14" height="10" rx="2"/>
                <path d="M12 14v2"/>
            </svg>
        </div>
        <h1 class="login-title">Đăng nhập</h1>
        <p class="login-subtitle">Công đoạn cắt/lấy dây</p>

        <form id="login-form" autocomplete="off">
            <div class="mb-3">
                <label for="login-username" class="form-label fw-semibold">Tên đăng nhập</label>
                <input id="login-username" class="form-control app-control" type="text" placeholder="Nhập tên đăng nhập">
            </div>

            <div class="mb-2">
                <label for="login-password" class="form-label fw-semibold">Mật khẩu</label>
                <input id="login-password" class="form-control app-control" type="password" placeholder="Nhập mật khẩu">
            </div>

            <button class="btn btn-primary app-primary-button w-100" type="submit">Đăng nhập</button>
        </form>

    </div>
</div>

<div id="app-screen" class="app-shell d-none" aria-hidden="true">
    <header class="app-header">
        <div class="container-fluid app-container">
            <div class="header-row">
                <h1 class="app-title">CÔNG ĐOẠN CẮT/LẤY DÂY</h1>

                <div class="desktop-account">
                    <span class="account-name" id="desktop-account-name">Người dùng</span>
                    <button type="button" class="logout-link" data-action="logout">Đăng xuất</button>
                </div>

                <div class="mobile-menu-wrap">
                    <button
                        id="mobile-menu-button"
                        class="mobile-menu-button"
                        type="button"
                        aria-label="Mở menu"
                        aria-expanded="false"
                        aria-controls="mobile-menu"
                    >
                        <span aria-hidden="true">⋮</span>
                    </button>
                    <div id="mobile-menu" class="mobile-menu" hidden>
                        <button type="button" data-action="logout">Đăng xuất</button>
                    </div>
                </div>
            </div>
        </div>
    </header>

    <main class="container-fluid app-container app-main">
        <section class="app-card search-card" aria-labelledby="search-title">
            <div class="section-heading">
                <h2 id="search-title">Tìm kiếm kế hoạch</h2>
            </div>

            <div class="row g-3 align-items-end">
                <div class="col-12 col-md-7 col-xl-6">
                    <label class="form-label app-label" for="plan-search">Mã kế hoạch</label>
                    <div class="plan-combobox" id="plan-combobox">
                        <div class="plan-input-wrap">
                            <input
                                id="plan-search"
                                class="form-control app-control plan-input"
                                type="text"
                                placeholder="Nhập mã kế hoạch..."
                                autocomplete="off"
                                role="combobox"
                                aria-autocomplete="list"
                                aria-expanded="false"
                                aria-controls="plan-options"
                            >
                            <span class="plan-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg></span>
                        </div>
                        <div id="plan-options" class="plan-options" role="listbox" hidden></div>
                        <div id="b3-plan-loading" class="b3-plan-loading" role="status" aria-live="polite" hidden>
                            <span class="b3-loading-spinner" aria-hidden="true"></span>
                            <span>Đang tìm kế hoạch...</span>
                        </div>
                    </div>
                </div>

                <div class="col-12 col-md-5 col-xl-6 all-plan-column">
                    <button id="search-all" type="button" class="btn btn-outline-primary app-control">Tìm toàn bộ kế hoạch</button>
                </div>
            </div>
        </section>

        <section class="app-card qr-card" aria-label="Quét QR">
            <div class="qr-action-grid">
                <button id="open-qr" type="button" class="btn btn-primary app-primary-button qr-open-button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
                        <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                        <rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/>
                        <rect x="7" y="14" width="3" height="3"/><path d="M14 14h3v3h-3z"/>
                    </svg>
                    <span>Quét QR</span>
                </button>

                <div class="form-check app-check qr-continuous-check">
                    <input id="continuous-scan" class="form-check-input" type="checkbox">
                    <label class="form-check-label" for="continuous-scan">Quét liên tiếp</label>
                </div>
            </div>
        </section>

        <section class="app-card result-card" aria-labelledby="result-title">
            <div class="result-toolbar">
                <div>
                    <h2 id="result-title">Danh sách kế hoạch</h2>
                    <p id="result-summary" class="result-summary">Chọn mã kế hoạch hoặc nhấn “Tìm toàn bộ kế hoạch”.</p>
                </div>
                <div class="swipe-hint" aria-hidden="true">← Vuốt ngang bảng →</div>
            </div>

            <div id="table-scroll" class="table-scroll" tabindex="0" aria-label="Bảng kế hoạch, có thể vuốt ngang">
                <table class="table app-table align-middle mb-0">
                    <thead>
                        <tr>
                            <th>Mã kế hoạch</th>
                            <th>Tên sản phẩm</th>
                            <th>LOT</th>
                            <th class="text-end">Số lượng cuộn</th>
                            <th class="text-end">Số đầu</th>
                            <th class="text-end">Số cuối</th>
                            <th class="text-end">Số cuộn cắt lẻ</th>
                            <th>Tình trạng</th>
                        </tr>
                    </thead>
                    <tbody id="plan-table-body"></tbody>
                </table>

                <div id="empty-state" class="empty-state">
                    <div class="empty-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                            <path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>
                            <path d="M7 8h10M7 12h7M7 16h4"/>
                        </svg>
                    </div>
                    <strong>Chưa có dữ liệu kế hoạch</strong>
                    <span>Chọn mã kế hoạch hoặc bật tìm toàn bộ để xem công việc còn lại.</span>
                </div>
            </div>

            <nav id="pagination" class="pagination-shell" aria-label="Phân trang" hidden>
                <div id="desktop-pagination" class="desktop-pagination"></div>
                <div class="mobile-pagination">
                    <button id="mobile-prev" type="button" class="page-nav" aria-label="Trang trước">‹</button>
                    <span id="mobile-page-label">Trang 1/1</span>
                    <button id="mobile-next" type="button" class="page-nav" aria-label="Trang sau">›</button>
                </div>
            </nav>
        </section>
    </main>
</div>

<div id="qr-bottom-sheet-backdrop" class="bottom-sheet-backdrop" hidden></div>
<section id="qr-bottom-sheet" class="bottom-sheet b3-result-sheet" hidden aria-modal="true" role="dialog" aria-labelledby="qr-result-title">
    <div class="bottom-sheet-handle" aria-hidden="true"></div>

    <div class="b3-result-shell">
        <header class="b3-result-header">
            <div>
                <div class="b3-result-eyebrow">B3 · THỰC HIỆN KẾ HOẠCH</div>
                <h2 id="qr-result-title">KẾT QUẢ TÌM KIẾM</h2>
            </div>
            <button id="close-bottom-sheet-x" type="button" class="btn-close b3-result-close" aria-label="Đóng"></button>
        </header>

        <div class="b3-result-scroll">
            <section class="b3-context-card" aria-label="Thông tin kết quả quét">
                <div class="b3-context-grid">
                    <div>
                        <span class="b3-field-label">Phạm vi kế hoạch</span>
                        <div id="b3-plan-scope"></div>
                    </div>
                    <div>
                        <span class="b3-field-label">Sản phẩm vừa quét</span>
                        <strong id="b3-product-name" class="b3-product-name"></strong>
                    </div>
                    <div>
                        <span class="b3-field-label">LOT / Mã cuộn</span>
                        <strong id="b3-reel-code"></strong>
                    </div>
                    <div>
                        <span class="b3-field-label">Loại cuộn</span>
                        <strong id="b3-reel-type"></strong>
                    </div>
                </div>
            </section>

            <div class="b3-operation-tabs" role="tablist" aria-label="Loại thao tác B3">
                <button id="b3-tab-whole" class="b3-operation-tab" type="button" role="tab" data-b3-tab="whole">
                    LẤY NGUYÊN CUỘN
                </button>
                <button id="b3-tab-cut" class="b3-operation-tab active" type="button" role="tab" data-b3-tab="cut" aria-selected="true">
                    CẮT LẺ
                </button>
            </div>

            <div id="b3-tab-content" class="b3-tab-content"></div>

            <details class="b3-raw-qr">
                <summary>Mã QR đã quét</summary>
                <div id="qr-result-value" class="qr-result-value"></div>
            </details>
        </div>

        <div class="b3-result-footer">
            <label class="form-check b3-footer-continuous" for="b3-continue-scan">
                <input id="b3-continue-scan" class="form-check-input" type="checkbox">
                <span class="form-check-label">Quét liên tiếp sau khi lưu</span>
            </label>
            <div class="b3-footer-actions">
                <button id="b3-cancel-action" type="button" class="btn btn-outline-secondary">Hủy</button>
                <button id="b3-save-action" type="button" class="btn btn-primary app-primary-button">Lưu</button>
            </div>
        </div>
    </div>
</section>
@endsection
