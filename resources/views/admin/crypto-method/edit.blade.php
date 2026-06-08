@extends('admin.layouts.app')
@section('page_title',__('Update Method'))
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
                                                           href="javascript:void(0);">@lang('Update Method')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@yield('page_title')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@yield('page_title')</h1>
                </div>
            </div>
        </div>
        <div class="content container-fluid">
            <div class="row justify-content-lg-center">
                <div class="col-lg-6">
                    <div class="d-grid gap-3 gap-lg-5">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between">
                                <h4 class="card-title mt-2">@lang("Update "){{$method->name}}</h4>
                            </div>
                            <div class="card-body mt-2">
                                <form action="{{ route('admin.cryptoMethodEdit').'?id='.$method->id }}" method="post"
                                      enctype="multipart/form-data">
                                    @csrf
                                    <div class="row">
                                        @if($method->parameters)
                                            @foreach ($method->parameters as $key => $parameter)
                                                <div class="mb-3">
                                                    <label class="form-label"
                                                           for="{{ $key }}">@lang(snake2Title($key))</label>
                                                    @if($key === 'currency_map')
                                                        <textarea name="{{ $key }}" id="{{ $key }}" rows="6"
                                                                  class="form-control @error($key) is-invalid @enderror">{{ old($key, $parameter) }}</textarea>
                                                        <small class="text-muted">@lang('Use JSON or line-by-line pairs, for example: USDT=USDT_TRC20')</small>
                                                    @else
                                                        <input type="text" name="{{ $key }}"
                                                               value="{{ old($key, $parameter) }}"
                                                               id="{{ $key }}"
                                                               class="form-control @error($key) is-invalid @enderror">
                                                    @endif
                                                    <div class="invalid-feedback">
                                                        @error($key) @lang($message) @enderror
                                                    </div>
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
                @if($method->description)
                    <div class="col-lg-6">
                        <div class="d-grid gap-3 gap-lg-5">
                            <div class="card">
                                <div class="card-header d-flex justify-content-between">
                                    <h4 class="card-title mt-2">@lang("Instruction")</h4>
                                    <h4 class="card-title mt-2">@lang("How to set up")</h4>
                                </div>
                                <div class="card-body mt-2">
                                    <div class="row">
                                        <div class="mb-3">
                                            {!! $method->description !!}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                @endif
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
