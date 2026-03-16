@extends($theme.'layouts.user')
@section('page_title', __('Verification Center'))

@php
    $totalCount = $userKycs->count();
    $pendingCount = $userKycs->where('status', 0)->count();
    $approvedCount = $userKycs->where('status', 1)->count();
    $rejectedCount = $userKycs->where('status', 2)->count();
    $firstKyc = $kycs->first();
@endphp

@section('content')
    <div class="section dashboard">
        <div class="row">
            @include($theme.'user.profile.profileNav')

            <div class="account-settings-profile-section">
                <div class="kyc-center-shell">
                    <div class="card kyc-center-hero">
                        <div class="card-body">
                            <div class="kyc-center-hero__grid">
                                <div>
                                    <span class="kyc-center-chip">@lang('Verification Center')</span>
                                    <h4 class="kyc-center-title">@lang('Verification overview')</h4>
                                    <p class="kyc-center-text">@lang('Track every submitted KYC request, check its status and open the details whenever you need them.')</p>
                                </div>
                                <div class="kyc-center-actions">
                                    @if($firstKyc)
                                        <a href="{{ route('user.kyc', [$firstKyc->slug, $firstKyc->id]) }}" class="cmn-btn">@lang('Open form')</a>
                                    @endif
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row g-4">
                        <div class="col-md-6 col-xl-3">
                            <div class="card kyc-stat-card">
                                <div class="card-body">
                                    <span class="kyc-stat-label">@lang('Total requests')</span>
                                    <strong class="kyc-stat-value">{{ $totalCount }}</strong>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6 col-xl-3">
                            <div class="card kyc-stat-card kyc-stat-card--warning">
                                <div class="card-body">
                                    <span class="kyc-stat-label">@lang('Pending')</span>
                                    <strong class="kyc-stat-value">{{ $pendingCount }}</strong>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6 col-xl-3">
                            <div class="card kyc-stat-card kyc-stat-card--success">
                                <div class="card-body">
                                    <span class="kyc-stat-label">@lang('Approved')</span>
                                    <strong class="kyc-stat-value">{{ $approvedCount }}</strong>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6 col-xl-3">
                            <div class="card kyc-stat-card kyc-stat-card--danger">
                                <div class="card-body">
                                    <span class="kyc-stat-label">@lang('Rejected')</span>
                                    <strong class="kyc-stat-value">{{ $rejectedCount }}</strong>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="card kyc-history-card">
                        <div class="card-header border-0 d-flex flex-wrap gap-3 justify-content-between align-items-center">
                            <div>
                                <h5 class="card-title mb-1">@lang('Verification History')</h5>
                                <p class="kyc-center-text mb-0">@lang('Each row keeps the provider, status and submission time of a verification request.')</p>
                            </div>
                        </div>

                        <div class="card-body pt-0">
                            @if($totalCount > 0)
                                <div class="cmn-table">
                                    <div class="table-responsive overflow-visible">
                                        <table class="table align-middle kyc-history-table">
                                            <thead>
                                            <tr>
                                                <th scope="col">@lang('SL')</th>
                                                <th scope="col">@lang('Type')</th>
                                                <th scope="col">@lang('Status')</th>
                                                <th scope="col">@lang('Submitted At')</th>
                                                <th scope="col">@lang('Action')</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            @foreach($userKycs as $key => $item)
                                                <tr>
                                                    <td data-label="@lang('SL')">
                                                        <span class="kyc-history-index">{{ $key + 1 }}</span>
                                                    </td>
                                                    <td data-label="@lang('Type')">
                                                        <div class="kyc-history-main">
                                                            <strong>{{ $item->kyc_type }}</strong>
                                                            <span>{{ ucfirst($item->provider ?? 'manual') }}</span>
                                                        </div>
                                                    </td>
                                                    <td data-label="@lang('Status')">
                                                        {!! $item->getStatus() !!}
                                                    </td>
                                                    <td data-label="@lang('Submitted At')">
                                                        <span>{{ dateTime($item->created_at, basicControl()->date_time_format) }}</span>
                                                    </td>
                                                    <td data-label="@lang('Action')">
                                                        <div class="d-flex flex-wrap gap-2">
                                                            <a class="cmn-btn2 btn-sm showDetails"
                                                               data-bs-target="#modalShow"
                                                               data-bs-toggle="modal"
                                                               data-res="{{ json_encode($item->kycInfoShow()) }}"
                                                               data-type="{{ $item->kyc_type }}"
                                                               href="javascript:void(0)">@lang('View')</a>
                                                            @if($item->status == 2)
                                                                <a class="cmn-btn3 btn-sm showReason"
                                                                   data-bs-target="#modalReject"
                                                                   data-bs-toggle="modal"
                                                                   data-reason="{{ $item->reason }}"
                                                                   href="javascript:void(0)">@lang('Reason')</a>
                                                            @endif
                                                        </div>
                                                    </td>
                                                </tr>
                                            @endforeach
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            @else
                                <div class="kyc-empty-state">
                                    <div class="kyc-empty-state__icon">
                                        <i class="fa-light fa-id-card"></i>
                                    </div>
                                    <h5>@lang('No verification requests yet')</h5>
                                    <p>@lang('When you submit KYC, the history of checks will appear here automatically.')</p>
                                    @if($firstKyc)
                                        <a href="{{ route('user.kyc', [$firstKyc->slug, $firstKyc->id]) }}" class="cmn-btn">@lang('Open form')</a>
                                    @endif
                                </div>
                            @endif
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="modalShow" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
         aria-labelledby="kycDetailsModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h1 class="modal-title modalTitle" id="kycDetailsModalLabel">@lang('Verification details')</h1>
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fa-light fa-xmark"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <ul class="list-group list-group-flush list-group-no-gutters listShow"></ul>
                </div>
                <div class="modal-footer">
                    <button type="button" class="cmn-btn" data-bs-dismiss="modal">@lang('Close')</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="modalReject" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
         aria-labelledby="kycRejectModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h1 class="modal-title" id="kycRejectModalLabel">@lang('Rejected Reason')</h1>
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fa-light fa-xmark"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p class="rejectedReason mb-0"></p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="cmn-btn" data-bs-dismiss="modal">@lang('Close')</button>
                </div>
            </div>
        </div>
    </div>
@endsection

@push('extra_styles')
    <style>
        .kyc-center-shell {
            display: grid;
            gap: 24px;
        }

        .kyc-center-hero,
        .kyc-stat-card,
        .kyc-history-card {
            border: 1px solid rgba(171, 131, 255, 0.18);
            background:
                radial-gradient(circle at top right, rgba(164, 93, 255, 0.14), transparent 35%),
                linear-gradient(180deg, rgba(27, 15, 53, 0.94), rgba(18, 11, 38, 0.96));
            box-shadow: 0 28px 50px rgba(8, 5, 22, 0.28);
        }

        .kyc-center-hero__grid {
            display: flex;
            gap: 16px;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
        }

        .kyc-center-chip {
            display: inline-flex;
            align-items: center;
            padding: 8px 14px;
            border-radius: 999px;
            background: rgba(171, 131, 255, 0.14);
            color: #dacaff;
            font-size: 0.8rem;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .kyc-center-title {
            margin: 14px 0 10px;
            font-size: clamp(1.8rem, 2vw, 2.35rem);
            line-height: 1.05;
        }

        .kyc-center-text,
        .kyc-empty-state p,
        .kyc-history-main span {
            color: rgba(255, 255, 255, 0.68);
        }

        .kyc-stat-card .card-body {
            padding: 20px;
        }

        .kyc-stat-label {
            display: block;
            margin-bottom: 8px;
            font-size: 0.82rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.52);
        }

        .kyc-stat-value {
            display: block;
            font-size: 2rem;
            line-height: 1;
        }

        .kyc-stat-card--warning {
            border-color: rgba(255, 214, 142, 0.22);
        }

        .kyc-stat-card--success {
            border-color: rgba(145, 240, 191, 0.22);
        }

        .kyc-stat-card--danger {
            border-color: rgba(255, 154, 167, 0.22);
        }

        .kyc-history-table tbody tr {
            border-color: rgba(255, 255, 255, 0.06);
        }

        .kyc-history-index {
            width: 34px;
            height: 34px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.06);
        }

        .kyc-history-main {
            display: grid;
            gap: 4px;
        }

        .kyc-empty-state {
            padding: 42px 24px;
            text-align: center;
            border-radius: 24px;
            border: 1px dashed rgba(171, 131, 255, 0.22);
            background: rgba(255, 255, 255, 0.03);
        }

        .kyc-empty-state__icon {
            width: 70px;
            height: 70px;
            margin: 0 auto 18px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 22px;
            font-size: 1.8rem;
            color: #dccbff;
            background: linear-gradient(135deg, rgba(171, 93, 255, 0.16), rgba(96, 218, 255, 0.08));
        }

        @media (max-width: 767px) {
            .kyc-center-hero__grid,
            .kyc-center-actions {
                width: 100%;
            }

            .kyc-center-actions .cmn-btn {
                width: 100%;
                text-align: center;
            }
        }
    </style>
@endpush

@push('extra_scripts')
    <script>
        'use strict'

        $(document).on("click", ".showReason", function () {
            $('.rejectedReason').text($(this).data('reason'));
        });

        $(document).on("click", ".showDetails", function () {
            $('.listShow').html('');
            let show = "";
            let res = $(this).data('res');
            $('.modalTitle').text($(this).data('type'));

            for (let key in res) {
                if (res[key].type === 'file') {
                    show += `<li class="list-group-item">
                                 <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
                                    <h5 class="mb-0">${res[key].name}</h5>
                                    <ul class="list-unstyled list-py-2 text-body text-end mb-0">
                                        <li>
                                            <a href="${res[key].value}" target="_blank">
                                                <img src="${res[key].value}" class="w-50 rounded-3" alt="${res[key].name}">
                                            </a>
                                        </li>
                                    </ul>
                                 </div>
                             </li>`;
                } else {
                    show += `<li class="list-group-item">
                                <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
                                    <h5 class="mb-0">${res[key].name}</h5>
                                    <ul class="list-unstyled list-py-2 text-body mb-0">
                                        <li>${res[key].value}</li>
                                    </ul>
                                </div>
                            </li>`;
                }
            }

            $('.listShow').html(show);
        });
    </script>
@endpush
