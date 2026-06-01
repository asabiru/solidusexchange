<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <!-- Required Meta Tags Always Come First -->
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

    <!-- Title -->
    <title>@yield('page_title') - {{ __(basicControl()->site_title) }}</title>

    <!-- Favicon -->
    <link rel="icon" type="image/x-icon"  href="{{ getFile(basicControl()->favicon_driver, basicControl()->favicon) }}">
    <link rel="icon" type="image/svg+xml" href="{{ asset('assets/upload/logo/favicon.svg') }}">
    <link rel="apple-touch-icon" sizes="64x64" href="{{ asset('assets/upload/logo/favicon-64.png') }}">

    <!-- Font -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">

    <!-- Bootstrap CSS -->
    <link rel="stylesheet" href="{{ asset('assets/themes/light/css/bootstrap.min.css') }}">

    <!-- SolidChange Admin Theme CSS -->
    <link rel="stylesheet" href="{{ asset('assets/admin/css/custom.css') }}">
    <link rel="stylesheet" href="{{ asset('assets/global/css/solidus-theme.css') }}">

    <!-- Icons -->
    <link rel="stylesheet" href="{{ asset('assets/themes/light/css/all.min.css') }}">

    <style>
        body {
            background: var(--solidus-body-bg);
            color: var(--solidus-text);
            font-family: 'IBM Plex Sans', sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .login-container {
            width: 100%;
            max-width: 420px;
            padding: 20px;
        }

        .admin-login-card {
            background: var(--solidus-surface);
            border: 1px solid var(--solidus-border);
            border-radius: 20px;
            padding: 40px;
            box-shadow: var(--solidus-shadow);
            backdrop-filter: blur(10px);
            animation: admin-card-in 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
            will-change: transform, opacity;
        }

        .admin-logo {
            text-align: center;
            margin-bottom: 30px;
        }

        .admin-logo .logo-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 48px;
            height: 48px;
            border-radius: 12px;
            border: 1px solid var(--solidus-border-strong);
            background: linear-gradient(135deg, var(--solidus-accent) 0%, var(--solidus-accent-2) 100%);
            font-size: 18px;
            font-weight: 700;
            color: #0b0608;
            margin-bottom: 12px;
        }

        .admin-logo h3 {
            color: var(--solidus-text);
            font-weight: 600;
            margin: 0;
            font-size: 24px;
        }

        .admin-logo p {
            color: var(--solidus-muted);
            margin: 0;
            font-size: 14px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-control {
            background: var(--input-color);
            border: 1px solid var(--solidus-border);
            color: var(--solidus-text);
            border-radius: 12px;
            padding: 14px 16px;
            font-size: 15px;
            transition: all 0.2s ease;
        }

        .form-control:focus {
            border-color: var(--solidus-accent);
            box-shadow: 0 0 0 3px rgba(232, 201, 160, 0.15);
            background: var(--bg-color2);
            outline: none;
        }

        .form-control::placeholder {
            color: var(--solidus-muted);
            font-size: 13.5px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .btn-admin-login {
            width: 100%;
            background: linear-gradient(135deg, var(--solidus-accent) 0%, var(--solidus-accent-2) 100%);
            border: none;
            color: #0b0608;
            font-weight: 600;
            border-radius: 12px;
            padding: 14px;
            font-size: 16px;
            transition: all 0.2s ease;
        }

        .btn-admin-login:hover {
            background: linear-gradient(135deg, var(--solidus-accent-2) 0%, var(--solidus-accent) 100%);
            box-shadow: 0 4px 20px rgba(232, 201, 160, 0.3);
            transform: translateY(-2px);
        }

        .admin-footer {
            text-align: center;
            margin-top: 24px;
            color: var(--solidus-muted);
            font-size: 14px;
        }

        .admin-footer a {
            color: var(--solidus-accent);
            text-decoration: none;
        }

        .admin-footer a:hover {
            text-decoration: underline;
        }

        .alert {
            border-radius: 12px;
            border: none;
            margin-bottom: 20px;
        }

        .admin-transition-note {
            margin-top: 10px;
            color: var(--solidus-muted);
            font-size: 13px;
            text-align: center;
        }

        .auth-otp-grid {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 10px;
            margin-top: 8px;
        }

        .auth-otp-digit {
            width: 100%;
            height: 54px;
            text-align: center;
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 0.04em;
            padding: 0;
        }

        .admin-login-card .form-control.auth-otp-digit {
            padding-left: 0;
            padding-right: 0;
        }

        body.is-exiting .admin-login-card {
            animation: admin-card-out 220ms ease-in forwards;
        }

        body.is-exiting .admin-logo,
        body.is-exiting .form-group,
        body.is-exiting .form-check,
        body.is-exiting .admin-footer,
        body.is-exiting .admin-transition-note {
            transition: opacity 180ms ease, transform 180ms ease;
            opacity: 0.55;
            transform: translateY(4px);
            pointer-events: none;
        }

        @keyframes admin-card-in {
            from {
                opacity: 0;
                transform: translateY(18px) scale(0.985);
                filter: blur(6px);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
                filter: blur(0);
            }
        }

        @keyframes admin-card-out {
            from {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
            to {
                opacity: 0;
                transform: translateY(-10px) scale(0.99);
            }
        }

        @media (max-width: 575px) {
            .auth-otp-grid {
                gap: 8px;
            }

            .auth-otp-digit {
                height: 48px;
                font-size: 18px;
            }
        }
    </style>
</head>

<body>

<div class="login-container">
    <div class="admin-login-card">
        @yield('content')
    </div>
</div>

<!-- JS Global Compulsory  -->
<script src="{{ asset('assets/global/js/jquery.min.js') }}"></script>
<script src="{{ asset('assets/themes/light/js/bootstrap.bundle.min.js') }}"></script>

<script>
    'use strict';

    window.addEventListener('DOMContentLoaded', function () {
        document.body.classList.remove('is-exiting');

        document.querySelectorAll('form[data-auth-transition]').forEach(function (form) {
            form.addEventListener('submit', function () {
                if (document.body.classList.contains('is-exiting')) {
                    return;
                }

                document.body.classList.add('is-exiting');

                const submitButton = form.querySelector('button[type="submit"]');
                if (submitButton) {
                    submitButton.disabled = true;
                    submitButton.dataset.originalText = submitButton.innerHTML;
                    if (form.dataset.submittingText) {
                        submitButton.innerHTML = form.dataset.submittingText;
                    }
                }
            });
        });
    });
</script>

@stack('script')

</body>
</html>
