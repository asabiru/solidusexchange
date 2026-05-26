<!-- Why choose us section start -->
@if (isset($why_choose_us))
    <section class="why-choose-us">
        <div class="why-choose-us-inner">
            <div class="container">
                <div class="row g-4 g-md-5 align-items-center">

                    <div class="col-lg-6">
                        <div class="why-choose-us-thum">
                            {{-- <img
                                src="{{getFile(@$why_choose_us['single']['media']->image->driver,@$why_choose_us['single']['media']->image->path)}}"
                                alt="..."> --}}
                            <div class="img-1">
                                <img src="./assets/upload/contents/why-choose-us-img-1.png" alt="">
                            </div>
                            <div class="img-2">
                                <img src="./assets/upload/contents/why-choose-us-img-2.png" alt="">
                            </div>
                            <div class="dot-2">
                                <img src="./assets/upload/contents/dot-2.png" alt="">
                            </div>
                            <div class="corner-half">
                                <img src="./assets/upload/contents/corner-half.png" alt="">
                            </div>
                            <div class="img-info-box">
                                <div class="title"><span>10</span> @lang('Years')</div>
                                <p class="sub-title mb-0">@lang('Of Experience')</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-6 ">
                        @if (isset($why_choose_us['single']))
                            <div class="section-header">
                                <h2 class="section-title"><span class="highlight">@lang(wordSplice(@$why_choose_us['single']['title'], 1)['exceptTwo'])</span>
                                    @lang(wordSplice(@$why_choose_us['single']['title'], 1)['lastTwo'])
                                </h2>
                                <p class="cmn-para-text mx-auto">@lang(@$why_choose_us['single']['sub_title'])</p>
                            </div>
                        @endif
                        @if (isset($why_choose_us['multiple']) && count($why_choose_us['multiple']) > 0)
                            <div class="row g-3">
                                @foreach ($why_choose_us['multiple'] as $key => $value)
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
                </div>
            </div>
        </div>
        <div class="bg-gradiend2">
            <div class="bg-gradiend2-inner"></div>
        </div>
    </section>
@endif
<!-- Why choose us section end -->
