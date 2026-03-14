@extends($theme.'layouts.user')
@section('page_title',__('Payment Request'))
@section('content')
    <!-- main -->
    <div class="card mt-50">
        <div class="card-body">
            <div class="cmn-table">
                <div class="table-responsive overflow-visible">
                    <table class="table align-middle table-striped">
                        <thead>
                        <tr>
                            <th scope="col">@lang('Method')</th>
                            <th scope="col">@lang('Transaction ID')</th>
                            <th scope="col">@lang('Amount')</th>
                            <th scope="col">@lang('Charge')</th>
                            <th scope="col">@lang('Payable')</th>
                            <th scope="col">@lang('Status')</th>
                            <th scope="col">@lang('Created time')</th>
                            <th scope="col">@lang('Action')</th>
                        </tr>
                        </thead>
                        <tbody>
                        @if(count($funds) > 0)
                            @foreach($funds as $key => $value)
                                <tr>
                                    <td data-label="@lang('Method')">{{ __(optional($value->gateway)->name) ?? __('N/A') }}</td>
                                    <td data-label="@lang('Transaction ID')">{{ __($value->trx_id) }}</td>
                                    <td data-label="@lang('Amount')">{{number_format($value->amount,2)}} {{basicControl()->base_currency}}</td>
                                    <td data-label="@lang('Charge')">{{ getAmount($value->charge,2)}} {{$value->payment_method_currency}}</td>
                                    <td data-label="@lang('Payable')">{{ getAmount($value->payable_amount,2)}} {{$value->payment_method_currency}}</td>
                                    <td data-label="@lang('Status')">
                                        @if($value->status == 0)
                                            <span class="badge text-bg-warning">@lang('Pending')</span>
                                        @elseif($value->status == 1)
                                            <span class="badge text-bg-success">@lang('Success')</span>
                                        @elseif($value->status == 2)
                                            <span class="badge text-bg-warning">@lang('Pending')</span>
                                        @elseif($value->status == 3)
                                            <span class="badge text-bg-danger">@lang('Rejected')</span>
                                        @endif
                                    </td>
                                    <td data-label="@lang('Created time')"> {{ dateTime($value->created_at)}} </td>
                                    <td data-label="Action">
                                        @php
                                            $details = null;
                                            if ($value->information) {
                                                $details = [];
                                                foreach ($value->information as $k => $v) {
                                                    if ($v->type == "file") {
                                                        $details[kebab2Title($k)] = [
                                                            'type' => $v->type,
                                                            'field_name' => $v->field_name,
                                                            'field_value' => getFile(config('filesystems.default'), $v->field_value),
                                                        ];
                                                    } else {
                                                        $details[kebab2Title($k)] = [
                                                            'type' => $v->type,
                                                            'field_name' => $v->field_name,
                                                            'field_value' => @$v->field_value ?? $v->field_name
                                                        ];
                                                    }
                                                }
                                            }
                                        @endphp
                                        <button type="button" class="action-btn-primary edit_btn"
                                                data-detailsinfo="{{json_encode($details)}}"
                                                data-bs-toggle="modal" data-bs-target="#details"><i
                                                class="fa-regular fas fa-eye"></i></button>
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
    {{ $funds->appends($_GET)->links($theme.'partials.user.pagination') }}

    <!-- Modal section start -->
    <div class="modal fade" id="details" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
         aria-labelledby="staticBackdropLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h1 class="modal-title" id="staticBackdropLabel">@lang("Payment Information")</h1>
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fa-light fa-xmark"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <ul class="list-group mb-4 payment_information">
                    </ul>
                </div>
                <div class="modal-footer">
                    <button type="button" class="cmn-btn" data-bs-dismiss="modal">@lang('Close')</button>
                </div>
            </div>
        </div>
    </div>
    <!-- Modal section end -->
@endsection
@push('extra_scripts')
    <script>
        'use strict';
        $(document).on("click", '.edit_btn', function (e) {
            let details = Object.entries($(this).data('detailsinfo'));
            let list = details.map(([key, value]) => {

                let field_name = value.field_name;
                let field_value = value.field_value;
                let field_name_text = field_name.replace(/_/g, ' ');


                if (value.type === 'file') {
                    return `<li class="list-group-item">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <span class="text-capitalize">${field_name_text}</span>
                                        <a href="${field_value}" target="_blank"><img src="${field_value}" alt="Image Description" class="rounded-1" width="100"></a>
                                    </div>
                                </li>`;
                } else {
                    return `<li class="list-group-item">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <span class="text-capitalize">${field_name_text}</span>
                                        <span>${field_value}</span>
                                    </div>
                                </li>`;
                }
            })

            $('.payment_information').html(list);

        });
    </script>
@endpush
