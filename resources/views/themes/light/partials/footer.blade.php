<!-- Footer Section start -->
<footer class="sc-footer" id="footer">
    <div class="container">
        <div class="sc-footer-grid">
            <div class="sc-footer-brand">
                <a href="{{ route('page') }}" class="sc-brand-mark">
                    <span>SC</span>
                    <strong>@lang(basicControl()->site_title)</strong>
                </a>
                <p>@lang('Обменник криптовалют с открытыми резервами, прозрачными комиссиями и AML-проверкой каждой сделки.')</p>
                <form action="{{ route('subscribe') }}" method="post" class="sc-footer-form">
                    @csrf
                    <input type="email" name="email" value="{{ old('email') }}" placeholder="email@example.com">
                    <button type="submit">@lang('Подписаться')</button>
                </form>
                <small>@lang('Только обновления сервиса. Без спама.')</small>
            </div>
            <div class="sc-footer-col">
                <h5>@lang('Сервис')</h5>
                <a href="#exchange">@lang('Обмен')</a>
                <a href="#rates">@lang('Курсы')</a>
                <a href="#reserves">@lang('Резервы')</a>
                <a href="{{ route('tracking') }}">@lang('Статус')</a>
            </div>
            <div class="sc-footer-col">
                <h5>@lang('Поддержка')</h5>
                <a href="#faq">FAQ</a>
                <a href="{{ route('contact') }}">@lang('Контакты')</a>
                <a href="{{ route('tracking') }}">@lang('Отследить заявку')</a>
                <a href="#reviews">@lang('Отзывы')</a>
            </div>
            <div class="sc-footer-col">
                <h5>@lang('Документы')</h5>
                <a href="{{ route('terms-and-conditions') }}">@lang('Условия использования')</a>
                <a href="{{ route('privacy-policy') }}">@lang('Политика конфиденциальности')</a>
                <a href="#security">@lang('AML-политика')</a>
                <a href="#security">@lang('KYC-политика')</a>
            </div>
        </div>
        <div class="sc-footer-disclaimer">
            <strong>@lang('Дисклеймер.')</strong>
            @lang('Криптовалюты — высокорисковый актив. Курс может меняться значительно и быстро. Используя сервис, вы подтверждаете, что осознаёте риски и соглашаетесь с условиями использования и AML-политикой.')
        </div>
        <div class="sc-footer-bottom">
            <span>© {{ date('Y') }} @lang(basicControl()->site_title). @lang('Все права защищены.')</span>
            <div>
                <span>@lang('Юрисдикция: ЕС')</span>
                <span>@lang('Регламент AML/KYC')</span>
                @if(isset($languages))
                    @foreach($languages as $item)
                        <a href="{{ route('language', ['locale' => $item->short_name, 'redirect' => request()->getRequestUri()]) }}">@lang($item->short_name)</a>
                    @endforeach
                @endif
            </div>
        </div>
    </div>
</footer>
<!-- Footer Section end -->
