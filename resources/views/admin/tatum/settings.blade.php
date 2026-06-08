@extends('admin.layouts.app')
@section('page_title', 'Tatum.io Settings')
@section('content')
<div class="content container-fluid">
    <div class="page-header">
        <div class="row align-items-end">
            <div class="col-sm mb-2 mb-sm-0">
                <nav aria-label="breadcrumb">
                    <ol class="breadcrumb breadcrumb-no-gutter">
                        <li class="breadcrumb-item"><a href="{{ route('admin.dashboard') }}">Dashboard</a></li>
                        <li class="breadcrumb-item active">Tatum.io</li>
                    </ol>
                </nav>
                <h1 class="page-header-title">Tatum.io — Crypto Gateway</h1>
            </div>
        </div>
    </div>

    @if(session('success'))
        <div class="alert alert-soft-success d-flex align-items-center mb-4">
            <i class="bi-check-circle-fill me-2"></i> {{ session('success') }}
        </div>
    @endif
    @if(session('error'))
        <div class="alert alert-soft-danger d-flex align-items-center mb-4">
            <i class="bi-x-circle-fill me-2"></i> {{ session('error') }}
        </div>
    @endif

    <div class="row">
        <div class="col-lg-8">
            {{-- API Settings --}}
            <div class="card mb-4">
                <div class="card-header">
                    <h4 class="card-header-title">
                        <img src="https://docs.tatum.io/favicon.ico" width="20" height="20" class="me-2" alt="">
                        API Configuration
                    </h4>
                </div>
                <div class="card-body">
                    <form action="{{ route('admin.tatum.settings.save') }}" method="POST">
                        @csrf
                        <div class="mb-4">
                            <label class="form-label fw-semibold">API Key <span class="text-danger">*</span></label>
                            <input type="text" name="api_key" class="form-control"
                                   value="{{ $settings['api_key'] }}"
                                   placeholder="t-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
                            <small class="text-muted">
                                Get your API key at <a href="https://dashboard.tatum.io" target="_blank">dashboard.tatum.io</a>
                            </small>
                        </div>

                        <div class="mb-4">
                            <label class="form-label fw-semibold">Webhook URL</label>
                            <div class="input-group">
                                <input type="text" class="form-control" readonly
                                       value="{{ url('api/tatum/webhook') }}"
                                       id="webhookUrlField">
                                <button type="button" class="btn btn-white"
                                        onclick="navigator.clipboard.writeText(document.getElementById('webhookUrlField').value)">
                                    <i class="bi-clipboard"></i>
                                </button>
                            </div>
                            <small class="text-muted">Paste this URL in the Tatum Dashboard under Notifications → Webhook URL</small>
                        </div>

                        <div class="mb-4">
                            <label class="form-label fw-semibold">Webhook HMAC Secret</label>
                            <input type="text" name="webhook_secret" class="form-control"
                                   value="{{ $settings['webhook_secret'] }}"
                                   placeholder="Optional — generate in Tatum Dashboard">
                            <small class="text-muted">Used to verify incoming webhook signatures. Set the same value in Tatum Dashboard.</small>
                        </div>

                        <div class="mb-4">
                            <div class="form-check form-switch">
                                <input type="hidden" name="testnet" value="0">
                                <input class="form-check-input" type="checkbox" name="testnet" value="1"
                                       id="testnetSwitch" {{ $settings['testnet'] ? 'checked' : '' }}>
                                <label class="form-check-label" for="testnetSwitch">
                                    Use Testnet
                                </label>
                            </div>
                            <small class="text-muted">Enable during development/testing. Disable in production.</small>
                        </div>

                        <div class="d-flex justify-content-between align-items-center">
                            <button type="submit" class="btn btn-primary">
                                <i class="bi-save me-1"></i> Save Settings
                            </button>
                            <a href="{{ route('admin.tatum.test') }}" class="btn btn-white">
                                <i class="bi-lightning-charge me-1"></i> Test Connection
                            </a>
                        </div>
                    </form>
                </div>
            </div>

            {{-- Active Subscriptions --}}
            <div class="card mb-4">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h4 class="card-header-title">Active Subscriptions</h4>
                    <span class="badge bg-soft-success text-success">{{ $subscriptions->where('status','active')->count() }} active</span>
                </div>
                <div class="table-responsive">
                    <table class="table table-borderless table-nowrap table-align-middle card-table">
                        <thead class="thead-light">
                        <tr>
                            <th>Tatum ID</th>
                            <th>Address</th>
                            <th>Chain</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th></th>
                        </tr>
                        </thead>
                        <tbody>
                        @forelse($subscriptions as $sub)
                            <tr>
                                <td><code class="text-muted" style="font-size:.75rem">{{ Str::limit($sub->tatum_id, 16) }}</code></td>
                                <td><code style="font-size:.75rem">{{ Str::limit($sub->address, 20) }}</code></td>
                                <td><span class="badge bg-soft-primary text-primary">{{ $sub->chain }}</span></td>
                                <td>
                                    @if($sub->type === 'INCOMING_NATIVE_TX')
                                        <span class="badge bg-soft-warning text-warning">Native</span>
                                    @else
                                        <span class="badge bg-soft-info text-info">Token</span>
                                    @endif
                                </td>
                                <td>
                                    @if($sub->status === 'active')
                                        <span class="badge bg-soft-success text-success">Active</span>
                                    @else
                                        <span class="badge bg-soft-danger text-danger">{{ $sub->status }}</span>
                                    @endif
                                </td>
                                <td>{{ $sub->created_at->format('d.m.Y H:i') }}</td>
                                <td>
                                    @if($sub->status === 'active')
                                    <form action="{{ route('admin.tatum.unsubscribe', $sub->id) }}" method="POST" class="d-inline">
                                        @csrf
                                        @method('DELETE')
                                        <button type="submit" class="btn btn-white btn-sm text-danger"
                                                onclick="return confirm('Unsubscribe?')">
                                            <i class="bi-trash"></i>
                                        </button>
                                    </form>
                                    @endif
                                </td>
                            </tr>
                        @empty
                            <tr>
                                <td colspan="7" class="text-center py-4 text-muted">No active subscriptions</td>
                            </tr>
                        @endforelse
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="col-lg-4">
            {{-- Status Card --}}
            <div class="card mb-4">
                <div class="card-header">
                    <h4 class="card-header-title">Status</h4>
                </div>
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <span>API Key</span>
                        @if(!empty($settings['api_key']))
                            <span class="badge bg-soft-success text-success"><i class="bi-check-circle me-1"></i>Configured</span>
                        @else
                            <span class="badge bg-soft-danger text-danger"><i class="bi-x-circle me-1"></i>Not set</span>
                        @endif
                    </div>
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <span>Webhook Secret</span>
                        @if(!empty($settings['webhook_secret']))
                            <span class="badge bg-soft-success text-success"><i class="bi-check-circle me-1"></i>Set</span>
                        @else
                            <span class="badge bg-soft-warning text-warning"><i class="bi-exclamation-circle me-1"></i>Not set</span>
                        @endif
                    </div>
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <span>Network</span>
                        <span class="badge {{ $settings['testnet'] ? 'bg-soft-warning text-warning' : 'bg-soft-success text-success' }}">
                            {{ $settings['testnet'] ? 'Testnet' : 'Mainnet' }}
                        </span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <span>Total Subscriptions</span>
                        <strong>{{ $subscriptions->count() }}</strong>
                    </div>
                </div>
            </div>

            {{-- Quick Links --}}
            <div class="card mb-4">
                <div class="card-header">
                    <h4 class="card-header-title">Quick Links</h4>
                </div>
                <div class="list-group list-group-flush">
                    <a href="https://dashboard.tatum.io" target="_blank" class="list-group-item list-group-item-action">
                        <i class="bi-box-arrow-up-right me-2 text-primary"></i> Tatum Dashboard
                    </a>
                    <a href="https://docs.tatum.io/docs/notifications" target="_blank" class="list-group-item list-group-item-action">
                        <i class="bi-book me-2 text-primary"></i> Notifications Docs
                    </a>
                    <a href="https://docs.tatum.io/reference" target="_blank" class="list-group-item list-group-item-action">
                        <i class="bi-code-slash me-2 text-primary"></i> API Reference
                    </a>
                </div>
            </div>
        </div>
    </div>
</div>
@endsection
