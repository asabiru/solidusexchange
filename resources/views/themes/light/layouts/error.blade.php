<!DOCTYPE html>
<head data-base_url="{{url('/')}}" data-theme="{{basicControl()->default_mode??'dark'}}" data-changeable_mode="{{basicControl()->changeable_mode??0}}"
      data-light_logo="{{ getFile(basicControl()->logo_driver,basicControl()->logo) }}"
      data-dark_logo="{{ getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo) }}">
	<meta charset="UTF-8"/>
	<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
	<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
	<link rel="icon" type="image/x-icon" href="{{ getFile(basicControl()->favicon_driver,basicControl()->favicon) }}"/>
	<title>{{config('basic.site_title')}}</title>

	<link rel="stylesheet" href="{{ asset($themeTrue . 'css/bootstrap.min.css')}}"/>
	<link rel="stylesheet" href="{{ asset($themeTrue . 'css/style.css')}}"/>
	<link rel="stylesheet" href="{{ asset('assets/global/css/solidus-theme.css') }}"/>

	<script src="{{ asset($themeTrue . 'js/jquery-3.6.1.min.js') }}"></script>
	<script src="{{ asset($themeTrue . 'js/bootstrap.bundle.min.js')}}"></script>
	<script src="{{ asset($themeTrue . 'js/main.js') }}"></script>

</head>

<body class="">

@yield('content')

</body>
</html>
