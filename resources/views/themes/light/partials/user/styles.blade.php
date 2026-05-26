<link rel="shortcut icon" href="{{ getFile($basicControl->favicon_driver, $basicControl->favicon) }}"
      type="image/x-icon">
<link rel="stylesheet" href="{{ asset($themeTrue . 'css/all.min.css') }}">
<link rel="stylesheet" href="{{ asset($themeTrue . 'css/fontawesome.min.css') }}">
<link rel="stylesheet" href="{{ asset($themeTrue . "css/bootstrap.min.css") }}">
@stack('style_lib')

<link rel="stylesheet" href="{{ asset($themeTrue . "css/owl.carousel.min.css")}}">
<link rel="stylesheet" href="{{ asset($themeTrue . "css/owl.theme.default.min.css")}}">
<link rel="stylesheet" href="{{ asset($themeTrue . "css/swiper-bundle.min.css")}}">
<link rel="stylesheet" href="{{ asset($themeTrue . "css/select2.min.css")}}">
<link rel="stylesheet" href="{{ asset($themeTrue . "/css/dashboard.css")}}">
<link rel="stylesheet" href="{{ asset('assets/global/css/solidus-theme.css') }}">

{{-- Critical user-panel overrides — must load AFTER solidus-theme.css to win the !important cascade --}}
<style>
body {
    --dash-accent: #c9a227;
    --dash-accent-2: #e8c9a0;
}

body.dark-theme {
    --dash-bg: #0b0608;
    --dash-surface: #150c10;
    --dash-surface-2: #1a0f14;
    --dash-text: #f5ede4;
    --dash-text-2: #9a8e86;
    --dash-muted: #5e534d;
    --dash-border: rgba(232, 201, 160, 0.10);
    --dash-border-subtle: rgba(255, 255, 255, 0.06);
    --dash-header-bg: rgba(11, 6, 8, 0.92);
    --dash-sidebar-bg: linear-gradient(180deg, #110a0e, #150c10);
    --dash-shadow: 0 18px 44px rgba(0, 0, 0, 0.38);
}

body:not(.dark-theme) {
    --dash-bg: #faf8f5;
    --dash-surface: #ffffff;
    --dash-surface-2: #f5f0e8;
    --dash-text: #1a1614;
    --dash-text-2: #5a5248;
    --dash-muted: #8a8278;
    --dash-border: rgba(0, 0, 0, 0.10);
    --dash-border-subtle: rgba(0, 0, 0, 0.08);
    --dash-header-bg: rgba(250, 248, 245, 0.92);
    --dash-sidebar-bg: linear-gradient(180deg, #ffffff, #f5f0e8);
    --dash-shadow: 0 18px 44px rgba(11, 6, 8, 0.10);
}

html, body {
    background: var(--dash-bg) !important;
    color: var(--dash-text) !important;
}

#header.header,
#header {
    background: var(--dash-header-bg) !important;
    border-bottom: 1px solid var(--dash-border-subtle) !important;
    backdrop-filter: blur(16px) !important;
    -webkit-backdrop-filter: blur(16px) !important;
}

#sidebar.sidebar,
#sidebar {
    background: var(--dash-sidebar-bg) !important;
    border-right: 1px solid var(--dash-border-subtle) !important;
}

main#main,
main.main {
    background: var(--dash-bg) !important;
}

.box-card,
.card,
.cmn-box,
.box-card.grayish-blue-card,
.box-card.grayish-green-card,
.box-card.grayish-custom-card,
.box-card.strong-orange-card {
    background: var(--dash-surface) !important;
    border: 1px solid var(--dash-border-subtle) !important;
    background-image: none !important;
    color: var(--dash-text) !important;
    box-shadow: var(--dash-shadow) !important;
}

.card-header,
.card-footer {
    background: var(--dash-surface-2) !important;
    border-color: var(--dash-border-subtle) !important;
    color: var(--dash-text) !important;
}

.card-body {
    color: var(--dash-text-2) !important;
}

.table, table {
    color: var(--dash-text-2) !important;
    border-color: var(--dash-border-subtle) !important;
}

.table thead th,
thead th {
    background: var(--dash-surface-2) !important;
    color: var(--dash-muted) !important;
    border-color: var(--dash-border-subtle) !important;
}

.table td,
.table th {
    border-color: var(--dash-border-subtle) !important;
}

.table tbody tr:hover {
    background: rgba(232, 201, 160, 0.06) !important;
}

.form-control,
.form-select,
.input-group-text {
    background: var(--dash-surface) !important;
    border: 1px solid var(--dash-border) !important;
    color: var(--dash-text) !important;
}

.form-control:focus,
.form-select:focus {
    border-color: rgba(201, 162, 39, 0.55) !important;
    box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.10) !important;
}

.form-control::placeholder {
    color: var(--dash-muted) !important;
}

.form-label,
.col-form-label {
    color: var(--dash-muted) !important;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .04em;
}

.dropdown-menu {
    background: var(--dash-surface) !important;
    border: 1px solid var(--dash-border-subtle) !important;
    border-radius: 14px !important;
    box-shadow: var(--dash-shadow) !important;
}

.dropdown-item {
    color: var(--dash-text-2) !important;
    border-radius: 8px;
}

.dropdown-item:hover,
.dropdown-item:focus {
    background: rgba(232, 201, 160, 0.10) !important;
    color: var(--dash-text) !important;
}

.dropdown-divider,
hr.dropdown-divider {
    border-color: var(--dash-border-subtle) !important;
}

.alert {
    border-radius: 12px !important;
}

.alert-warning {
    background: rgba(217, 168, 106, 0.14) !important;
    border: 1px solid rgba(217, 168, 106, 0.22) !important;
    color: #a86a1f !important;
}

body.dark-theme .alert-warning {
    color: #d9a86a !important;
}

.badge.bg-primary {
    background: linear-gradient(135deg, var(--dash-accent), var(--dash-accent-2)) !important;
    color: #0b0608 !important;
}

.page-link {
    background: var(--dash-surface) !important;
    border-color: var(--dash-border-subtle) !important;
    color: var(--dash-text-2) !important;
}

.page-item.active .page-link {
    background: linear-gradient(135deg, var(--dash-accent), var(--dash-accent-2)) !important;
    color: #0b0608 !important;
    border-color: transparent !important;
}

.text-muted {
    color: var(--dash-muted) !important;
}

.modal-content {
    background: var(--dash-surface) !important;
    border: 1px solid var(--dash-border-subtle) !important;
    color: var(--dash-text) !important;
}

.modal-header,
.modal-footer {
    background: var(--dash-surface-2) !important;
    border-color: var(--dash-border-subtle) !important;
}

.cmn-table,
.table-responsive {
    background: var(--dash-surface) !important;
    border: 1px solid var(--dash-border-subtle) !important;
    border-radius: 14px;
}

.sidebar-nav .nav-link.active {
    background: linear-gradient(135deg, rgba(201, 162, 39, .18), rgba(232, 201, 160, .12)) !important;
    color: var(--dash-accent) !important;
    border: 1px solid rgba(201, 162, 39, .20) !important;
}

body:not(.dark-theme) .sidebar-nav .nav-link.active {
    background: linear-gradient(135deg, rgba(201, 162, 39, .18), rgba(232, 201, 160, .24)) !important;
}

.sidebar-nav .nav-link:hover {
    background: rgba(232, 201, 160, 0.10) !important;
    color: var(--dash-text) !important;
}

#toggle-btn {
    display: flex !important;
    width: 36px;
    height: 36px;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--dash-text-2);
    cursor: pointer;
    transition: all .2s;
}

#toggle-btn:hover {
    background: rgba(232, 201, 160, 0.12) !important;
    color: var(--dash-accent) !important;
}

#toggle-btn i {
    font-size: 16px;
}

#header .logo-container img#logoSet {
    display: none !important;
}

footer#footer,
.footer {
    background: var(--dash-surface) !important;
    border-top: 1px solid var(--dash-border-subtle) !important;
    color: var(--dash-muted) !important;
}

</style>

@stack('extra_styles')
