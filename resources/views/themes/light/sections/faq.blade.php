<!-- Faq section start -->
@php
    $scFaq = [
        ['q' => 'Как работает обмен криптовалюты?', 'a' => 'Вы выбираете пару, вводите сумму, указываете адрес получения. Мы фиксируем курс, вы переводите средства, после подтверждений сети мы отправляем результат на ваш кошелёк.'],
        ['q' => 'Сколько времени занимает обмен?', 'a' => 'Медианное время — около 7 минут. Скорость зависит от сети отправителя и количества подтверждений.'],
        ['q' => 'Можно ли отследить статус обмена?', 'a' => 'Да, на странице отслеживания можно ввести ID заявки или email и увидеть текущий этап операции.'],
        ['q' => 'Какие комиссии вы берёте?', 'a' => 'Сервисная комиссия видна в карточке обмена до подтверждения. Дополнительно учитывается комиссия сети получателя.'],
        ['q' => 'Нужно ли проходить KYC?', 'a' => 'Для стандартных операций KYC может не требоваться. При повышенных лимитах действует понятная процедура идентификации.'],
        ['q' => 'Как проверить ваши резервы?', 'a' => 'В блоке резервов опубликованы активы и сети. Адреса холодных кошельков можно проверить в blockchain-explorer.'],
    ];
@endphp
<section class="sc-section sc-faq" id="faq">
    <div class="container">
        <div class="sc-faq-inner">
            <div class="sc-section-head text-center">
                <div>
                    <span class="sc-kicker">@lang('09 / Частые вопросы')</span>
                    <h2>@lang('Ответы на главное')</h2>
                </div>
            </div>
            <div class="accordion" id="scFaqAccordion">
                @foreach($scFaq as $key => $item)
                    <div class="accordion-item">
                        <h2 class="accordion-header" id="scFaqHeading{{ $key }}">
                            <button class="accordion-button {{ $key === 0 ? '' : 'collapsed' }}"
                                    type="button"
                                    data-bs-toggle="collapse"
                                    data-bs-target="#scFaqCollapse{{ $key }}"
                                    aria-expanded="{{ $key === 0 ? 'true' : 'false' }}"
                                    aria-controls="scFaqCollapse{{ $key }}">
                                @lang($item['q'])
                            </button>
                        </h2>
                        <div id="scFaqCollapse{{ $key }}"
                             class="accordion-collapse collapse {{ $key === 0 ? 'show' : '' }}"
                             aria-labelledby="scFaqHeading{{ $key }}"
                             data-bs-parent="#scFaqAccordion">
                            <div class="accordion-body">
                                <p>@lang($item['a'])</p>
                            </div>
                        </div>
                    </div>
                @endforeach
            </div>
            <div class="sc-faq-cta">
                <p>@lang('Не нашли ответа?')</p>
                <a href="{{ route('contact') }}" class="sc-secondary-btn">@lang('Написать в поддержку')</a>
            </div>
        </div>
    </div>
</section>
<!-- Faq section end -->
