@extends('admin.layouts.app')
@section('page_title','Ценообразование')
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <h1 class="page-header-title">Ценообразование</h1>
                    <p class="text-muted mb-0">Все расходы зашиваются в курс. Клиент видит только курс и сумму — без отдельных комиссий.</p>
                </div>
            </div>
        </div>

        <form action="{{ route('admin.pricingSettingsUpdate') }}" method="POST">
            @csrf
            <div class="row">
                <div class="col-lg-6 mb-4">
                    <div class="card h-100">
                        <div class="card-header"><h5 class="card-header-title">Глобальные расходы</h5></div>
                        <div class="card-body">
                            <div class="mb-3">
                                <label class="form-label">AML за сделку (USD)</label>
                                <input type="number" step="0.01" min="0" name="aml_fee_usd" class="form-control" value="{{ $settings['aml_fee_usd'] }}">
                                <small class="text-muted">Списывается на каждой сделке.</small>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">KYC за верификацию (USD)</label>
                                <input type="number" step="0.01" min="0" name="kyc_fee_usd" class="form-control" value="{{ $settings['kyc_fee_usd'] }}">
                                <small class="text-muted">Разово на первую сделку клиента.</small>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">НСПК / СБП-эквайринг, %</label>
                                <input type="number" step="0.0001" min="0" max="100" name="nspk_percent" class="form-control" value="{{ $settings['nspk_percent'] }}">
                                <small class="text-muted">Применяется только к способам с включённым НСПК (см. справа).</small>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Налог УСН (доход−расход), %</label>
                                <input type="number" step="0.0001" min="0" max="100" name="usn_tax_percent" class="form-control" value="{{ $settings['usn_tax_percent'] }}">
                                <small class="text-muted">Применяется только к способам с включённым налогом.</small>
                            </div>
                            <div class="form-check form-switch">
                                <input class="form-check-input" type="checkbox" role="switch" id="allIn" name="all_in_rate_enabled" value="1" {{ $settings['all_in_rate_enabled'] ? 'checked' : '' }}>
                                <label class="form-check-label" for="allIn">Включить модель «всё в курсе» (мастер-переключатель)</label>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-lg-6 mb-4">
                    <div class="card h-100">
                        <div class="card-header"><h5 class="card-header-title">Профили способов оплаты</h5></div>
                        <div class="card-body">
                            <p class="text-muted small">Отметьте, какие расходы применяются к каждому способу. Комиссия сети задаётся в карточке монеты, маржа — там же по направлениям.</p>
                            <div class="table-responsive">
                                <table class="table table-sm align-middle">
                                    <thead><tr><th>Способ</th><th class="text-center">НСПК</th><th class="text-center">Налог УСН</th></tr></thead>
                                    <tbody>
                                    @foreach($gateways as $gw)
                                        @php $p = $profiles[(string)$gw->id] ?? ['apply_nspk'=>false,'apply_tax'=>false]; @endphp
                                        <tr>
                                            <td>{{ $gw->name }} <span class="text-muted">#{{ $gw->id }}</span></td>
                                            <td class="text-center">
                                                <input type="checkbox" name="gateway[{{ $gw->id }}][apply_nspk]" value="1" {{ !empty($p['apply_nspk']) ? 'checked' : '' }}>
                                            </td>
                                            <td class="text-center">
                                                <input type="checkbox" name="gateway[{{ $gw->id }}][apply_tax]" value="1" {{ !empty($p['apply_tax']) ? 'checked' : '' }}>
                                            </td>
                                        </tr>
                                    @endforeach
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="d-flex justify-content-end">
                <button type="submit" class="btn btn-primary">Сохранить</button>
            </div>
        </form>
    </div>
@endsection
