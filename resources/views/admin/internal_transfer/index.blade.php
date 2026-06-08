@extends('admin.layouts.app')
@section('page_title', 'Internal Transfer')
@section('content')
<div class="content container-fluid">
    <div class="page-header">
        <div class="row align-items-end">
            <div class="col-sm mb-2 mb-sm-0">
                <nav aria-label="breadcrumb">
                    <ol class="breadcrumb breadcrumb-no-gutter">
                        <li class="breadcrumb-item"><a href="{{ route('admin.dashboard') }}">Dashboard</a></li>
                        <li class="breadcrumb-item active">Internal Transfer</li>
                    </ol>
                </nav>
                <h1 class="page-header-title">
                    <i class="bi-arrow-left-right me-2"></i>Internal Wallet Transfer
                </h1>
                <p class="text-body mb-0">Move crypto between custodial wallets on-chain.</p>
            </div>
        </div>
    </div>

    @if(session('success'))
        <div class="alert alert-soft-success mb-4">
            <i class="bi-check-circle-fill me-2"></i>{{ session('success') }}
        </div>
    @endif
    @if(session('error'))
        <div class="alert alert-soft-danger mb-4">
            <i class="bi-x-circle-fill me-2"></i>{{ session('error') }}
        </div>
    @endif

    <div class="row">
        {{-- Transfer Form --}}
        <div class="col-lg-5 mb-4">
            <div class="card h-100">
                <div class="card-header">
                    <h4 class="card-header-title">New Transfer</h4>
                </div>
                <div class="card-body">
                    <form id="transferForm" action="{{ route('admin.internal.transfer.store') }}" method="POST">
                        @csrf

                        <div class="mb-4">
                            <label class="form-label fw-semibold">From Wallet</label>
                            <select id="fromWallet" name="from_wallet_id" class="form-select" required>
                                <option value="">— Select source wallet —</option>
                                @foreach($wallets as $w)
                                    @if($w->encrypted_private_key)
                                    <option value="{{ $w->id }}"
                                            data-currency="{{ $w->currency_code }}"
                                            data-address="{{ $w->address }}"
                                            data-balance="{{ $w->balance }}">
                                        {{ $w->currency_code }}
                                        @if($w->trader_id)
                                            [Trader #{{ $w->trader_id }}]
                                        @else
                                            [System]
                                        @endif
                                        — {{ Str::limit($w->address, 20) }}
                                    </option>
                                    @endif
                                @endforeach
                            </select>
                            <div id="fromInfo" class="mt-2 text-muted" style="font-size:.8rem"></div>
                        </div>

                        <div class="mb-4">
                            <label class="form-label fw-semibold">To Wallet</label>
                            <select id="toWallet" name="to_wallet_id" class="form-select" required>
                                <option value="">— Select destination wallet —</option>
                                @foreach($wallets as $w)
                                    <option value="{{ $w->id }}"
                                            data-currency="{{ $w->currency_code }}"
                                            data-address="{{ $w->address }}">
                                        {{ $w->currency_code }}
                                        @if($w->trader_id)
                                            [Trader #{{ $w->trader_id }}]
                                        @else
                                            [System]
                                        @endif
                                        — {{ Str::limit($w->address, 20) }}
                                    </option>
                                @endforeach
                            </select>
                        </div>

                        <div class="mb-4">
                            <label class="form-label fw-semibold">Amount</label>
                            <div class="input-group">
                                <input type="number" name="amount" id="amount" class="form-control"
                                       placeholder="Leave empty to sweep all" min="0" step="any">
                                <span class="input-group-text" id="currencyLabel">—</span>
                            </div>
                            <small class="text-muted">Leave empty to transfer maximum available (minus gas fee).</small>
                        </div>

                        <div class="alert alert-soft-warning d-none" id="currencyWarning">
                            <i class="bi-exclamation-triangle me-1"></i>
                            Source and destination must have the same currency.
                        </div>

                        {{-- Google 2FA --}}
                        <div class="mb-4 border-top pt-4">
                            <label class="form-label fw-semibold">
                                <i class="bi-shield-lock me-1 text-warning"></i>
                                Google Authenticator Code <span class="text-danger">*</span>
                            </label>
                            <input type="text" name="two_fa_code" class="form-control form-control-lg text-center"
                                   placeholder="6-digit code" maxlength="6" inputmode="numeric"
                                   autocomplete="one-time-code" required
                                   style="letter-spacing:.5rem;font-weight:700;font-size:1.5rem">
                            <small class="text-muted">Required for every manual transfer to prevent unauthorized withdrawals.</small>
                        </div>

                        <div class="d-grid">
                            <button type="submit" class="btn btn-primary btn-lg" id="submitBtn">
                                <i class="bi-send me-1"></i> Execute Transfer
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>

        {{-- Wallets Summary --}}
        <div class="col-lg-7 mb-4">
            <div class="card">
                <div class="card-header">
                    <h4 class="card-header-title">All Wallets</h4>
                </div>
                <div class="table-responsive">
                    <table class="table table-borderless table-align-middle card-table mb-0">
                        <thead class="thead-light">
                        <tr>
                            <th>ID</th>
                            <th>Currency</th>
                            <th>Purpose</th>
                            <th>Address</th>
                            <th>Balance (cached)</th>
                            <th>Trader</th>
                        </tr>
                        </thead>
                        <tbody>
                        @foreach($wallets as $w)
                            <tr>
                                <td><span class="badge bg-soft-dark text-dark">{{ $w->id }}</span></td>
                                <td><strong>{{ $w->currency_code }}</strong></td>
                                <td>
                                    @if($w->purpose === 'payout')
                                        <span class="badge bg-soft-success text-success">payout</span>
                                    @elseif($w->purpose === 'both')
                                        <span class="badge bg-soft-primary text-primary">both</span>
                                    @else
                                        <span class="badge bg-soft-warning text-warning">deposit</span>
                                    @endif
                                </td>
                                <td><code style="font-size:.75rem">{{ Str::limit($w->address, 22) }}</code></td>
                                <td>
                                    <span id="bal-{{ $w->id }}">{{ number_format($w->balance, 8) }}</span>
                                    <button class="btn btn-xs btn-white ms-1 refresh-btn" data-id="{{ $w->id }}" title="Refresh">
                                        <i class="bi-arrow-clockwise"></i>
                                    </button>
                                </td>
                                <td>{{ $w->trader_id ? 'Trader #'.$w->trader_id : '—' }}</td>
                            </tr>
                        @endforeach
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    {{-- Transfer History --}}
    <div class="card mb-4">
        <div class="card-header">
            <h4 class="card-header-title">Transfer History</h4>
        </div>
        <div class="table-responsive">
            <table class="table table-borderless table-nowrap table-align-middle card-table mb-0">
                <thead class="thead-light">
                <tr>
                    <th>Date</th>
                    <th>Currency</th>
                    <th>Amount</th>
                    <th>Destination</th>
                    <th>TxID</th>
                    <th>Status</th>
                </tr>
                </thead>
                <tbody>
                @forelse($history as $h)
                    <tr>
                        <td>{{ \Carbon\Carbon::parse($h['created_at'])->format('d.m.Y H:i') }}</td>
                        <td><strong>{{ $h['currency_code'] }}</strong></td>
                        <td>{{ number_format($h['amount'], 8) }}</td>
                        <td><code style="font-size:.75rem">{{ Str::limit($h['destination_wallet'], 20) }}</code></td>
                        <td>
                            @if($h['tx_id'])
                                <code style="font-size:.75rem">{{ Str::limit($h['tx_id'], 18) }}</code>
                            @else
                                <span class="text-muted">—</span>
                            @endif
                        </td>
                        <td>
                            <span class="badge bg-soft-{{ $h['status'] === 'sent' ? 'success text-success' : 'danger text-danger' }}">
                                {{ $h['status'] }}
                            </span>
                        </td>
                    </tr>
                @empty
                    <tr>
                        <td colspan="6" class="text-center py-4 text-muted">No transfers yet.</td>
                    </tr>
                @endforelse
                </tbody>
            </table>
        </div>
    </div>
</div>
@endsection

@push('script')
<script>
'use strict';

const fromSelect = document.getElementById('fromWallet');
const toSelect   = document.getElementById('toWallet');
const fromInfo   = document.getElementById('fromInfo');
const currLabel  = document.getElementById('currencyLabel');
const warning    = document.getElementById('currencyWarning');
const submitBtn  = document.getElementById('submitBtn');

function validate() {
    const fromOpt = fromSelect.options[fromSelect.selectedIndex];
    const toOpt   = toSelect.options[toSelect.selectedIndex];
    const fromCur = fromOpt?.dataset.currency || '';
    const toCur   = toOpt?.dataset.currency || '';

    if (fromCur && toCur && fromCur !== toCur) {
        warning.classList.remove('d-none');
        submitBtn.disabled = true;
    } else {
        warning.classList.add('d-none');
        submitBtn.disabled = false;
    }

    if (fromCur) {
        currLabel.textContent = fromCur;
        const bal = fromOpt?.dataset.balance || '0';
        fromInfo.innerHTML = `Address: <code>${fromOpt.dataset.address}</code><br>Cached balance: <strong>${parseFloat(bal).toFixed(8)} ${fromCur}</strong>`;
    } else {
        currLabel.textContent = '—';
        fromInfo.innerHTML = '';
    }
}

fromSelect.addEventListener('change', validate);
toSelect.addEventListener('change', validate);

// Refresh wallet balance
document.querySelectorAll('.refresh-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const id = this.dataset.id;
        const span = document.getElementById('bal-' + id);
        const icon = this.querySelector('i');
        icon.classList.add('spin');
        fetch(`/admin/internal-transfer/balance/${id}`, {
            headers: { 'Accept': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]')?.content }
        })
        .then(r => r.json())
        .then(d => {
            span.textContent = parseFloat(d.balance).toFixed(8);
        })
        .catch(() => {})
        .finally(() => icon.classList.remove('spin'));
    });
});

// Confirm before submit
document.getElementById('transferForm').addEventListener('submit', function(e) {
    const amount = document.getElementById('amount').value;
    const amountText = amount ? amount + ' ' + currLabel.textContent : 'ALL available';
    if (!confirm(`Execute internal transfer of ${amountText}?\n\nThis is an on-chain transaction and cannot be reversed.`)) {
        e.preventDefault();
    }
});
</script>
<style>
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin .5s linear infinite; display: inline-block; }
</style>
@endpush
