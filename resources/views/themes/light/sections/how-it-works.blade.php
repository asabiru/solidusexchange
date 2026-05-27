@php
    $currentLangId = \App\Models\Language::where('short_name', app()->getLocale())->first()?->id ?? 1;
    $defaultLangId = \App\Models\Language::where('default_status', true)->first()?->id ?? 1;

    $howContentSingle = \App\Models\ContentDetails::with('content')
        ->whereHas('content', fn($q) => $q->where('name', 'how_it_work')->where('type', 'single'))
        ->withoutGlobalScope('language')
        ->where('language_id', $currentLangId)
        ->first();
    $howContentSingle = $howContentSingle ?? \App\Models\ContentDetails::with('content')
        ->whereHas('content', fn($q) => $q->where('name', 'how_it_work')->where('type', 'single'))
        ->withoutGlobalScope('language')
        ->where('language_id', $defaultLangId)
        ->first();

    $howContentMultiple = \App\Models\ContentDetails::with('content')
        ->whereHas('content', fn($q) => $q->where('name', 'how_it_work')->where('type', 'multiple'))
        ->withoutGlobalScope('language')
        ->where('language_id', $currentLangId)
        ->get();
    if ($howContentMultiple->isEmpty()) {
        $howContentMultiple = \App\Models\ContentDetails::with('content')
            ->whereHas('content', fn($q) => $q->where('name', 'how_it_work')->where('type', 'multiple'))
            ->withoutGlobalScope('language')
            ->where('language_id', $defaultLangId)
            ->get();
    }
@endphp
<!-- HowItWorks Section - eazy228/design style -->
<section class="how-it-works-section" id="how">
    <div class="container">
        <div class="how-header">
            <span class="section-number">05 /</span>
            <h2 class="section-title">Как работает сервис</h2>
        </div>

        <h3 class="how-subtitle">{{ $howContentSingle ? __($howContentSingle->description->sub_title ?? "") : "Четыре шага. Без скрытых этапов." }}</h3>

        <div class="how-steps">
            <div class="how-step">
                <div class="step-number">01</div>
                <div class="step-connector"></div>
                <div class="step-content">
                    <h4 class="step-title">Выбираете пару и сумму</h4>
                    <p class="step-text">
                        Вводите сумму отправки — курс, комиссии и итоговая сумма рассчитываются в реальном времени.
                    </p>
                </div>
            </div>

            <div class="how-step">
                <div class="step-number">02</div>
                <div class="step-connector"></div>
                <div class="step-content">
                    <h4 class="step-title">Указываете адрес получения</h4>
                    <p class="step-text">
                        Адрес проверяется на формат сети и контрольную сумму — мы предупреждаем, если сеть не совпадает.
                    </p>
                </div>
            </div>

            <div class="how-step">
                <div class="step-number">03</div>
                <div class="step-connector"></div>
                <div class="step-content">
                    <h4 class="step-title">Отправляете криптовалюту</h4>
                    <p class="step-text">
                        Реквизиты с QR и точной суммой. Курс зафиксирован на 15 минут с момента подтверждения.
                    </p>
                </div>
            </div>

            <div class="how-step">
                <div class="step-number">04</div>
                <div class="step-content">
                    <h4 class="step-title">Получаете обмен</h4>
                    <p class="step-text">
                        После N подтверждений сети средства уходят на ваш кошелёк. В среднем — 7 минут.
                    </p>
                </div>
            </div>
        </div>

        <div class="how-footer">
            <div class="time-info">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span>Среднее время операции: ~7 минут</span>
            </div>
        </div>
    </div>
</section>
