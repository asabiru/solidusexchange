<!-- How it works section start -->

@if (isset($how_it_work))
    <section class="how-it-work">
        <div class="container">
            <div class="row g-4 g-xxl-5 align-items-center">
                @if (isset($how_it_work['single']))
                    <div class="col-xxl-5 col-lg-6">
                        <div class="how-it-work-thumbs">
                            {{-- <img
                                src="{{getFile(@$how_it_work['single']['media']->image->driver,@$how_it_work['single']['media']->image->path)}}"
                                alt="..."> --}}
                            <img class="img-1" src="./assets/upload/contents/work-process-img.png" alt="">
                            <div class="border-round">
                                <img class="" src="./assets/upload/contents/border-round.png" alt="">
                            </div>
                            <div class="img-info-box">
                                <div class="icon-box">
                                    <i class="fa-regular fa-gear"></i>
                                </div>
                                <div class="text-box">@lang('Our working process')</div>
                            </div>
                        </div>
                    </div>
                @endif
                <div class="col-xxl-7 col-lg-6">
                    @if (isset($how_it_work['single']))
                        <div class="section-header">
                            <h2 class="section-title">@lang(wordSplice(@$how_it_work['single']['title'], 3)['exceptTwo'])
                                <span class="highlight">@lang(wordSplice(@$how_it_work['single']['title'], 3)['lastTwo'])</span>
                            </h2>
                            <p class="cmn-para-text">@lang(@$how_it_work['single']['sub_title'])</p>
                        </div>
                    @endif
                    @if (isset($how_it_work['multiple']) && count($how_it_work['multiple']) > 0)
                        <div class="cmn-list">
                            @foreach ($how_it_work['multiple'] as $key => $value)
                                <div class="item">
                                    <div class="number">{{ ++$key }}</div>
                                    <div class="content">
                                        <h5>@lang($value['title'])</h5>
                                        <p>@lang($value['sub_title'])</p>
                                    </div>
                                </div>
                            @endforeach
                        </div>
                    @endif
                </div>
            </div>
        </div>
        <div class="bg-shape1"></div>
    </section>
@endif
<!-- How it works section start -->
