<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <!-- Required Meta Tags Always Come First -->
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

    <!-- Title -->
    <title>@yield('page_title') - {{ __(basicControl()->site_title) }}</title>

    <!-- Favicon -->
    <link rel="shortcut icon" href="{{ getFile(basicControl()->favicon_driver, basicControl()->favicon) }}">

    <!-- Font -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">

    <!-- CSS Implementing Plugins -->
    <link rel="stylesheet" href="{{ asset('assets/admin/css/bootstrap-icons.css') }}">
    <link rel="stylesheet" href="{{ asset('assets/admin/css/custom.css') }}">
    <link rel="stylesheet" href="{{ asset('assets/global/css/solidus-theme.css') }}">

    <!-- CSS Front Template -->
    <link rel="preload" href="{{ asset('assets/admin/css/theme.min.css') }}" data-hs-appearance="default" as="style">
    <link rel="preload" href="{{ asset('assets/admin/css/theme-dark.min.css') }}" data-hs-appearance="dark" as="style">

    <style data-hs-appearance-onload-styles>
        * {
            transition: unset !important;
        }

        body {
            opacity: 0;
        }
    </style>

    <script>
        window.hs_config = {
            "autopath": "@@autopath",
            "deleteLine": "hs-builder:delete",
            "deleteLine:build": "hs-builder:build-delete",
            "deleteLine:dist": "hs-builder:dist-delete",
            "previewMode": false,
            "startPath": "/index.html",
            "vars": {
                "themeFont": "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap",
                "version": "?v=1.0"
            },
            "layoutBuilder": {
                "extend": {"switcherSupport": false},
                "header": {"layoutMode": "default", "containerMode": "container-fluid"},
                "sidebarLayout": "default"
            },
            "themeAppearance": {
                "layoutSkin": "dark",
                "sidebarSkin": "dark",
                "styles": {
                    "colors": {
                        "primary": "#966632",
                        "transparent": "transparent",
                        "white": "#fff",
                        "dark": "132144",
                        "gray": {"100": "#f9fafc", "900": "#1e2022"}
                    }, "font": "Inter"
                }
            },
            "languageDirection": {"lang": "{{ app()->getLocale() }}"},
            "skipFilesFromBundle": {
                "dist": ["assets/js/hs.theme-appearance.js", "assets/js/hs.theme-appearance-charts.js", "assets/js/demo.js"],
                "build": ["assets/css/theme.css", "assets/vendor/hs-navbar-vertical-aside/dist/hs-navbar-vertical-aside-mini-cache.js", "assets/js/demo.js", "assets/css/theme-dark.css", "assets/css/docs.css", "assets/vendor/icon-set/style.css", "assets/js/hs.theme-appearance.js", "assets/js/hs.theme-appearance-charts.js", "node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.min.js", "assets/js/demo.js"]
            },
            "minifyCSSFiles": ["assets/css/theme.css", "assets/css/theme-dark.css"],
            "copyDependencies": {
                "dist": {"*assets/js/theme-custom.js": ""},
                "build": {"*assets/js/theme-custom.js": "", "node_modules/bootstrap-icons/font/*fonts/**": "assets/css"}
            },
            "buildFolder": "",
            "replacePathsToCDN": {},
            "directoryNames": {"src": "./src", "dist": "./dist", "build": "./build"},
            "fileNames": {
                "dist": {"js": "theme.min.js", "css": "theme.min.css"},
                "build": {
                    "css": "theme.min.css",
                    "js": "theme.min.js",
                    "vendorCSS": "vendor.min.css",
                    "vendorJS": "vendor.min.js"
                }
            },
            "fileTypes": "jpg|png|svg|mp4|webm|ogv|json"
        }
    </script>
    <script>
        (function () {
            function resolveAdminTheme() {
                return 'dark';
            }

            function applyAdminTheme(theme) {
                document.documentElement.setAttribute('data-solidus-admin-theme', theme);
            }

            applyAdminTheme(resolveAdminTheme());

            window.addEventListener('on-hs-appearance-change', function (event) {
                applyAdminTheme(event.detail || resolveAdminTheme());
            });

            var media = window.matchMedia('(prefers-color-scheme: dark)');
            if (media && typeof media.addEventListener === 'function') {
                media.addEventListener('change', function () {
                    if ((localStorage.getItem('hs_theme') || '') === 'auto') {
                        applyAdminTheme(resolveAdminTheme());
                    }
                });
            }
        })();
    </script>
</head>

<body class="solidchange-admin-login">

<script src="{{ asset('assets/admin/js/hs.theme-appearance.js') }}"></script>

<!-- ========== MAIN CONTENT ========== -->
<main id="content" role="main" class="main">
    <!-- Content -->
    <div class="container py-5 py-sm-7">
        <a href="{{ route('home') }}" class="solidchange-admin-login-logo">
            <img src="{{ getFile(basicControl()->dark_logo_driver, basicControl()->dark_logo, true) }}"
                 alt="{{ basicControl()->site_title }}">
        </a>
        <div class="login-form mx-auto">
            @yield('content')
        </div>
    </div>
</main>
<!-- ========== END MAIN CONTENT ========== -->

<!-- JS Global Compulsory  -->
<script src="{{ asset('assets/global/js/jquery.min.js') }}"></script>
<script src="{{ asset('assets/admin/js/jquery-migrate.min.js') }}"></script>
<script src="{{ asset('assets/admin/js/bootstrap.bundle.min.js') }}"></script>
<script src="{{ asset('assets/admin/js/hs-toggle-password.js') }}"></script>
<script src="{{ asset('assets/admin/js/theme.min.js') }}"></script>

@stack('script')

<script>
    "use strict";
    $(document).ready(function () {
        window.onload = function () {
            new HSTogglePassword('.js-toggle-password')
        }
    })
</script>

</body>
</html>
