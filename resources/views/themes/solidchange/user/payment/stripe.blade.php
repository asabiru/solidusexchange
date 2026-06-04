@extends($theme.'layouts.app')
@section('title')
    {{ __('Pay with ').__(optional($deposit->gateway)->name) }}
@endsection
@push('style')
    <link href="{{ asset('assets/global/css/stripe.css') }}" rel="stylesheet" type="text/css">
@endpush
@section('content')
    <section class="calculator-details-section">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col-md-5">
                    <div class="checkout-section">
                        <div class="card-body">
                            <div class="row justify-content-center">
                                <div class="col-md-3">
                                    <img
                                        src="{{ getFile(optional($deposit->gateway)->driver, optional($deposit->gateway)->image) }}"
                                        class="card-img-top gateway-img">
                                </div>
                                <div class="col-md-6">
                                    <h5 class="my-3">@lang('Please Pay') {{getAmount($deposit->payable_amount)}} {{$deposit->payment_method_currency}}</h5>
                                    <form action="{{ $data->url }}" method="{{ $data->method }}">
                                        @csrf
                                        <script src="{{ $data->src }}" class="stripe-button"
                                                @foreach($data->val as $key=> $value)
                                                    data-{{$key}}="{{$value}}"
                                            @endforeach>
                                        </script>
                                    </form>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection

@push('extra_scripts')
    <script src="https://js.stripe.com/v3/"></script>
@endpush


