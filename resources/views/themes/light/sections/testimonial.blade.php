<!-- Testimonial section start -->
@php
    $reviews = [
        ['initials' => 'АК', 'name' => 'Артём К.', 'role' => 'Меняет дважды в неделю', 'date' => '14.05.2026', 'text' => 'Курс на странице и в реквизитах совпал до копейки. Поддержка ответила за 3 минуты, когда я перепутал сеть USDT.', 'rating' => 5],
        ['initials' => 'М', 'name' => 'Михаил', 'role' => 'Первый обмен', 'date' => '11.05.2026', 'text' => 'Интерфейс не пугает терминологией. Сразу видно, что отдаю и что получу. Резервы можно проверить — это редкость.', 'rating' => 5],
        ['initials' => 'ЕП', 'name' => 'Елена П.', 'role' => 'Малый бизнес', 'date' => '06.05.2026', 'text' => 'Подключила выплаты в RUB через СБП. Документы для бухгалтерии присылают по запросу, всё корректно.', 'rating' => 4],
    ];
@endphp
<section class="sc-section sc-reviews" id="reviews">
    <div class="container">
        <div class="sc-section-head">
            <div>
                <span class="sc-kicker">@lang('08 / Отзывы')</span>
                <h2>@lang('Что говорят пользователи')</h2>
            </div>
        </div>
        <div class="sc-card-grid sc-card-grid-3">
            @foreach($reviews as $review)
                <article class="sc-info-card">
                    <div class="sc-review-head">
                        <span class="sc-avatar">{{ $review['initials'] }}</span>
                        <div>
                            <h3>{{ $review['name'] }}</h3>
                            <p>{{ $review['role'] }} · {{ $review['date'] }}</p>
                        </div>
                        <div class="sc-stars">
                            @for($i = 1; $i <= 5; $i++)
                                <i class="{{ $i <= $review['rating'] ? 'is-active' : '' }} fa-solid fa-star"></i>
                            @endfor
                        </div>
                    </div>
                    <p>@lang($review['text'])</p>
                </article>
            @endforeach
        </div>
        <div class="sc-review-summary">
            <div class="sc-stars">
                @for($i = 1; $i <= 5; $i++)
                    <i class="is-active fa-solid fa-star"></i>
                @endfor
            </div>
            <strong>4.8 / 5.0</strong>
            <span>@lang('на основе 1 247 отзывов')</span>
            <em>Trustpilot</em>
            <em>BestChange</em>
            <em>Reviews.io</em>
        </div>
    </div>
</section>
<!-- Testimonial section end -->
