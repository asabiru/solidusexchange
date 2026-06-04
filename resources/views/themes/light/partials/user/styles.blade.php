<link rel="shortcut icon" href="{{ getFile($basicControl->favicon_driver, $basicControl->favicon) }}"
      type="image/x-icon">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
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

body .sidebar-nav .nav-link {
    color: var(--dash-text-2) !important;
}

body .sidebar-nav .nav-link i {
    color: var(--dash-muted) !important;
}

body .sidebar-nav .nav-link.active {
    background: linear-gradient(135deg, rgba(201, 162, 39, .18), rgba(232, 201, 160, .12)) !important;
    color: var(--dash-accent) !important;
    border: 1px solid rgba(201, 162, 39, .20) !important;
}

body:not(.dark-theme) .sidebar-nav .nav-link.active {
    background: linear-gradient(135deg, rgba(201, 162, 39, .18), rgba(232, 201, 160, .24)) !important;
    color: var(--dash-accent) !important;
}

body .sidebar-nav .nav-link.active i {
    color: var(--dash-accent) !important;
}

body .sidebar-nav .nav-link:hover {
    background: rgba(232, 201, 160, 0.10) !important;
    color: var(--dash-text) !important;
}

body .sidebar-nav .nav-link:hover i {
    color: var(--dash-accent) !important;
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
    display: block !important;
    max-height: 44px;
    width: auto;
}

footer#footer,
.footer {
    background: var(--dash-surface) !important;
    border-top: 1px solid var(--dash-border-subtle) !important;
    color: var(--dash-muted) !important;
}



/* ── Profile dropdown (user menu) ───────────────────────────────────── */
body .dropdown-menu.profile {
    background: var(--dash-surface) !important;
    border: 1px solid var(--dash-border-subtle) !important;
    box-shadow: var(--dash-shadow) !important;
    padding: 10px !important;
    min-width: 260px;
}

body .dropdown-menu.profile .dropdown-item {
    color: var(--dash-text-2) !important;
}

body .dropdown-menu.profile .dropdown-item i {
    color: var(--dash-muted) !important;
}

body .dropdown-menu.profile .dropdown-item:hover {
    background: rgba(232, 201, 160, 0.10) !important;
    color: var(--dash-text) !important;
}

body .dropdown-menu.profile .dropdown-item:hover i {
    color: var(--dash-accent) !important;
}

body .header-nav .dropdown-menu.profile .dropdown-header {
    display: flex !important;
    align-items: center !important;
    text-align: left !important;
    margin: 2px 2px 10px;
    padding: 10px 10px 8px !important;
    border-radius: 12px;
    background: rgba(232, 201, 160, 0.10) !important;
    border: 1px solid var(--dash-border-subtle) !important;
    gap: 12px;
}

body:not(.dark-theme) .header-nav .dropdown-menu.profile .dropdown-header {
    background: rgba(201, 162, 39, 0.08) !important;
}

body .header-nav .dropdown-menu.profile .dropdown-header h6 {
    color: var(--dash-text) !important;
}

body .header-nav .dropdown-menu.profile .dropdown-header span {
    color: var(--dash-text-2) !important;
}

.header-nav .dropdown-menu.profile .dropdown-header .profile-thum {
    flex-shrink: 0;
    max-width: 48px !important;
    max-height: 48px !important;
    min-width: 48px !important;
    margin-right: 0 !important;
}

.header-nav .dropdown-menu.profile .dropdown-header .profile-content {
    min-width: 0;
    overflow: hidden;
}

.header-nav .dropdown-menu.profile .dropdown-header .profile-content h6 {
    margin: 0;
    font-size: 13px !important;
    font-weight: 700 !important;
    color: var(--dash-text) !important;
    letter-spacing: -0.01em;
}

.header-nav .dropdown-menu.profile .dropdown-header .profile-content span {
    display: block;
    margin-top: 2px;
    font-size: 12px !important;
    color: var(--dash-muted) !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 210px;
}

.dropdown-menu.profile .dropdown-item {
    padding: 10px 10px !important;
    display: flex !important;
    align-items: center;
    gap: 10px;
}

.dropdown-menu.profile .dropdown-item i {
    width: 18px;
    font-size: 15px;
    color: var(--dash-muted) !important;
}

.dropdown-menu.profile .dropdown-item:hover i {
    color: var(--dash-accent) !important;
}

.dropdown-menu.profile .dropdown-item:hover,
.dropdown-menu.profile .dropdown-item:focus {
    background: rgba(232, 201, 160, 0.12) !important;
}

/* Logout item (last) */
.dropdown-menu.profile li:last-child .dropdown-item {
    color: #c9786a !important;
}

.dropdown-menu.profile li:last-child .dropdown-item i {
    color: #c9786a !important;
}

.dropdown-menu.profile li:last-child .dropdown-item:hover,
.dropdown-menu.profile li:last-child .dropdown-item:focus {
    background: rgba(201, 120, 106, 0.12) !important;
}

.dropdown-menu.profile .dropdown-divider {
    margin: 8px 6px !important;
}


/* ApexCharts background and text styling overrides */
.apexcharts-canvas,
.apexcharts-canvas svg,
.apexcharts-canvas foreignObject {
    background: transparent !important;
}

.apexcharts-text,
.apexcharts-title-text {
    fill: var(--dash-text) !important;
}

.apexcharts-legend-text {
    color: var(--dash-text) !important;
}

/* Sidebar Brand Name and Section labels */
body .sidebar-brand-name {
    font-size: 18px !important;
    font-weight: 700 !important;
    color: var(--dash-text) !important;
    letter-spacing: -0.01em !important;
}

body .sidebar-section-label {
    color: var(--dash-muted) !important;
}

/* Page Title h3 */
body .pagetitle h3 {
    color: var(--dash-text) !important;
}

/* ============================================================
   eazy228/design alignment — Geist typography + polish
   ============================================================ */
html, body,
.sidebar, .sidebar-nav, #header, .header, #main, main.main,
.card, .box-card, .cmn-box, .table, table,
button, .btn, .cmn-btn,
input, select, textarea, .form-control, .form-select,
.dropdown-menu, .modal-content,
h1, h2, h3, h4, h5, h6, .pagetitle h3, .dash-section-title {
    font-family: "Geist", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif !important;
}
body { font-variant-numeric: tabular-nums; font-feature-settings: "ss01", "cv11"; }
.dash-stat-value, .dash-stat-total, .dash-stat-trend,
.table td, .table th, .num, .global-search,
input[type="number"], input[type="search"] { font-variant-numeric: tabular-nums; }

/* Accessible champagne-gold focus ring (reference spec) */
a:focus-visible, button:focus-visible, .btn:focus-visible, .cmn-btn:focus-visible,
.nav-link:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible,
.form-control:focus-visible, .form-select:focus-visible {
    outline: 1.5px solid var(--dash-accent-2, #e8c9a0) !important;
    outline-offset: 2px;
    border-radius: 6px;
}

/* Restrained, consistent transitions (color/border only — no glow) */
.nav-link, .btn, .cmn-btn, .form-control, .form-select,
.dropdown-item, .page-link, .card, .box-card {
    transition: background-color .18s ease, border-color .18s ease,
                color .18s ease, box-shadow .18s ease !important;
}

/* On-brand empty-state (replaces off-brand purple no-data illustration) */
.table-not-found{ padding:0 !important; border:0 !important; }
.table-not-found .sc-empty{ display:flex; flex-direction:column; align-items:center;
    justify-content:center; gap:14px; padding:56px 16px; }
.table-not-found .sc-empty-icon{ color:var(--dash-accent-2,#e8c9a0); opacity:.45; }
.table-not-found .sc-empty-text{ color:var(--dash-muted,#8a8278); font-size:14px;
    font-weight:500; letter-spacing:.01em; }
.no-data-img{ display:none !important; }

/* Dashboard stat-card hover micro-interaction */
.box-card { transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease !important; }
.box-card:hover { border-color: rgba(232,201,160,.22) !important; transform: translateY(-2px);
    box-shadow: 0 14px 34px rgba(0,0,0,.35) !important; }
</style>

@stack('extra_styles')
