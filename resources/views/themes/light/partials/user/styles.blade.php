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
/* ── Force dark background on all panel elements ──────────────────── */
html,body { background:#0b0608 !important; color:#f5ede4 !important; }

#header.header,#header { background:rgba(11,6,8,.92) !important; border-bottom:1px solid rgba(232,201,160,.10) !important; }
#sidebar.sidebar,#sidebar { background:linear-gradient(180deg,#110a0e,#150c10) !important; border-right:1px solid rgba(232,201,160,.08) !important; }
main#main,main.main { background:#0b0608 !important; }

/* Cards & boxes */
.box-card,.card,.cmn-box,.box-card.grayish-blue-card,.box-card.grayish-green-card,
.box-card.grayish-custom-card,.box-card.strong-orange-card {
    background:#150c10 !important;
    border:1px solid rgba(232,201,160,.08) !important;
    background-image:none !important;
    color:#f5ede4 !important;
}
.card-header,.card-footer { background:rgba(232,201,160,.04) !important; border-color:rgba(232,201,160,.08) !important; color:#f5ede4 !important; }
.card-body { color:#9a8e86 !important; }

/* Tables */
.table,table { color:#9a8e86 !important; border-color:rgba(255,255,255,.04) !important; }
.table thead th,thead th { background:rgba(232,201,160,.05) !important; color:#5e534d !important; border-color:rgba(255,255,255,.04) !important; }
.table tbody tr { border-color:rgba(255,255,255,.03) !important; }
.table tbody tr:hover { background:rgba(232,201,160,.03) !important; }
.table td,.table th { border-color:rgba(255,255,255,.03) !important; }

/* Forms */
.form-control,.form-select,.input-group-text {
    background:rgba(255,255,255,.04) !important;
    border:1px solid rgba(232,201,160,.12) !important;
    color:#f5ede4 !important;
}
.form-control:focus,.form-select:focus {
    border-color:rgba(232,201,160,.35) !important;
    box-shadow:0 0 0 3px rgba(232,201,160,.08) !important;
}
.form-control::placeholder { color:#5e534d !important; }
.form-label,.col-form-label { color:#9a8e86 !important; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }

/* Dropdowns */
.dropdown-menu { background:#150c10 !important; border:1px solid rgba(232,201,160,.14) !important; border-radius:14px !important; }
.dropdown-item { color:#9a8e86 !important; border-radius:8px; }
.dropdown-item:hover,.dropdown-item:focus { background:rgba(232,201,160,.08) !important; color:#f5ede4 !important; }
.dropdown-divider { border-color:rgba(232,201,160,.08) !important; }

/* Alerts */
.alert { border-radius:12px !important; }
.alert-warning { background:rgba(217,168,106,.12) !important; border:1px solid rgba(217,168,106,.20) !important; color:#d9a86a !important; }

/* Badges */
.badge.bg-warning,.badge-soft-warning { background:rgba(217,168,106,.15) !important; color:#d9a86a !important; }
.badge.bg-success,.badge-soft-success { background:rgba(127,178,138,.15) !important; color:#7fb28a !important; }
.badge.bg-danger,.badge-soft-danger  { background:rgba(201,120,106,.15) !important; color:#c9786a !important; }
.badge.bg-primary { background:linear-gradient(135deg,#c9a227,#e8c9a0) !important; color:#0b0608 !important; }

/* Pagination */
.page-link { background:#150c10 !important; border-color:rgba(232,201,160,.10) !important; color:#9a8e86 !important; }
.page-item.active .page-link { background:linear-gradient(135deg,#c9a227,#e8c9a0) !important; color:#0b0608 !important; border-color:transparent !important; }

/* Misc */
.text-muted { color:#5e534d !important; }
hr,hr.dropdown-divider,.dropdown-divider { border-color:rgba(232,201,160,.08) !important; }
.modal-content { background:#150c10 !important; border:1px solid rgba(232,201,160,.14) !important; color:#f5ede4 !important; }
.modal-header,.modal-footer { background:rgba(232,201,160,.04) !important; border-color:rgba(232,201,160,.08) !important; }
.cmn-table,.table-responsive { background:#150c10 !important; border:1px solid rgba(232,201,160,.08) !important; border-radius:14px; }

/* Sidebar active/hover */
.sidebar-nav .nav-link.active {
    background:linear-gradient(135deg,rgba(201,162,39,.18),rgba(232,201,160,.10)) !important;
    color:#e8c9a0 !important; border:1px solid rgba(232,201,160,.15) !important;
}
.sidebar-nav .nav-link:hover { background:rgba(232,201,160,.06) !important; color:#f5ede4 !important; }

/* Theme toggle button — always show, round icon */
#toggle-btn {
    display:flex !important;
    width:36px; height:36px;
    align-items:center; justify-content:center;
    border-radius:8px;
    color:#9a8e86;
    cursor:pointer;
    transition:all .2s;
}
#toggle-btn:hover { background:rgba(232,201,160,.08) !important; color:#e8c9a0 !important; }
#toggle-btn i { font-size:16px; }

/* Footer */
footer#footer,.footer { background:#150c10 !important; border-top:1px solid rgba(232,201,160,.06) !important; color:#5e534d !important; }
</style>

@stack('extra_styles')
