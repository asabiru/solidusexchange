@extends('admin.layouts.app')
@section('page_title',__('Set Crypto Addresses'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link"
                                                           href="javascript:void(0);">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link"
                                                           href="javascript:void(0);">@lang('Set Crypto Addresses')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@yield('page_title')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@yield('page_title')</h1>
                </div>
            </div>
        </div>
        <div class="row mx-4">
            <span class="text-danger"> <i class="fal fa-exclamation-triangle"></i> @lang("To enable exchange, make sure to set up addresses for all active cryptocurrencies. If any crypto address is left blank, that specific cryptocurrency won't be available for exchange. When adding a new cryptocurrency, please ensure to set its corresponding address.")</span>
        </div>
        <div class="content container-fluid">
            <div class="row justify-content-lg-center">
                <div class="col-lg-8">
                    <div class="d-grid gap-3 gap-lg-5">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between">
                                <h4 class="card-title mt-2">@lang('Set Crypto Addresses')</h4>
                            </div>
                            <div class="card-body mt-2">
                                <form action="{{ route('admin.cryptoMethodSetAddress').'?code=manual' }}"
                                      method="post"
                                      enctype="multipart/form-data">
                                    @csrf
                                    <div class="row">
                                        @if($cryptoCurrencies && count($cryptoCurrencies) > 0)
                                            @foreach ($cryptoCurrencies as $key => $currency)
                                                <div class="mb-3">
                                                    <div class="row">
                                                        <div class="col-md-4 d-flex align-items-center">
                                                            <label class="form-label"
                                                                   for="{{ $currency->name }}"><span
                                                                    class="legend-indicator {{$currency->status ? 'bg-success':'bg-danger'}}"></span> {{$currency->code}}
                                                                - {{$currency->name}}</label>
                                                        </div>
                                                        <div class="col-md-8">
                                                            @php
                                                                $val = "";
                                                            @endphp
                                                            @if ($method->parameters && isset($method->parameters->{$currency->code}))
                                                                @php $val = $method->parameters->{$currency->code}; @endphp
                                                            @endif
                                                            <input type="text" name="{{ $currency->code }}"
                                                                   value="{{old($currency->code,$val??null)}}"
                                                                   placeholder="{{$currency->name}}@lang(' Address')"
                                                                   class="form-control @error($currency->code) is-invalid @enderror">
                                                        </div>
                                                    </div>
                                                    @error($currency->code)
                                                    <span
                                                        class="text-danger d-flex justify-content-end">@lang($message)</span>
                                                    @enderror
                                                </div>
                                            @endforeach
                                        @endif
                                    </div>
                                    <div class="d-flex justify-content-start">
                                        <button type="submit" class="btn btn-primary">@lang('Save Changes')</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>
@endsection


@push('css-lib')

@endpush

@push('js-lib')

@endpush

@push('script')

@endpush
