@extends($theme . 'layouts.user')
@section('page_title', __('Exchange'))

@push('extra_styles')
    <link rel="stylesheet" href="{{ asset($themeTrue.'css/hero-section.css') }}?v={{ (string) (config('app.asset_version') ?? env('APP_VERSION', '1')) }}">
    <link rel="stylesheet" href="{{ asset($themeTrue.'css/exchange-widget.css') }}?v={{ (string) (config('app.asset_version') ?? env('APP_VERSION', '1')) }}">
@endpush

@section('content')

    <!-- New exchange widget (same flow as the homepage) -->
    <div class="dash-exchange-heading">
        <h4>@lang('New exchange')</h4>
        <p>@lang('Exchange, buy or sell crypto — the rate updates automatically.')</p>
    </div>
    <div class="dash-exchange-widget">
        @include($theme.'partials.exchange-module.swap-widget')
    </div>

    <!-- History -->
    <div class="dash-exchange-heading">
        <h4>@lang('Exchange history')</h4>
    </div>
    <!-- main -->
    <div class="card">
        <div class="card-body">
            <form action="{{ route('user.exchangeList') }}" method="get">
                <div class="row g-3 align-items-end">
                    <div class="col-md-2">
                        <input placeholder="@lang('Trx ID')" name="utr" value="{{ @request()->utr }}" type="text"
                            class="form-control form-control-sm">
                    </div>
                    <div class="col-md-2">
                        <select class="cmn-select2-image" name="send_currency">
                            <option value="">@lang('All Send Currency')</option>
                            @if ($currencies)
                                @foreach ($currencies as $sendCurrency)
                                    <option value="{{ $sendCurrency->id }}" data-img="{{ $sendCurrency->image_path }}"
                                        {{ @request()->send_currency == $sendCurrency->id ? 'selected' : '' }}>
                                        {{ $sendCurrency->currency_name }}</option>
                                @endforeach
                            @endif
                        </select>
                    </div>
                    <div class="col-md-2">
                        <select class="cmn-select2-image" name="get_currency">
                            <option value="">@lang('All Get Currency')</option>
                            @if ($currencies)
                                @foreach ($currencies as $getCurrency)
                                    <option value="{{ $getCurrency->id }}" data-img="{{ $getCurrency->image_path }}"
                                        {{ @request()->get_currency == $getCurrency->id ? 'selected' : '' }}>
                                        {{ $getCurrency->currency_name }}</option>
                                @endforeach
                            @endif
                        </select>
                    </div>
                    <div class="col-md-2">
                        <select class="cmn-select2" name="status">
                            <option value="">@lang('All Status')</option>
                            <option value="2" {{ @request()->status == '2' ? 'selected' : '' }}>@lang('Awaiting Complete')
                            </option>
                            <option value="3" {{ @request()->status == '3' ? 'selected' : '' }}>@lang('Trade Completed')
                            </option>
                            <option value="5" {{ @request()->status == '5' ? 'selected' : '' }}>@lang('Trade Cancel')
                            </option>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <input name="datetrx" value="{{ @request()->datetrx }}" type="date"
                            class="form-control form-control-sm">
                    </div>
                    <div class="col-md-2">
                        <button type="submit" class="cmn-btn w-100"><i class="fal fa-search"></i> @lang('Filter')
                        </button>
                    </div>
                </div>
            </form>
        </div>
    </div>
    <div class="card mt-50">
        <div class="card-body">
            <div class="cmn-table">
                <div class="table-responsive">
                    <table class="table align-middle table-striped">
                        <thead>
                            <tr>
                                <th scope="col">@lang('Trx ID')</th>
                                <th scope="col">@lang('Send Amount')</th>
                                <th scope="col">@lang('Get Amount')</th>
                                <th scope="col">@lang('Rate')</th>
                                <th scope="col">@lang('Status')</th>
                                <th scope="col">@lang('Requested At')</th>
                                <th scope="col">@lang('Action')</th>
                            </tr>
                        </thead>
                        <tbody>
                            @if (count($exchanges) > 0)
                                @foreach ($exchanges as $key => $value)
                                    <tr>
                                        <td data-label="@lang('Trx ID')">{{ $value->utr }}</td>
                                        <td data-label="@lang('Send Amount')"><a class="d-flex align-items-center me-2"
                                                href="javascript:void(0)">
                                                <div class="flex-shrink-0">
                                                    <div class="avatar avatar-sm avatar-circle">
                                                        <img class="avatar-img"
                                                            src="{{ getFile(optional($value->sendCurrency)->driver, optional($value->sendCurrency)->image) }}"
                                                            alt="Image Description">
                                                    </div>
                                                </div>
                                                <div class="flex-grow-1 ms-3">
                                                    <h5 class="text-hover-primary mb-0">
                                                        {{ rtrim(rtrim($value->send_amount, 0), '.') }}
                                                        {{ optional($value->sendCurrency)->code }}</h5>
                                                    <span
                                                        class="baseColor">{{ optional($value->sendCurrency)->currency_name }}</span>
                                                </div>
                                            </a>
                                        </td>
                                        <td data-label="@lang('Get Amount')">
                                            <a class="d-flex align-items-center me-2" href="javascript:void(0)">
                                                <div class="flex-shrink-0">
                                                    <div class="avatar avatar-sm avatar-circle">
                                                        <img class="avatar-img"
                                                            src="{{ getFile(optional($value->getCurrency)->driver, optional($value->getCurrency)->image) }}"
                                                            alt="Image Description">
                                                    </div>
                                                </div>
                                                <div class="flex-grow-1 ms-3">
                                                    <h5 class="text-hover-primary mb-0">
                                                        {{ rtrim(rtrim($value->final_amount, 0), '.') }}
                                                        {{ optional($value->getCurrency)->code }}</h5>
                                                    <span
                                                        class="baseColor">{{ optional($value->getCurrency)->currency_name }}</span>
                                                </div>
                                            </a>
                                        </td>
                                        <td data-label="@lang('Rate')">
                                            1 {{ optional($value->sendCurrency)->code }}
                                            {{ $value->rate_type == 'floating' ? '~' : '=' }}
                                            {{ rtrim(rtrim($value->exchange_rate, 0), '.') }}
                                            {{ optional($value->getCurrency)->code }}
                                        </td>
                                        <td data-label="@lang('Status')">{!! $value->user_status !!}</td>
                                        <td data-label="@lang('Requested At')">
                                            {{ dateTime($value->created_at, basicControl()->date_time_format) }}</td>
                                        <td data-label="@lang('Action')">
                                            <a href="{{ route('user.exchangeDetails', $value->utr) }}"
                                                class="action-btn-primary"><i class="fa-regular fa-pen-to-square"></i></a>
                                        </td>
                                    </tr>
                                @endforeach
                            @else
                                @include('empty')
                            @endif
                        </tbody>
                    </table>
                </div>

            </div>
        </div>
    </div>
    {{ $exchanges->appends($_GET)->links($theme . 'partials.user.pagination') }}
@endsection

@push('extra_scripts')
    <script>
        // Currency search inside the selection modals (provided by main.js on the
        // front-end; redefined here because the dashboard layout does not load it).
        function filterItems(inputId) {
            var input = document.getElementById(inputId);
            if (!input) return;
            var filter = input.value.toUpperCase();
            document.querySelectorAll('#currency-list .item').forEach(function (item) {
                var title = item.querySelector('.title');
                var subtitle = item.querySelector('.sub-title');
                var txtValue = (title ? (title.textContent || title.innerText) : '') + ' '
                    + (subtitle ? (subtitle.textContent || subtitle.innerText) : '');
                item.style.display = txtValue.toUpperCase().indexOf(filter) > -1 ? '' : 'none';
            });
        }

        function filterItems2(inputId) {
            var input = document.getElementById(inputId);
            if (!input) return;
            var filter = input.value.toUpperCase();
            document.querySelectorAll('#currency-list2 .item').forEach(function (item) {
                var title = item.querySelector('.title');
                var subtitle = item.querySelector('.sub-title');
                var txtValue = (title ? (title.textContent || title.innerText) : '') + ' '
                    + (subtitle ? (subtitle.textContent || subtitle.innerText) : '');
                item.style.display = txtValue.toUpperCase().indexOf(filter) > -1 ? '' : 'none';
            });
        }
    </script>
    @include($theme.'partials.exchange-module.exchange-js')
@endpush
