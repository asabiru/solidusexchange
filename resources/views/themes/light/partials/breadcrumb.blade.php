<!-- Banner section start -->
@php
    $routeName = \Illuminate\Support\Facades\Route::currentRouteName();
@endphp
@if(!in_array($routeName,['exchangeProcessing','exchangeProcessingOverview','exchangeInitPayment','exchangeFinal','tracking',
                          'buyProcessing','buyProcessingOverview','buyInitPayment','payment.process','buyFinal','sellProcessing',
                          'sellProcessingOverview','sellInitPayment','sellFinal']))
    @if(request()->url() != url('/'))
        <style>
            .banner-area {
                background: url({{@$pageSeo['breadcrumb_image']}});
                background-size: cover;
                background-position: 100% 75%;
            }
        </style>

        <div class="banner-area">
            <div class="container">
                <div class="row ">
                    <div class="col">
                        <div class="breadcrumb-area">
                            <h3>@lang(@$pageSeo['page_title'])</h3>
                            <ul class="breadcrumb">
                                <li class="breadcrumb-item"><a href="{{url('/')}}"><i
                                            class="fa-light fa-house"></i> @lang('Home')</a>
                                </li>
                                <li class="breadcrumb-item active"
                                    aria-current="page">@lang(@$pageSeo['page_title'])</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    @endif
@endif
<!-- Banner section end -->
