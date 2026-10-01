@extends($theme.'layouts.user')
@section('page_title',__('Tickets Log'))

@section('content')
    <div class="card">
        <div class="card-header d-flex justify-content-between border-0">
            <h4>@lang('Tickets Log')</h4>
            <div class="btn-area">
                <a href="{{ route('user.ticket.create') }}" class="cmn-btn3 mb-1"><i
                        class="fa-regular fa-plus-circle me-1"></i> @lang('New Ticket')</a>
            </div>
        </div>
        <div class="card-body">
            <div class="cmn-table">
                <div class="table-responsive overflow-hidden">
                    <table class="table align-middle table-striped">
                        <thead>
                        <tr>
                            <th scope="col">@lang('Subject')</th>
                            <th scope="col">@lang('Status')</th>
                            <th scope="col">@lang('Last Reply')</th>
                            <th scope="col">@lang('Action')</th>
                        </tr>
                        </thead>
                        <tbody>
                        @if(count($tickets) > 0)
                            @foreach($tickets as $key => $ticket)
                                <tr>
                                    <td data-label="@lang('Subject')"><span>[{{ trans('Ticket# ').__($ticket->ticket) }}
													] {{ __($ticket->subject) }}</span></td>
                                    <td data-label="@lang('Status')">
                                        {!! $ticket->getStatus() !!}
                                    </td>
                                    <td data-label="@lang('Last Reply')">
                                        <span>{{ dateTime($ticket->last_reply,basicControl()->date_time_format) }}</span>
                                    </td>

                                    <td data-label="@lang('Action')">
                                        <a href="{{ route('user.ticket.view', $ticket->ticket) }}"
                                           class="action-btn-primary"><i
                                                class="fa-regular fa-pen-to-square"></i></a>
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
    {{ $tickets->appends($_GET)->links($theme.'partials.user.pagination') }}
@endsection
