@extends($theme . 'layouts.calculation')
@section('title',trans('Tracking'))
@section('content')
    <section class="tracking-section">
        <div class="container">
            <div class="row">
                <div class="col-xl-7 col-lg-8 mx-auto text-center">
                    <h2 class="mb-30">@lang("Track your trade")</h2>
                    <div class="tracking-card">
                        <div class="icon-area">
                            <i class="fad fa-search-location"></i>
                        </div>
                        <h4 class="mb-10">@lang("Enter your transaction id")</h4>
                        <form class="search-box2" method="GET" action="{{route('tracking')}}">
                            <input type="text" value="{{@request()->trx_id}}" name="trx_id" class="form-control"
                                   id="search-box2"
                                   placeholder="e.g 65defbe618d07">
                            <button type="submit" class="search-btn2">@lang("Track")</button>
                        </form>
                    </div>
                </div>
            </div>
            @if(isset($type) && $type == 'exchange')
                @include($theme.'exchangeTruck')
            @endif
            @if(isset($type) && $type == 'buy')
                @include($theme.'buyTruck')
            @endif
            @if(isset($type) && $type == 'sell')
                @include($theme.'sellTruck')
            @endif
        </div>
    </section>
@endsection

