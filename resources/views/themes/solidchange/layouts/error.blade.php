<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head data-base_url="{{url('/')}}" data-theme="dark" data-changeable_mode="0"
      data-light_logo="{{ getFile(basicControl()->logo_driver,basicControl()->logo) }}"
      data-dark_logo="{{ getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo) }}">
	<meta charset="UTF-8"/>
	<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
	<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
	<link rel="icon" type="image/x-icon" href="{{ getFile(basicControl()->favicon_driver,basicControl()->favicon) }}"/>
	<title>@yield('title', '404') | {{config('basic.site_title')}}</title>

	<link rel="stylesheet" href="{{ asset($themeTrue . 'css/bootstrap.min.css')}}"/>
	<link rel="stylesheet" href="{{ asset($themeTrue . 'css/style.css')}}"/>
	<link rel="stylesheet" href="{{ asset('assets/global/css/solidus-theme.css') }}"/>

	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&display=swap" rel="stylesheet">

	<style>
		:root { --sc-bg:#0b0608; --sc-surface:#150c10; --sc-text:#f5ede4; --sc-muted:#9a8e86;
			--sc-dim:#5e534d; --sc-gold:#e8c9a0; --sc-gold-2:#f2d8b4; --sc-border:rgba(255,255,255,.08); }
		* { box-sizing:border-box; }
		html, body {
			margin:0; min-height:100vh;
			background:
				radial-gradient(ellipse 70% 55% at 50% -10%, rgba(232,201,160,.10), transparent 60%),
				radial-gradient(ellipse 60% 50% at 85% 8%, rgba(232,201,160,.05), transparent 55%),
				var(--sc-bg) !important;
			color:var(--sc-text) !important;
			font-family:"Geist", system-ui, -apple-system, "Segoe UI", sans-serif !important;
			-webkit-font-smoothing:antialiased;
		}
		.sc-error-grid {
			position:fixed; inset:0; z-index:0; pointer-events:none;
			background-image:
				linear-gradient(to right, rgba(255,255,255,.022) 1px, transparent 1px),
				linear-gradient(to bottom, rgba(255,255,255,.022) 1px, transparent 1px);
			background-size:46px 46px;
			-webkit-mask-image:radial-gradient(ellipse at center, #000 28%, transparent 72%);
			        mask-image:radial-gradient(ellipse at center, #000 28%, transparent 72%);
		}
		.sc-error-wrap {
			position:relative; z-index:1; min-height:100vh;
			display:flex; flex-direction:column; align-items:center; justify-content:center;
			text-align:center; padding:40px 20px; gap:8px;
		}
		.sc-error-logo { display:inline-flex; margin-bottom:28px; }
		.sc-error-logo img { height:46px; width:auto;
			filter:drop-shadow(0 0 14px rgba(232,201,160,.35)); }

		.error-section, .error-section .container, .error-section .row { width:100%; margin:0; }
		.error-section .row { display:flex; justify-content:center; }
		.error-thum { display:none !important; }
		.error-section [class*="col-"] { max-width:640px; flex:0 0 auto; }
		.error-content { text-align:center; }

		.error-title {
			font-family:"Geist", sans-serif;
			font-size:clamp(96px, 18vw, 180px); font-weight:800; line-height:.9;
			letter-spacing:-.04em; margin:0 0 6px;
			background:linear-gradient(135deg, var(--sc-gold) 0%, var(--sc-gold-2) 45%, #b9966a 100%);
			-webkit-background-clip:text; background-clip:text;
			-webkit-text-fill-color:transparent; color:transparent;
		}
		.error-info {
			font-size:clamp(16px, 2.4vw, 20px); font-weight:500; line-height:1.5;
			color:var(--sc-muted); max-width:540px; margin:0 auto 30px;
		}
		.error-info .text-gradient { color:var(--sc-gold); -webkit-text-fill-color:initial; }

		.btn-area { display:flex; justify-content:center; }
		.cmn-btn, a.cmn-btn {
			display:inline-flex; align-items:center; justify-content:center; gap:.5rem;
			height:48px; padding:0 26px; border-radius:999px;
			background:linear-gradient(135deg, var(--sc-gold), var(--sc-gold-2));
			color:#0b0608 !important; font-weight:600; font-size:15px;
			text-decoration:none; border:0; transition:filter .18s ease, transform .18s ease, box-shadow .18s ease;
			box-shadow:0 10px 30px rgba(232,201,160,.18);
		}
		.cmn-btn:hover, a.cmn-btn:hover { filter:brightness(1.05); transform:translateY(-1px);
			box-shadow:0 14px 36px rgba(232,201,160,.28); color:#0b0608 !important; }

		/* Instruction / coming-soon page */
		.sc-info-icon { display:flex; justify-content:center; margin-bottom:24px;
			color:var(--sc-gold); opacity:.6; filter:drop-shadow(0 0 16px rgba(232,201,160,.25)); }
		.error-info.font-30 { font-size:clamp(26px, 4vw, 40px); font-weight:700; line-height:1.18;
			letter-spacing:-.02em; color:var(--sc-text); margin:0 auto 14px; max-width:680px; }
		.error-info.font-30 .text-gradient, .sc-info-text .text-gradient {
			color:var(--sc-gold); -webkit-text-fill-color:initial; }
		.sc-info-text { font-size:clamp(14px, 2vw, 16px); line-height:1.65; color:var(--sc-muted);
			max-width:580px; margin:0 auto 32px; }
	</style>
</head>

<body class="sc-error-body">
	<div class="sc-error-grid" aria-hidden="true"></div>
	<div class="sc-error-wrap">
		<a href="{{url('/')}}" class="sc-error-logo">
			<img src="{{ getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo) }}" alt="{{ basicControl()->site_title }}">
		</a>
		@yield('content')
	</div>

	<script src="{{ asset($themeTrue . 'js/jquery-3.6.1.min.js') }}"></script>
	<script src="{{ asset($themeTrue . 'js/bootstrap.bundle.min.js')}}"></script>
</body>
</html>
