<!-- Faq section start -->
@if (isset($faq))
    <section class="faq-section">
        <div class="container">
            <div class="row g-4 g-sm-5 align-items-center">
                @if (isset($faq['single']))
                    <div class="col-lg-6">
                        <div class="faq-thum">
                            {{-- <img
                                src="{{getFile(@$faq['single']['media']->image->driver,@$faq['single']['media']->image->path)}}"
                                alt="..."> --}}
                            <div class="faq-img">
                                <img src="./assets/upload/contents/faq-img.png" alt="">
                            </div>
                            <div class="question-mark">
                                <img src="./assets/upload/contents/question-mark.png" alt="">
                            </div>
                        </div>
                    </div>
                @endif
                <div class="col-lg-6">
                    <div class="faq-content">
                        @if (isset($faq['single']))
                            <div class="section-header">
                                <h2 class="section-title">@lang(@$faq['single']['title'])</h2>
                                <p class="cmn-para-text mx-auto">@lang(@$faq['single']['sub_title'])</p>
                            </div>
                        @endif
                        @if (isset($faq['multiple']) && count($faq['multiple']) > 0)
                            <div class="accordion" id="accordionExample2">
                                @foreach ($faq['multiple'] as $key => $item)
                                    <div class="accordion-item">
                                        <h2 class="accordion-header" id="headin{{ $key }}">
                                            <button class="accordion-button {{ $key != 0 ? 'collapsed' : '' }}"
                                                type="button" data-bs-toggle="collapse"
                                                data-bs-target="#collapse{{ $key }}" aria-expanded="true"
                                                aria-controls="collapse{{ $key }}">
                                                @lang(@$item['title'])
                                            </button>
                                        </h2>
                                        <div id="collapse{{ $key }}"
                                            class="accordion-collapse collapse {{ $key == 0 ? 'show' : '' }}"
                                            aria-labelledby="headin{{ $key }}"
                                            data-bs-parent="#accordionExample2">
                                            <div class="accordion-body">
                                                <div class="table-responsive">
                                                    <p>@lang(@$item['sub_title'])</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                @endforeach
                            </div>
                        @endif
                    </div>
                </div>
            </div>
        </div>
        <div class="bg-shape1"></div>
    </section>
@endif
<!-- Faq section end -->
