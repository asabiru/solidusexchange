@extends('admin.layouts.app')
@section('page_title', __('Add Trader'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.dashboard') }}">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.traders.index') }}">@lang('Traders')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Add Trader')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Add Trader')</h1>
                </div>
            </div>
        </div>

        <form action="{{ route('admin.traders.store') }}" method="post">
            @csrf
            @include('admin.trader.partials.form', ['submitLabel' => __('Create Trader')])
        </form>
    </div>
@endsection
