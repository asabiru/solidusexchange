<!-- Testimonial section start -->
@if(isset($testimonial))
    <section class="testimonial-section">
        <div class="container">
            @if(isset($testimonial['single']))
                <div class="row">
                    <div class="section-header mb-50 text-center">
                        <h2 class="">@lang(wordSplice(@$testimonial['single']['title'])['exceptTwo']) <span
                                class="highlight">@lang(wordSplice(@$testimonial['single']['title'])['lastTwo'])</span>
                        </h2>
                        <p class="cmn-para-text m-auto">@lang(@$testimonial['single']['sub_title'])</p>
                    </div>
                </div>
            @endif
            @if(isset($testimonial['multiple']) && count($testimonial['multiple']) > 0)
                <div class="row">
                    <div class="owl-carousel owl-theme testimonial-carousel">
                        @foreach($testimonial['multiple'] as $key => $testimonial)
                            <div class="item">
                                <div class="testimonial-box">
                                    <div class="testimonial-header">
                                        <div class="testimonial-title-area">
                                            <div class="testimonial-thumbs">
                                                <img
                                                    src="{{getFile(@$testimonial['media']->image->driver,@$testimonial['media']->image->path)}}"
                                                    alt="..."/>
                                            </div>
                                            <div class="testimonial-title">
                                                <h5 class="mb-0">@lang(@$testimonial['name'])</h5>
                                                <p>@lang(@$testimonial['address'])</p>
                                            </div>
                                        </div>
                                        @if($testimonial['star'])
                                            <ul class="ratings">
                                                <li>
                                                    @php
                                                        $starCount = 5;
                                                    @endphp
                                                    @for($i=0; $i< $testimonial['star']; $i++)
                                                        <i class="active fa-solid fa-star"></i>
                                                        @php
                                                            $starCount--;
                                                        @endphp
                                                    @endfor
                                                    @for($i=0; $i < $starCount; $i++)
                                                        <i class="fa-solid fa-star"></i>
                                                    @endfor
                                                </li>
                                            </ul>
                                        @endif
                                    </div>
                                    <div class="quote-area">
                                        <p>@lang($testimonial['description'])</p>
                                    </div>
                                </div>
                            </div>
                        @endforeach
                    </div>
                </div>
            @endif
        </div>
        <div class="shape shape2">
            <img src="{{$themeTrue.'img/coin/coin-1.png'}}" alt="...">
        </div>
    </section>
@endif
<!-- Testimonial section end -->
