@extends($theme.'layouts.error')
@section('title','404')
@section('content')
    <section class="solidus-error-section">
        <div class="solidus-error-card">
            <a class="solidus-auth-brand solidus-wordmark" href="{{ url('/') }}" aria-label="Solidus">
                <span class="solidus-wordmark__mark"></span>
                <span class="solidus-wordmark__text">SOLIDUS</span>
            </a>
            <div class="solidus-error-code">404</div>
            <h1>@lang('Страница не найдена')</h1>
            <p>@lang('Ссылка устарела или страница была перенесена. Вернитесь на главную и создайте новую заявку на обмен.')</p>
            <a href="{{ url('/') }}" class="cmn-btn">@lang('На главную')</a>
        </div>
    </section>
@endsection
