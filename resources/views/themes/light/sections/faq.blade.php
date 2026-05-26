@php
    $faqs = [
        [
            'question' => 'Как быстро происходит обмен?',
            'answer' => 'Среднее время обмена — 7 минут. Это включает время на подтверждение транзакции в сети и отправку средств на ваш кошелёк.'
        ],
        [
            'question' => 'Какие лимиты на обмен?',
            'answer' => 'Минимальная сумма обмена — $10 или эквивалент в криптовалюте. Максимальная сумма зависит от выбранной криптовалюты и может достигать $50,000 за одну транзакцию.'
        ],
        [
            'question' => 'Нужна ли верификация?',
            'answer' => 'Для сумм до $1,000 в сутки верификация не требуется. Для больших сумм может потребоваться стандартная KYC процедура, которая занимает около 5 минут.'
        ],
        [
            'question' => 'Какие комиссии вы берете?',
            'answer' => 'Мы берем только комиссию сервиса, которая уже включена в курс. Никаких скрытых платежей или дополнительных сборов.'
        ],
        [
            'question' => 'Что делать, если обмен не прошел?',
            'answer' => 'Если обмен не прошел по техническим причинам, средства будут автоматически возвращены на ваш кошелёк. Если у вас есть вопросы, свяжитесь с нашей поддержкой.'
        ]
    ];
@endphp

<!-- FAQ Section - eazy228/design style -->
<section class="faq-section" id="faq">
    <div class="container">
        <div class="faq-header">
            <span class="section-number">09 /</span>
            <h2 class="section-title">FAQ</h2>
        </div>

        <h3 class="faq-subtitle">Часто задаваемые вопросы</h3>

        <div class="faq-accordion">
            @foreach($faqs as $index => $faq)
            <div class="faq-item">
                <button class="faq-question {{ $index === 0 ? 'active' : '' }}" onclick="toggleFaq({{ $index }})">
                    <span>{{ $faq['question'] }}</span>
                    <svg class="faq-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <div class="faq-answer {{ $index === 0 ? 'show' : '' }}" id="faq-answer-{{ $index }}">
                    <p>{{ $faq['answer'] }}</p>
                </div>
            </div>
            @endforeach
        </div>

        <div class="faq-footer">
            <p class="faq-footer-text">Не нашли ответ на свой вопрос?</p>
            <a href="{{ route('contact') }}" class="faq-footer-link">Написать в поддержку</a>
        </div>
    </div>
</section>

<script>
function toggleFaq(index) {
    const allItems = document.querySelectorAll('.faq-item');
    const allAnswers = document.querySelectorAll('.faq-answer');
    const allQuestions = document.querySelectorAll('.faq-question');

    allItems.forEach((item, i) => {
        const answer = document.getElementById(`faq-answer-${i}`);
        const question = item.querySelector('.faq-question');

        if (i === index) {
            answer.classList.toggle('show');
            question.classList.toggle('active');
        } else {
            answer.classList.remove('show');
            question.classList.remove('active');
        }
    });
}
</script>