@extends($theme.'layouts.user')
@section('page_title',__('KYC Form'))
@section('content')
    <div class="section dashboard">
        <div class="row">
            @include($theme.'user.profile.profileNav')
            <div class="account-settings-profile-section">
                <div class="card">
                    @if($kyc->kycPosition() == 'verified')
                        <div class="card-header border-0 text-start text-md-center">
                            <h5 class="card-title">@lang('KYC Information')</h5>
                            <p class="text-success">@lang('Your kyc is verified')</p>
                        </div>
                    @elseif(($kyc->provider ?? 'manual') === 'sumsub')
                        <div class="card-header border-0 text-start text-md-center">
                            <h5 class="card-title">@lang('KYC Information')</h5>
                            <p>@lang('This verification is processed automatically through Sumsub.')</p>
                        </div>
                        <div class="card-body pt-0">
                            <div class="row">
                                <div class="col-md-8 mx-auto">
                                    <div class="alert alert-info">
                                        <strong>@lang('Current status'):</strong>
                                        {{ $latestUserKyc ? $latestUserKyc->getStatus(true) : __('Not started') }}
                                    </div>
                                    @if($latestUserKyc && $latestUserKyc->reason)
                                        <div class="alert alert-danger">{{ $latestUserKyc->reason }}</div>
                                    @endif
                                    <div id="sumsub-websdk-container" class="mb-4"></div>
                                    <div class="btn-area text-center">
                                        <button type="button" class="cmn-btn" id="start-sumsub-kyc" data-url="{{ route('user.kyc.sumsub.token', $kyc->id) }}">
                                            @lang('Start verification')
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    @else
                        <form action="{{route('user.kyc.verification.submit',$kyc->id)}}" method="post" enctype="multipart/form-data">
                            @csrf
                            <div class="card-header border-0 text-start text-md-center">
                                <h5 class="card-title">@lang('KYC Information')</h5>
                                <p>@lang('Verify your process instantly.')</p>
                            </div>
                            <div class="card-body pt-0">
                                <div class="row">
                                    <div class="col-md-8 mx-auto">
                                        <div class="row g-4">
                                            @if($kyc->input_form)
                                                @foreach($kyc->input_form as $k => $v)
                                                    @if($v->type == "text")
                                                        <div class="col-12">
                                                            <label class="form-label">{{trans($v->field_label)}} @if($v->validation == 'required') * @endif</label>
                                                            <input type="text" name="{{$k}}" class="form-control" @if($v->validation == "required") required @endif>
                                                            @if ($errors->has($k))
                                                                <span class="text-danger">{{ trans($errors->first($k)) }}</span>
                                                            @endif
                                                        </div>
                                                    @elseif($v->type == "number")
                                                        <div class="col-12">
                                                            <label class="form-label">{{trans($v->field_label)}} @if($v->validation == 'required') * @endif</label>
                                                            <input type="number" name="{{$k}}" class="form-control" @if($v->validation == "required") required @endif>
                                                            @if ($errors->has($k))
                                                                <span class="text-danger">{{ trans($errors->first($k)) }}</span>
                                                            @endif
                                                        </div>
                                                    @elseif($v->type == "date")
                                                        <div class="col-12">
                                                            <label class="form-label">{{trans($v->field_label)}} @if($v->validation == 'required') * @endif</label>
                                                            <input type="date" name="{{$k}}" class="form-control" @if($v->validation == "required") required @endif>
                                                            @if ($errors->has($k))
                                                                <span class="text-danger">{{ trans($errors->first($k)) }}</span>
                                                            @endif
                                                        </div>
                                                    @elseif($v->type == "textarea")
                                                        <div class="col-12">
                                                            <label class="form-label"><strong>{{trans($v->field_label)}} @if($v->validation == 'required') * @endif</strong></label>
                                                            <textarea name="{{$k}}" class="form-control" rows="3" @if($v->validation == "required") required @endif></textarea>
                                                            @if ($errors->has($k))
                                                                <span class="text-danger">{{ trans($errors->first($k)) }}</span>
                                                            @endif
                                                        </div>
                                                    @elseif($v->type == "file")
                                                        <div class="col-12">
                                                            <div class="profile-details-section mt-0">
                                                                <label class="form-label">{{trans($v->field_label)}} @if($v->validation == 'required') * @endif</label>
                                                                <div class="d-flex gap-3 align-items-center">
                                                                    <div class="image-area">
                                                                        <img src="{{getFile('local','dummy')}}" alt="..." class="img-profile-view h-100">
                                                                    </div>
                                                                    <div class="btn-area">
                                                                        <div class="btn-area-inner d-flex">
                                                                            <div class="cmn-file-input">
                                                                                <label for="formFile" class="form-label cmn-btn">@lang('Select') {{$v->field_label}}</label>
                                                                                <input class="form-control file-upload-input" type="file" name="{{$k}}" accept="image/*" @if($v->validation == "required") required @endif id="formFile">
                                                                            </div>
                                                                        </div>
                                                                        <small>@lang('Allowed JPG, jpeg or PNG. Max size of 2048K')</small>
                                                                    </div>
                                                                    @if ($errors->has($k))
                                                                        <br>
                                                                        <span class="text-danger">{{ __($errors->first($k)) }}</span>
                                                                    @endif
                                                                </div>
                                                            </div>
                                                        </div>
                                                    @endif
                                                @endforeach
                                            @endif
                                            <div class="btn-area">
                                                <button type="submit" class="cmn-btn">@lang('submit')</button>
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

@if(($kyc->provider ?? 'manual') === 'sumsub')
    @push('js_libs')
        <script src="{{ basicControl()->sumsub_websdk_url ?: 'https://static.sumsub.com/idensic/static/sns-websdk-builder.js' }}"></script>
    @endpush
@endif

@push('extra_scripts')
    <script>
        'use strict'
        $(document).ready(function () {
            $(document).on('change', '.file-upload-input', function () {
                let reader = new FileReader();
                reader.readAsDataURL(this.files[0]);
                reader.onload = function (e) {
                    $('.img-profile-view').attr('src', e.target.result);
                }
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
