@extends('admin.layouts.app')
@section('page_title',__('Создать вывод'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.custodialWalletIndex') }}">Кастодиальные кошельки</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.custodialWithdrawals') }}">Withdrawals</a></li>
                            <li class="breadcrumb-item active" aria-current="page">New</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">Создать вывод</h1>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h5 class="card-header-title">Вывести из кошелька</h5>
            </div>
            <div class="card-body">
                <form action="{{ route('admin.custodialWithdrawalStore') }}" method="POST">
                    @csrf
                    <input type="hidden" name="wallet_id" value="{{ $wallet->id }}">

                    <div class="row mb-4">
                        <div class="col-md-6">
                            <div class="card bg-soft-light">
                                <div class="card-body">
                                    <h6>Исходный кошелёк</h6>
                                    <table class="table table-sm table-borderless mb-0">
                                        <tr>
                                            <td class="text-muted">Валюта:</td>
                                            <td><strong>{{ $wallet->currency_code }}</strong></td>
                                        </tr>
                                        <tr>
                                            <td class="text-muted">Адрес:</td>
                                            <td><code class="small">{{ $wallet->address }}</code></td>
                                        </tr>
                                        <tr>
                                            <td class="text-muted">Баланс:</td>
                                            <td><strong>{{ number_format((float)$wallet->balance, 8) }}</strong> {{ $wallet->currency_code }}</td>
                                        </tr>
                                        <tr>
                                            <td class="text-muted">Статус:</td>
                                            <td>
                                                @if($wallet->status === 'active')
                                                    <span class="badge bg-soft-success text-success">Active</span>
                                                @else
                                                    <span class="badge bg-soft-warning text-warning">{{ $wallet->status }}</span>
                                                @endif
                                            </td>
                                        </tr>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="form-label">Адрес назначения <span class="text-danger">*</span></label>
                            <input type="text" name="to_address" class="form-control" required
                                   placeholder="Введите адрес вывода">
                            <div class="form-text">The address must match the {{ $wallet->currency_code }} network format</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label class="form-label">Amount <span class="text-danger">*</span></label>
                            <div class="input-group">
                                <input type="number" name="amount" class="form-control" required
                                       step="0.00000001" min="0.00001"
                                       max="{{ $wallet->balance }}"
                                       placeholder="0.00000000">
                                <span class="input-group-text">{{ $wallet->currency_code }}</span>
                            </div>
                            <div class="form-text">Доступно: {{ number_format((float)$wallet->balance, 8) }} {{ $wallet->currency_code }}</div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="form-label">Примечание (необязательно)</label>
                            <textarea name="note" class="form-control" rows="2"
                                      placeholder="Внутренняя заметка для этого вывода"></textarea>
                        </div>
                    </div>

                    <div class="alert alert-soft-warning">
                        <i class="bi-exclamation-triangle me-1"></i>
                        <strong>Внимание:</strong> This will create a withdrawal request. Funds will only be sent after you approve and execute the withdrawal.
                        Always double-check the destination address — blockchain transactions are irreversible.
                    </div>

                    <div class="d-flex gap-2">
                        <button type="submit" class="btn btn-primary">
                            <i class="bi-send me-1"></i> Создать вывод Request
                        </button>
                        <a href="{{ route('admin.custodialWithdrawals') }}" class="btn btn-white">Cancel</a>
                    </div>
                </form>
            </div>
        </div>
    </div>
@endsection
