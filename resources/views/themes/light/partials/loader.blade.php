<!-- Preloader section start -->
<div class="loader-wrap">
    <div class="preloader">
        <div class="preloader-close">x</div>
        <div id="handle-preloader" class="handle-preloader">
            <div class="animation-preloader">
                <div class="shape shape1">
                    <img src="{{asset('assets/themes/light/img/coin/coin-2.png')}}" alt="img">
                </div>
                <div class="txt-loading">
                    @foreach (str_split(basicControl()->site_title??'Coinectra') as $key => $value)
                        <span data-text-preloader="{{$value}}" class="letters-loading">
                                {{$value}}
                            </span>
                    @endforeach

                </div>
            </div>
        </div>
    </div>
</div>
<!-- Preloader section end -->


