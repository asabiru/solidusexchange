<!-- Faq section start -->
@if (isset($faq))
    <section class="faq-section">
        <div class="container">
            <div class="sc-faq-inner">
                <div class="sc-section-head text-center">
                    <div>
                        @if (isset($faq['single']))
                            <span class="sc-kicker">@lang(@$faq['single']['sub_title'])</span>
                            <h2>@lang(@$faq['single']['title'])</h2>
                        @endif
                    </div>
                </div>
                @if (isset($faq['multiple']) && count($faq['multiple']) > 0)
                    <div class="accordion" id="scFaqAccordion">
                        @foreach ($faq['multiple'] as $key => $item)
                            <div class="accordion-item">
                                <h2 class="accordion-header" id="scFaqHeading{{ $key }}">
                                    <button class="accordion-button {{ $key != 0 ? 'collapsed' : '' }}"
                                        type="button" data-bs-toggle="collapse"
                                        data-bs-target="#scFaqCollapse{{ $key }}"
                                        aria-expanded="{{ $key == 0 ? 'true' : 'false' }}"
                                        aria-controls="scFaqCollapse{{ $key }}">
                                        @lang(@$item['title'])
                                    </button>
                                </h2>
                                <div id="scFaqCollapse{{ $key }}"
                                    class="accordion-collapse collapse {{ $key == 0 ? 'show' : '' }}"
                                    aria-labelledby="scFaqHeading{{ $key }}"
                                    data-bs-parent="#scFaqAccordion">
                                    <div class="accordion-body">
                                        <p>@lang(@$item['sub_title'])</p>
                                    </div>
                                </div>
                            </div>
                        @endforeach
                    </div>
                @endif
                <div class="sc-faq-cta">
                    <p>@lang('Не нашли ответа?')</p>
                    <a href="{{ route('contact') }}" class="sc-secondary-btn">@lang('Написать в поддержку')</a>
                </div>
            </div>
        </div>
        <div class="bg-shape1"></div>
    </section>
@endif
<!-- Faq section end -->
