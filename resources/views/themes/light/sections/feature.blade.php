<!-- Feature section start -->
@if (isset($feature['single']))
    <section class="feature-section">
        <div class="feature-section-inner">
            <div class="container">
                <div class="row g-4 g-xxl-5 align-items-center">
                    <div class="col-lg-6 order-2 order-lg-1">
                        <div class="section-header">
                            <h2 class="section-title"><span class="highlight">@lang(wordSplice(@$feature['single']['title'])['exceptTwo'])</span> @lang(wordSplice(@$feature['single']['title'])['lastTwo'])
                            </h2>
                            <p class="cmn-para-text mx-auto">@lang(@$feature['single']['sub_title'])</p>
                        </div>
                        @if (isset($feature['multiple']) && count($feature['multiple']) > 0)
                            <div class="row g-3">
                                @foreach ($feature['multiple'] as $key => $value)
                                    <div class="col-12">
                                        <div class="cmn-box">
                                            <div class="icon-box">
                                                <i class="{{ $value['media']->icon }}"></i>
                                            </div>
                                            <div class="text-box">
                                                <h5>@lang($value['title'])</h5>
                                                <span>@lang($value['sub_title'])</span>
                                            </div>
                                        </div>
                                    </div>
                                @endforeach
                            </div>
                        @endif
                    </div>
                    <div class="col-lg-6 order-1 order-lg-2">
                        <div class="feature-thumbs">
                            {{-- <img src="{{getFile(@$feature['single']['media']->image->driver,@$feature['single']['media']->image->path)}}" alt="..."> --}}
                            <div class="orbit">
                                <img src="./assets/upload/contents/orbit.png" alt="">
                            </div>
                            <div class="bitcoin">
                                <img src="./assets/upload/contents/bitcoin.png" alt="">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="bg-gradiend1">
            <div class="bg-gradiend1-inner"></div>
        </div>
        <div class="shape shape3 opacity-100">
            <img src="{{ asset($themeTrue . 'img/coin/5.png') }}" alt="...">
        </div>
    </section>
@endif
<!-- Feature section end -->
