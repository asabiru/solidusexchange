@php
    $solidusSeoReplace = [
        'Coinectra: Crypto Exchange Script for Easy Coin Swaps and Fiat Support' => 'Solidus — быстрый и безопасный обмен криптовалюты',
        'Launch your own cryptocurrency exchange platform like Changelly with Coinectra. Our script offers instant coin swaps, fiat integration, and an easy-to-use interface.' => 'Solidus помогает быстро обменивать криптовалюту с AML-проверкой, фиксированным курсом и поддержкой в Telegram.',
        'Coinectra' => 'Solidus',
    ];
    $solidusMetaTitle = str_replace(array_keys($solidusSeoReplace), array_values($solidusSeoReplace), (string) ($pageSeo['meta_title'] ?? ''));
    $solidusMetaDescription = str_replace(array_keys($solidusSeoReplace), array_values($solidusSeoReplace), (string) ($pageSeo['meta_description'] ?? ''));
    $solidusOgDescription = str_replace(array_keys($solidusSeoReplace), array_values($solidusSeoReplace), (string) ($pageSeo['og_description'] ?? ''));
@endphp
<meta content="{{ $solidusMetaDescription }}" name="description">
<meta
    content="{{ is_array(@$pageSeo['meta_keywords']) ? implode(', ', @$pageSeo['meta_keywords']) : @$pageSeo['meta_keywords'] }}"
    name="keywords">
<meta name="theme-color" content="{{ basicControl()->primary_color }}">
<meta name="author" content="{{basicControl()->site_title}}">
<meta name="robots" content="{{ isset($pageSeo['meta_robots']) ? $pageSeo['meta_robots'] : '' }}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="{{ isset(basicControl()->site_title) ? basicControl()->site_title : '' }}">
<meta property="og:title" content="{{ $solidusMetaTitle }}">
<meta property="og:description" content="{{ $solidusOgDescription }}">
<meta property="og:image" content="{{  @$pageSeo['meta_image']}}">

<meta name="twitter:card" content="{{ $solidusMetaTitle }}">
<meta name="twitter:title" content="{{ $solidusMetaTitle }}">
<meta name="twitter:description"
      content="{{ $solidusMetaDescription }}">
<meta name="twitter:image" content="{{  @$pageSeo['meta_image'] }}">
