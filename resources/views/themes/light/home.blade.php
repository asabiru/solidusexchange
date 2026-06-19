@extends($theme . 'layouts.app')
@section('title','SolidChange - Криптовалютная биржа')

@section('breadcrumb')
    <!-- No breadcrumb on homepage -->
@endsection

@section('content')

<!-- Hero Section with Exchange -->
@include($theme . 'sections.hero')

<!-- Rates Section -->
@include($theme . 'sections.rates')

<!-- Popular Cryptos Section -->
@include($theme . 'sections.popular-cryptos')

<!-- Security & AML Section -->
@include($theme . 'sections.security-aml')

<!-- How It Works Section -->
@include($theme . 'sections.how-it-works')

<!-- Advantages Section -->
@include($theme . 'sections.advantages')

<!-- Reserves Section -->
@include($theme . 'sections.reserves')

<!-- Reviews Section -->
@include($theme . 'sections.reviews')

<!-- FAQ Section -->
@include($theme . 'sections.faq')

<!-- Footer -->
@include($theme . 'sections.footer')

@endsection

@section('scripts')
    @include($theme.'partials.exchange-module.exchange-js')
@endsection
