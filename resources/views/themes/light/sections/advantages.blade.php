@php
    $whyContentSingle = \App\Models\ContentDetails::with('content')
        ->whereHas('content', fn($q) => $q->where('name', 'why_choose_us')->where('type', 'single'))
        ->where('language_id', 1)
        ->first();
    $whyContentMultiple = \App\Models\ContentDetails::with('content')
        ->whereHas('content', fn($q) => $q->where('name', 'why_choose_us')->where('type', 'multiple'))
        ->where('language_id', 1)
        ->get();
@endphp
<!-- Advantages Section - eazy228/design style -->
<section class="advantages-section" id="advantages">
    <div class="container">
        <div class="advantages-header">
            <span class="section-number">06 /</span>
            <h2 class="section-title">Преимущества</h2>
        </div>

        <h3 class="advantages-subtitle">{{ $whyContentSingle ? __($whyContentSingle->description["sub_title"] ?? "") : "Почему выбирают нас" }}</h3>

        <div class="advantages-grid">
            <div class="advantage-card">
                <div class="advantage-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                        <polyline points="17 6 23 6 23 12"></polyline>
                    </svg>
                </div>
                <h4 class="advantage-title">Быстрые обмены</h4>
                <p class="advantage-text">
                    Среднее время обмена — 7 минут. Автоматическая система работает 24/7 без выходных.
                </p>
            </div>

            <div class="advantage-card">
                <div class="advantage-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    </svg>
                </div>
                <h4 class="advantage-title">Безопасность</h4>
                <p class="advantage-text">
                    Холодное хранение, мульти-подпись, AML-проверка каждой транзакции.
                </p>
            </div>

            <div class="advantage-card">
                <div class="advantage-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                    </svg>
                </div>
                <h4 class="advantage-title">Прозрачные курсы</h4>
                <p class="advantage-text">
                    Никаких скрытых комиссий. Видите итоговую сумму до подтверждения обмена.
                </p>
            </div>

            <div class="advantage-card">
                <div class="advantage-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                    </svg>
                </div>
                <h4 class="advantage-title">Поддержка 24/7</h4>
                <p class="advantage-text">
                    Отвечаем на вопросы в течение 15 минут. Онлайн-чат и поддержка по email.
                </p>
            </div>

            <div class="advantage-card">
                <div class="advantage-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                    </svg>
                </div>
                <h4 class="advantage-title">Мировой охват</h4>
                <p class="advantage-text">
                    Работаем с пользователями из 180+ стран. Поддержка множества языков.
                </p>
            </div>

            <div class="advantage-card">
                <div class="advantage-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                        <line x1="1" y1="10" x2="23" y2="10"></line>
                    </svg>
                </div>
                <h4 class="advantage-title">Удобные способы оплаты</h4>
                <p class="advantage-text">
                    Банковские карты, банковские переводы, электронные кошельки и криптовалюта.
                </p>
            </div>
        </div>
    </div>
</section>
