@extends($theme . 'layouts.app')
@section('title','SolidChange - Криптовалютная биржа')

@section('breadcrumb')
    <!-- No breadcrumb on homepage -->
@endsection

@section('content')

<!-- Hero Section with Exchange -->
<section class="hero-section" id="exchange">
    @include($theme . 'sections.hero')
</section>

<!-- Rates Section -->
<section class="rates-section" id="rates">
    @include($theme . 'sections.rates')
</section>

<!-- Popular Cryptos Section -->
<section class="popular-cryptos-section">
    @include($theme . 'sections.popular-cryptos')
</section>

<!-- Security & AML Section -->
<section class="security-aml-section">
    @include($theme . 'sections.security-aml')
</section>

<!-- How It Works Section -->
<section class="how-it-works-section" id="how">
    @include($theme . 'sections.how-it-works')
</section>

<!-- Advantages Section -->
<section class="advantages-section">
    @include($theme . 'sections.advantages')
</section>

<!-- Reserves Section -->
<section class="reserves-section" id="reserves">
    @include($theme . 'sections.reserves')
</section>

<!-- Reviews Section -->
<section class="reviews-section">
    @include($theme . 'sections.reviews')
</section>

<!-- FAQ Section -->
<section class="faq-section" id="faq">
    @include($theme . 'sections.faq')
</section>

<!-- Footer -->
<section class="footer-section">
    @include($theme . 'sections.footer')
</section>

@endsection