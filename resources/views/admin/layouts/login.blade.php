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

@stack('script')

</body>
</html>
