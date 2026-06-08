@extends('admin.layouts.app')
@section('page_title',__('Add Exchange Wallet'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.exchangeWalletIndex') }}">@lang('Exchange Wallets')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Add Exchange Wallet')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Add Exchange Wallet')</h1>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-body">
                <form action="{{ route('admin.exchangeWalletStore') }}" method="post">
                    @csrf
                    @include('admin.exchange-wallet._form')
                    <button type="submit" class="btn btn-primary">@lang('Save Changes')</button>
                </form>
            </div>
        </div>
    </div>
@endsection
