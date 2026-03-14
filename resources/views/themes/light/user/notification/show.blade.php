@extends($theme.'layouts.user')
@section('page_title',__('Notification'))
@section('content')
    <div class="section dashboard">
        <div class="row">
            @include($theme.'user.profile.profileNav')
            <div class="account-settings-profile-section">
                <div class="card">
                    <div class="card-header border-0">
                        <h5 class="card-title">@lang('Notification Templates')</h5>
                    </div>
                    <div class="card-body pt-0">
                        <p>@lang('We need permission from your browser to show notifications.')
                            <strong>@lang('Request Permission')</strong>
                        </p>
                        <!-- Cmn table start -->
                        <form action="{{route('user.notification')}}" method="post">
                            @csrf
                            <div class="cmn-table mt-20">
                                <div class="table-responsive">
                                    <table class="table align-middle">
                                        <thead>
                                        <tr>
                                            <th style="width: 15%;" scope="col">@lang('Type')</th>
                                            @if(basicControl()->email_notification)
                                                <th style="width: 5%;" scope="col">✉️ @lang('Email')</th>
                                            @endif
                                            @if(basicControl()->sms_notification)
                                                <th style="width: 5%;" scope="col">📨️ @lang('Sms')</th>
                                            @endif
                                            @if(basicControl()->push_notification)
                                                <th style="width: 5%;" scope="col">🖥 @lang('Push')</th>
                                            @endif
                                            @if(basicControl()->in_app_notification)
                                                <th style="width: 3%;" scope="col">👩🏻‍💻 @lang('In App')</th>
                                            @endif
                                        </tr>
                                        </thead>
                                        <tbody>
                                        @foreach($templates as $item)
                                            <tr>
                                                <td data-label="Type">
                                                    <div class="d-flex align-items-center">
                                                        <span>{{$item['name']}}</span>
                                                    </div>

                                                </td>
                                                @if(basicControl()->email_notification)
                                                    <td data-label="✉️ Email">
                                                        <div class="form-check form-switch">
                                                            <input class="form-check-input" type="checkbox"
                                                                   role="switch" name="email_key[]"
                                                                   value="{{$item['template_key']}}"
                                                                   id="flexSwitchCheckChecked" {{$item['status']['mail'] == 0 ? 'disabled' : ''}}
                                                                {{in_array($item['template_key'],auth()->user()->email_key??[]) ? 'checked':''}}>
                                                        </div>
                                                    </td>
                                                @endif
                                                @if(basicControl()->sms_notification)
                                                    <td data-label="✉️ Sms">
                                                        <div class="form-check form-switch">
                                                            <input class="form-check-input" type="checkbox"
                                                                   role="switch"
                                                                   name="sms_key[]"
                                                                   value="{{$item['template_key']}}"
                                                                   id="flexSwitchCheckChecked" {{$item['status']['sms']== 0 ? 'disabled' : ''}}
                                                                {{in_array($item['template_key'],auth()->user()->sms_key??[]) ? 'checked':''}}>
                                                        </div>
                                                    </td>
                                                @endif
                                                @if(basicControl()->push_notification)
                                                    <td data-label="🖥 Push">
                                                        <div class="form-check form-switch">
                                                            <input class="form-check-input" type="checkbox"
                                                                   role="switch"
                                                                   name="push_key[]"
                                                                   value="{{$item['template_key']}}"
                                                                   id="flexSwitchCheckChecked" {{$item['status']['push']== 0 ? 'disabled' : ''}}
                                                                {{in_array($item['template_key'],auth()->user()->push_key??[]) ? 'checked':''}}>
                                                        </div>
                                                    </td>
                                                @endif
                                                @if(basicControl()->in_app_notification)
                                                    <td data-label="👩🏻‍💻 In App">
                                                        <div class="form-check form-switch">
                                                            <input class="form-check-input" type="checkbox"
                                                                   role="switch"
                                                                   name="in_app_key[]"
                                                                   value="{{$item['template_key']}}"
                                                                   id="flexSwitchCheckChecked"
                                                                {{$item['status']['in_app']== 0 ? 'disabled' : ''}}
                                                                {{in_array($item['template_key'],auth()->user()->in_app_key??[]) ? 'checked':''}}>
                                                        </div>
                                                    </td>
                                                @endif
                                            </tr>
                                        @endforeach
                                        </tbody>
                                    </table>
                                </div>

                            </div>
                            <div class="btn-area mt-20">
                                <button type="submit" class="cmn-btn">@lang('Save Changes')</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection

