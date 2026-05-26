@extends('admin.layouts.app')
@section('page_title', __('Edit Trader'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.dashboard') }}">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.traders.index') }}">@lang('Traders')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">{{ $trader->name }}</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">{{ $trader->name }}</h1>
                </div>
            </div>
        </div>

        <form action="{{ route('admin.traders.update', $trader->id) }}" method="post">
            @csrf
            @method('put')
            @include('admin.trader.partials.form', ['submitLabel' => __('Save Changes')])
        </form>
    </div>
@endsection
