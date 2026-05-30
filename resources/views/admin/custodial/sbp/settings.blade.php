@extends('admin.layouts.app')
@section('page_title','SBP QR настройки')
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">Dashboard</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.sbpIndex') }}">SBP платежи</a></li>
                            <li class="breadcrumb-item active" aria-current="page">Settings</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">SBP QR настройки</h1>
                </div>
            </div>
        </div>

        <div class="row">
            {{-- Tinkoff API --}}
            <div class="col-md-6 mb-4">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-header-title">
                            <i class="bi-bank me-2"></i>Tinkoff Business API
                            @if($tinkoff['configured'])
                                <span class="badge bg-soft-success text-success ms-2">Configured</span>
                            @else
                                <span class="badge bg-soft-danger text-danger ms-2">Не настроено</span>
                            @endif
                        </h5>
                    </div>
                    <div class="card-body">
                        <p class="text-muted small mb-3">
                            For automatic SBP QR generation and payment tracking via Tinkoff Business API.
                            Configure these values in <code>.env</code> file.
                        </p>
                        <table class="table table-sm">
                            <tr><td class="text-muted">Терминальный ключ</td><td><code>{{ $tinkoff['terminal_key'] ? str_repeat('*', 8) . substr($tinkoff['terminal_key'], -4) : 'Not set' }}</code></td></tr>
                            <tr><td class="text-muted">INN</td><td><code>{{ $tinkoff['inn'] ?: 'Not set' }}</code></td></tr>
                            <tr><td class="text-muted">Базовый URL</td><td><code>{{ $tinkoff['base_url'] }}</code></td></tr>
                            <tr><td class="text-muted">Webhook URL</td><td><code>{{ url('/sbp/webhook/tinkoff') }}</code></td></tr>
                        </table>
                        <div class="alert alert-soft-info small mt-3">
                            <i class="bi-info-circle me-1"></i>
                            Register the webhook URL in your Tinkoff Business panel.
                            Required .env variables: <code>TINKOFF_TERMINAL_KEY</code>, <code>TINKOFF_PASSWORD</code>, <code>TINKOFF_INN</code>
                        </div>
                    </div>
                </div>
            </div>

            {{-- Static QR Fallback --}}
            <div class="col-md-6 mb-4">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-header-title">
                            <i class="bi-qr-code me-2"></i>Static QR Fallback
                            @if($sbp['account_number'])
                                <span class="badge bg-soft-success text-success ms-2">Configured</span>
                            @else
                                <span class="badge bg-soft-warning text-warning ms-2">Не настроено</span>
                            @endif
                        </h5>
                    </div>
                    <div class="card-body">
                        <p class="text-muted small mb-3">
                            Used when Tinkoff API is not available. Generates a static NSPK QR code
                            with your bank account details. Payments must be confirmed manually.
                        </p>
                        <table class="table table-sm">
                            <tr><td class="text-muted">ID банка</td><td><code>{{ $sbp['bank_id'] }}</code></td></tr>
                            <tr><td class="text-muted">Номер счёта</td><td><code>{{ $sbp['account_number'] ? str_repeat('*', 8) . substr($sbp['account_number'], -4) : 'Not set' }}</code></td></tr>
                            <tr><td class="text-muted">Имя получателя</td><td><code>{{ $sbp['recipient_name'] ?: 'Not set' }}</code></td></tr>
                            <tr><td class="text-muted">INN</td><td><code>{{ $sbp['inn'] ?: 'Not set' }}</code></td></tr>
                            <tr><td class="text-muted">QR TTL</td><td><code>{{ $sbp['qr_ttl_minutes'] }} minutes</code></td></tr>
                        </table>
                        <div class="alert alert-soft-warning small mt-3">
                            <i class="bi-exclamation-triangle me-1"></i>
                            Required .env variables: <code>SBP_ACCOUNT_NUMBER</code>, <code>SBP_RECIPIENT_NAME</code>, <code>SBP_INN</code>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection
