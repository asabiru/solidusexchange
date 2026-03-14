@extends($theme.'layouts.user')
@section('page_title',__('Verification Center'))
@section('content')

    <div class="card mt-50">
        <div class="card-header d-flex justify-content-between border-0">
            <h4>@lang('Verification History')</h4>
        </div>
        <div class="card-body">
            <div class="cmn-table">
                <div class="table-responsive overflow-visible">
                    <table class="table align-middle">
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
                        @if(count($userKycs) > 0)
                            @foreach($userKycs as $key => $item)
                                <tr>
                                    <td data-label="@lang('SL')"><span>{{++$key}}</span></td>
                                    <td data-label="@lang('Type')">
                                        <span>{{$item->kyc_type}}</span>
                                    </td>
                                    <td data-label="@lang('Status')">
                                        {!! $item->getStatus() !!}
                                    </td>
                                    <td data-label="@lang('Submitted At')">
                                        <span>{{dateTime($item->created_at,basicControl()->date_time_format)}}</span>
                                    </td>
                                    <td data-label="@lang('Action')">
                                        <div class="dropdown">
                                            <button class="action-btn2" type="button" data-bs-toggle="dropdown"
                                                    aria-expanded="false">
                                                <i class="fa-regular fa-ellipsis-stroke-vertical"></i>
                                            </button>
                                            <ul class="dropdown-menu">
                                                <li><a class="dropdown-item showDetails" data-bs-target="#modalShow"
                                                       data-bs-toggle="modal"
                                                       data-res="{{json_encode($item->kycInfoShow())}}"
                                                       data-type="{{$item->kyc_type}}"
                                                       href="javascript:void(0)">@lang('View')</a>
                                                </li>
                                                @if($item->status == 2)
                                                    <li><a class="dropdown-item showReason"
                                                           data-bs-target="#modalReject"
                                                           data-bs-toggle="modal" data-reason="{{$item->reason}}"
                                                           href="javascript:void(0)">@lang('Reason')</a>
                                                    </li>
                                                @endif
                                            </ul>
                                        </div>
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

    {{--    Information show modal--}}
    <div class="modal fade" id="modalShow" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
         aria-labelledby="staticBackdropLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h1 class="modal-title modalTitle" id="staticBackdropLabel"></h1>
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fa-light fa-xmark"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <ul class="list-group list-group-flush list-group-no-gutters listShow">

                    </ul>
                </div>
                <div class="modal-footer">
                    <button type="button" class="cmn-btn" data-bs-dismiss="modal">@lang('Close')</button>
                </div>
            </div>
        </div>
    </div>

    {{--    Rejected Reason show modal--}}
    <div class="modal fade" id="modalReject" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
         aria-labelledby="staticBackdropLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h1 class="modal-title" id="staticBackdropLabel">@lang('Rejected Reason')</h1>
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fa-light fa-xmark"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p class="rejectedReason"></p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="cmn-btn" data-bs-dismiss="modal">@lang('Close')</button>
                </div>
            </div>
        </div>
    </div>

@endsection
@push('extra_scripts')
    <script>
        'use strict'
        $(document).on("click", ".showReason", function () {
            $('.rejectedReason').text($(this).data('reason'));
        });

        $(document).on("click", ".showDetails", function () {
            $('.listShow').html('');
            var show = "";
            let res = $(this).data('res');
            $('.modalTitle').text($(this).data('type'));
            for (let key in res) {
                if (res[key].type == 'file') {
                    show += `<li class="list-group-item">
                                 <div class="d-flex justify-content-between align-items-center">
                                    <h5>${res[key].name}</h5>
                                       <ul class="list-unstyled list-py-2 text-body text-end">
                                          <li>
                                             <a href="${res[key].value}"
                                                 target="_blank">
                                                   <img
                                                   src="${res[key].value}"
                                                   class="w-50">
                                             </a>
                                          </li>
                                       </ul>
                                 </div>
                             </li>`;
                } else {
                    show += `<li class="list-group-item">
                            <div class="d-flex justify-content-between align-items-center">
                                <h5>${res[key].name}</h5>
                                <ul class="list-unstyled list-py-2 text-body">
                                    <li>${res[key].value}</li>
                                </ul>
                            </div>
                        </li>
                `;
                }
            }

            $('.listShow').html(show);
        });
    </script>
@endpush
