@extends($theme.'layouts.user')
@section('page_title', __('KYC Form'))

@php
    $isVerified = $kyc->kycPosition() === 'verified';
    $isSumsub = ($kyc->provider ?? 'manual') === 'sumsub';
    $fieldCount = count((array) ($kyc->input_form ?? []));
    $statusCode = $isVerified ? 1 : $latestUserKyc?->status;
    $statusMap = [
        null => ['label' => __('Not started'), 'class' => 'status-muted', 'text' => __('Verification has not been started yet.')],
        0 => ['label' => __('Pending'), 'class' => 'status-warning', 'text' => __('Your documents are under review. We will update the result here automatically.')],
        1 => ['label' => __('Verified'), 'class' => 'status-success', 'text' => __('Your identity has already been confirmed.')],
        2 => ['label' => __('Rejected'), 'class' => 'status-danger', 'text' => __('The verification needs attention before it can be approved.')],
    ];
    $currentStatus = $statusMap[$statusCode] ?? $statusMap[null];
@endphp

@section('content')
    <div class="section dashboard">
        <div class="row">
            @include($theme.'user.profile.profileNav')

            <div class="account-settings-profile-section">
                <div class="kyc-shell">
                    <div class="card kyc-hero-card">
                        <div class="card-body">
                            <div class="kyc-hero-grid">
                                <div class="kyc-hero-copy">
                                    <span class="kyc-status-pill {{ $currentStatus['class'] }}">{{ $currentStatus['label'] }}</span>
                                    <h4 class="kyc-hero-title">{{ $kyc->name }}</h4>
                                    <p class="kyc-hero-text">
                                        @if($isSumsub)
                                            @lang('This verification is processed automatically through Sumsub.')
                                        @else
                                            @lang('Verify your process instantly.')
                                        @endif
                                    </p>
                                    <p class="kyc-hero-subtext">{{ $currentStatus['text'] }}</p>
                                </div>

                                <div class="kyc-hero-meta">
                                    <div class="kyc-meta-card">
                                        <span class="kyc-meta-label">@lang('Provider')</span>
                                        <strong>{{ $isSumsub ? 'Sumsub' : __('Manual') }}</strong>
                                    </div>
                                    <div class="kyc-meta-card">
                                        <span class="kyc-meta-label">@lang('Current status')</span>
                                        <strong>{{ $currentStatus['label'] }}</strong>
                                    </div>
                                    <div class="kyc-meta-card">
                                        <span class="kyc-meta-label">@lang('Submitted At')</span>
                                        <strong>{{ $latestUserKyc ? dateTime($latestUserKyc->created_at, basicControl()->date_time_format) : __('Not started') }}</strong>
                                    </div>
                                    @if(!$isSumsub)
                                        <div class="kyc-meta-card">
                                            <span class="kyc-meta-label">@lang('Required fields')</span>
                                            <strong>{{ $fieldCount }}</strong>
                                        </div>
                                    @endif
                                </div>
                            </div>
                        </div>
                    </div>

                    @if($isVerified)
                        <div class="card kyc-success-card">
                            <div class="card-body">
                                <div class="kyc-success-layout">
                                    <div>
                                        <div class="kyc-success-icon">
                                            <i class="fa-light fa-shield-check"></i>
                                        </div>
                                        <h5 class="kyc-panel-title">@lang('Verification completed successfully')</h5>
                                        <p class="kyc-panel-text">@lang('Your identity is already confirmed. You can use dashboard, deposits and trading without extra restrictions.')</p>
                                    </div>
                                    <div class="kyc-action-row">
                                        <a href="{{ route('user.verification.center') }}" class="cmn-btn2">@lang('Open verification history')</a>
                                        <a href="{{ route('user.profile') }}" class="cmn-btn">@lang('Go to profile')</a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    @elseif($isSumsub)
                        <div class="row g-4">
                            <div class="col-lg-4">
                                <div class="card kyc-side-card">
                                    <div class="card-body">
                                        <h5 class="kyc-panel-title">@lang('Automatic verification')</h5>
                                        <p class="kyc-panel-text">@lang('Your information is checked by Sumsub and the result appears here automatically. Start the session in the widget and complete all requested steps.')</p>

                                        <div class="kyc-step-list">
                                            <div class="kyc-step-item">
                                                <span class="kyc-step-index">1</span>
                                                <div>
                                                    <strong>@lang('Prepare a valid document')</strong>
                                                    <p>@lang('Use a clear photo or scan without cropped corners or glare.')</p>
                                                </div>
                                            </div>
                                            <div class="kyc-step-item">
                                                <span class="kyc-step-index">2</span>
                                                <div>
                                                    <strong>@lang('Keep your personal data consistent')</strong>
                                                    <p>@lang('The name in your profile and in your document should match.')</p>
                                                </div>
                                            </div>
                                            <div class="kyc-step-item">
                                                <span class="kyc-step-index">3</span>
                                                <div>
                                                    <strong>@lang('Wait for the review result')</strong>
                                                    <p>@lang('When the check is finished, the status on this page will update automatically.')</p>
                                                </div>
                                            </div>
                                        </div>

                                        @if($latestUserKyc && $latestUserKyc->reason)
                                            <div class="kyc-note-box kyc-note-danger">
                                                <span class="kyc-note-title">@lang('Review note')</span>
                                                <p>{{ $latestUserKyc->reason }}</p>
                                            </div>
                                        @endif

                                        <div class="kyc-note-box">
                                            <span class="kyc-note-title">@lang('Need details later?')</span>
                                            <p>@lang('All completed and rejected checks are stored in the verification history.')</p>
                                            <a href="{{ route('user.verification.center') }}" class="cmn-btn2 btn-sm">@lang('Open history')</a>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="col-lg-8">
                                <div class="card kyc-main-card">
                                    <div class="card-body">
                                        <div class="kyc-main-header">
                                            <div>
                                                <h5 class="kyc-panel-title">@lang('Verification widget')</h5>
                                                <p class="kyc-panel-text">@lang('Start the check in the secure widget below. It will guide the user through the required steps.')</p>
                                            </div>
                                            <button type="button" class="cmn-btn" id="start-sumsub-kyc" data-url="{{ route('user.kyc.sumsub.token', $kyc->id) }}">
                                                @lang('Start verification')
                                            </button>
                                        </div>

                                        <div class="kyc-sdk-stage">
                                            <div id="sumsub-websdk-container"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    @else
                        <form action="{{ route('user.kyc.verification.submit', $kyc->id) }}" method="post" enctype="multipart/form-data">
                            @csrf

                            <div class="row g-4">
                                <div class="col-lg-4">
                                    <div class="card kyc-side-card">
                                        <div class="card-body">
                                            <h5 class="kyc-panel-title">@lang('Manual verification')</h5>
                                            <p class="kyc-panel-text">@lang('Fill in the form carefully. Approved KYC data will be copied to your profile automatically after review.')</p>

                                            <div class="kyc-note-box">
                                                <span class="kyc-note-title">@lang('Before submitting')</span>
                                                <p>@lang('Use the same personal data as in your official document and upload only clear readable files.')</p>
                                            </div>

                                            <div class="kyc-note-box">
                                                <span class="kyc-note-title">@lang('Supported files')</span>
                                                <p>@lang('Allowed JPG, jpeg or PNG. Max size of 2048K')</p>
                                            </div>

                                            <div class="kyc-note-box">
                                                <span class="kyc-note-title">@lang('Need details later?')</span>
                                                <p>@lang('After submission you can always return to the verification history and track the status there.')</p>
                                                <a href="{{ route('user.verification.center') }}" class="cmn-btn2 btn-sm">@lang('Open history')</a>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-lg-8">
                                    <div class="card kyc-main-card">
                                        <div class="card-body">
                                            <div class="kyc-main-header align-items-start">
                                                <div>
                                                    <h5 class="kyc-panel-title">@lang('KYC Information')</h5>
                                                    <p class="kyc-panel-text">@lang('Complete the form below and submit the required information for review.')</p>
                                                </div>
                                            </div>

                                            <div class="row g-4">
                                                @if($kyc->input_form)
                                                    @foreach($kyc->input_form as $k => $v)
                                                        @php
                                                            $fieldId = 'kyc_field_' . $loop->index;
                                                            $previewId = 'kyc_preview_' . $loop->index;
                                                        @endphp

                                                        @if(in_array($v->type, ['text', 'number', 'date'], true))
                                                            <div class="col-md-6">
                                                                <label for="{{ $fieldId }}" class="form-label">
                                                                    {{ trans($v->field_label) }} @if($v->validation == 'required') <span class="text-danger">*</span> @endif
                                                                </label>
                                                                <input
                                                                    id="{{ $fieldId }}"
                                                                    type="{{ $v->type === 'text' ? 'text' : $v->type }}"
                                                                    name="{{ $k }}"
                                                                    value="{{ old($k) }}"
                                                                    class="form-control"
                                                                    placeholder="{{ trans($v->field_label) }}"
                                                                    @if($v->validation == 'required') required @endif
                                                                >
                                                                @if ($errors->has($k))
                                                                    <span class="text-danger">{{ trans($errors->first($k)) }}</span>
                                                                @endif
                                                            </div>
                                                        @elseif($v->type == 'textarea')
                                                            <div class="col-12">
                                                                <label for="{{ $fieldId }}" class="form-label">
                                                                    {{ trans($v->field_label) }} @if($v->validation == 'required') <span class="text-danger">*</span> @endif
                                                                </label>
                                                                <textarea
                                                                    id="{{ $fieldId }}"
                                                                    name="{{ $k }}"
                                                                    class="form-control"
                                                                    rows="4"
                                                                    placeholder="{{ trans($v->field_label) }}"
                                                                    @if($v->validation == 'required') required @endif
                                                                >{{ old($k) }}</textarea>
                                                                @if ($errors->has($k))
                                                                    <span class="text-danger">{{ trans($errors->first($k)) }}</span>
                                                                @endif
                                                            </div>
                                                        @elseif($v->type == 'file')
                                                            <div class="col-12">
                                                                <div class="kyc-file-card">
                                                                    <div class="kyc-file-preview">
                                                                        <img src="{{ getFile('local', 'dummy') }}" alt="Preview" class="img-profile-view" id="{{ $previewId }}">
                                                                    </div>
                                                                    <div class="kyc-file-content">
                                                                        <label for="{{ $fieldId }}" class="form-label">
                                                                            {{ trans($v->field_label) }} @if($v->validation == 'required') <span class="text-danger">*</span> @endif
                                                                        </label>
                                                                        <p class="kyc-file-text">@lang('Upload a clear image of your document. The file preview will appear instantly after selection.')</p>
                                                                        <div class="d-flex flex-wrap gap-2 align-items-center">
                                                                            <label for="{{ $fieldId }}" class="cmn-btn mb-0">@lang('Select') {{ $v->field_label }}</label>
                                                                            <small>@lang('Allowed JPG, jpeg or PNG. Max size of 2048K')</small>
                                                                        </div>
                                                                        <input
                                                                            id="{{ $fieldId }}"
                                                                            class="form-control file-upload-input d-none"
                                                                            type="file"
                                                                            name="{{ $k }}"
                                                                            accept="image/*"
                                                                            data-preview-target="{{ $previewId }}"
                                                                            @if($v->validation == 'required') required @endif
                                                                        >
                                                                        @if ($errors->has($k))
                                                                            <span class="text-danger d-block mt-2">{{ __($errors->first($k)) }}</span>
                                                                        @endif
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        @endif
                                                    @endforeach
                                                @endif

                                                <div class="col-12">
                                                    <div class="kyc-submit-bar">
                                                        <p>@lang('Please double-check your information before submission.')</p>
                                                        <button type="submit" class="cmn-btn">@lang('submit')</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </form>
                    @endif
                </div>
            </div>
        </div>
    </div>
@endsection

@if($isSumsub)
    @push('js_libs')
        <script src="{{ basicControl()->sumsub_websdk_url ?: 'https://static.sumsub.com/idensic/static/sns-websdk-builder.js' }}"></script>
    @endpush
@endif

@push('extra_styles')
    <style>
        .kyc-shell {
            display: grid;
            gap: 24px;
        }

        .kyc-hero-card,
        .kyc-main-card,
        .kyc-side-card,
        .kyc-success-card {
            border: 1px solid rgba(171, 131, 255, 0.18);
            background:
                radial-gradient(circle at top right, rgba(164, 93, 255, 0.18), transparent 35%),
                linear-gradient(180deg, rgba(27, 15, 53, 0.94), rgba(18, 11, 38, 0.96));
            box-shadow: 0 28px 50px rgba(8, 5, 22, 0.32);
        }

        .kyc-hero-grid {
            display: grid;
            gap: 18px;
            grid-template-columns: minmax(0, 1.8fr) minmax(280px, 1fr);
            align-items: end;
        }

        .kyc-hero-title {
            margin: 14px 0 10px;
            font-size: clamp(1.8rem, 2vw, 2.5rem);
            line-height: 1.05;
        }

        .kyc-hero-text,
        .kyc-hero-subtext,
        .kyc-panel-text,
        .kyc-step-item p,
        .kyc-note-box p,
        .kyc-file-text,
        .kyc-submit-bar p {
            color: rgba(255, 255, 255, 0.72);
            margin-bottom: 0;
        }

        .kyc-hero-meta {
            display: grid;
            gap: 12px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .kyc-meta-card,
        .kyc-note-box {
            padding: 16px 18px;
            border-radius: 18px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(255, 255, 255, 0.04);
            backdrop-filter: blur(8px);
        }

        .kyc-meta-label,
        .kyc-note-title {
            display: block;
            margin-bottom: 8px;
            font-size: 0.78rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.52);
        }

        .kyc-panel-title {
            margin-bottom: 10px;
            font-size: 1.2rem;
        }

        .kyc-status-pill {
            display: inline-flex;
            align-items: center;
            padding: 8px 14px;
            border-radius: 999px;
            border: 1px solid transparent;
            font-size: 0.78rem;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .status-muted {
            color: #d8d4ea;
            background: rgba(216, 212, 234, 0.08);
            border-color: rgba(216, 212, 234, 0.18);
        }

        .status-warning {
            color: #ffd68e;
            background: rgba(255, 214, 142, 0.1);
            border-color: rgba(255, 214, 142, 0.25);
        }

        .status-success {
            color: #91f0bf;
            background: rgba(145, 240, 191, 0.1);
            border-color: rgba(145, 240, 191, 0.25);
        }

        .status-danger {
            color: #ff9aa7;
            background: rgba(255, 154, 167, 0.11);
            border-color: rgba(255, 154, 167, 0.25);
        }

        .kyc-success-layout {
            display: flex;
            gap: 20px;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
        }

        .kyc-success-icon {
            width: 62px;
            height: 62px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 20px;
            margin-bottom: 16px;
            color: #8cf0b8;
            font-size: 1.7rem;
            background: linear-gradient(135deg, rgba(90, 255, 160, 0.18), rgba(89, 186, 255, 0.1));
        }

        .kyc-action-row {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .kyc-step-list {
            display: grid;
            gap: 14px;
            margin: 20px 0;
        }

        .kyc-step-item {
            display: grid;
            gap: 14px;
            grid-template-columns: 38px minmax(0, 1fr);
            align-items: start;
        }

        .kyc-step-index {
            width: 38px;
            height: 38px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 14px;
            font-weight: 700;
            color: #fff;
            background: linear-gradient(135deg, rgba(171, 93, 255, 0.95), rgba(96, 218, 255, 0.9));
            box-shadow: 0 12px 24px rgba(131, 73, 255, 0.28);
        }

        .kyc-note-danger {
            border-color: rgba(255, 126, 153, 0.24);
            background: rgba(255, 126, 153, 0.08);
        }

        .kyc-main-header {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: center;
            margin-bottom: 24px;
        }

        .kyc-sdk-stage {
            min-height: 420px;
            border-radius: 24px;
            border: 1px dashed rgba(171, 131, 255, 0.22);
            background: rgba(255, 255, 255, 0.03);
            padding: 18px;
        }

        .kyc-sdk-stage:empty::before {
            content: "@lang('The secure verification widget will appear here after the session starts.')";
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            min-height: 360px;
            text-align: center;
            color: rgba(255, 255, 255, 0.48);
            border-radius: 18px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.04));
        }

        .kyc-file-card {
            display: grid;
            gap: 18px;
            grid-template-columns: 140px minmax(0, 1fr);
            padding: 18px;
            border-radius: 22px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(255, 255, 255, 0.03);
        }

        .kyc-file-preview {
            width: 140px;
            height: 140px;
            border-radius: 18px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .kyc-file-preview img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .kyc-submit-bar {
            display: flex;
            gap: 16px;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            padding-top: 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        @media (max-width: 991px) {
            .kyc-hero-grid,
            .kyc-file-card {
                grid-template-columns: 1fr;
            }

            .kyc-hero-meta {
                grid-template-columns: 1fr 1fr;
            }

            .kyc-file-preview {
                width: 100%;
                max-width: 160px;
            }
        }

        @media (max-width: 767px) {
            .kyc-hero-meta {
                grid-template-columns: 1fr;
            }

            .kyc-main-header,
            .kyc-success-layout,
            .kyc-submit-bar {
                flex-direction: column;
                align-items: stretch;
            }

            .kyc-action-row {
                width: 100%;
            }

            .kyc-action-row .cmn-btn,
            .kyc-action-row .cmn-btn2,
            .kyc-main-header .cmn-btn {
                width: 100%;
                text-align: center;
            }
        }
    </style>
@endpush

@push('extra_scripts')
    <script>
        'use strict'

        $(document).ready(function () {
            $(document).on('change', '.file-upload-input', function () {
                let previewTarget = $(this).data('preview-target');
                let previewElement = previewTarget ? document.getElementById(previewTarget) : null;

                if (!previewElement || !this.files || !this.files[0]) {
                    return;
                }

                let reader = new FileReader();
                reader.readAsDataURL(this.files[0]);
                reader.onload = function (e) {
                    previewElement.setAttribute('src', e.target.result);
                };
            });

            $(document).on('click', '#start-sumsub-kyc', function () {
                let button = $(this);
                let url = button.data('url');

                button.prop('disabled', true);

                axios.post(url)
                    .then(function (response) {
                        let data = response.data || {};
                        if (typeof window.snsWebSdk === 'undefined') {
                            throw new Error('Sumsub WebSDK is not loaded.');
                        }

                        let instance = window.snsWebSdk.init(
                            data.token,
                            function () {
                                return axios.post(url).then(function (refreshResponse) {
                                    return refreshResponse.data.token;
                                });
                            }
                        ).withConf({
                            lang: '{{ app()->getLocale() }}',
                            email: '{{ auth()->user()->email }}'
                        }).withOptions({
                            addViewportTag: false,
                            adaptIframeHeight: true
                        }).build();

                        $('#sumsub-websdk-container').html('');
                        instance.launch('#sumsub-websdk-container');
                    })
                    .catch(function (error) {
                        let message = error?.response?.data?.message || error.message || 'Sumsub could not be started.';
                        Notiflix.Notify.failure(message);
                    })
                    .finally(function () {
                        button.prop('disabled', false);
                    });
            });
        })
    </script>
@endpush
