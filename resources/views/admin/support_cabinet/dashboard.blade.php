@extends('admin.layouts.app')
@section('page_title', __('Support Dashboard'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <h1 class="page-header-title">@lang('Support Dashboard')</h1>
                    <p class="text-body mb-0">@lang('Overview of all support tickets and recent activity.')</p>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-sm-6 col-lg-3 mb-3 mb-lg-5">
                <div class="card h-100">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang("Open Tickets")</h6>
                        <div class="row align-items-center gx-2">
                            <div class="col">
                                <span class="js-counter display-4 text-dark">{{ $ticketRecord[0]['openTicket'] ?? 0 }}</span>
                                <span class="text-body fs-5 ms-1">@lang("From") {{ $ticketRecord[0]['totalTicket'] ?? 0 }}</span>
                            </div>
                            <div class="col-auto">
                              <span class="badge bg-soft-warning text-warning p-1">
                                <i class="bi-graph-up"></i> {{ fractionNumber($ticketRecord[0]['openTicketPercentage'] ?? 0) }}%
                              </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-sm-6 col-lg-3 mb-3 mb-lg-5">
                <div class="card h-100">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang("Answered Tickets")</h6>
                        <div class="row align-items-center gx-2">
                            <div class="col">
                                <span class="js-counter display-4 text-dark">{{ $ticketRecord[0]['answerTicket'] ?? 0 }}</span>
                                <span class="text-body fs-5 ms-1">@lang("From") {{ $ticketRecord[0]['totalTicket'] ?? 0 }}</span>
                            </div>
                            <div class="col-auto">
                              <span class="badge bg-soft-success text-success p-1">
                                <i class="bi-graph-up"></i> {{ fractionNumber($ticketRecord[0]['answerTicketPercentage'] ?? 0) }}%
                              </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-sm-6 col-lg-3 mb-3 mb-lg-5">
                <div class="card h-100">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang("Replied Tickets")</h6>
                        <div class="row align-items-center gx-2">
                            <div class="col">
                                <span class="js-counter display-4 text-dark">{{ $ticketRecord[0]['repliedTicket'] ?? 0 }}</span>
                                <span class="text-body fs-5 ms-1">@lang("From") {{ $ticketRecord[0]['totalTicket'] ?? 0 }}</span>
                            </div>
                            <div class="col-auto">
                              <span class="badge bg-soft-info text-info p-1">
                                <i class="bi-graph-down"></i> {{ fractionNumber($ticketRecord[0]['repliedTicketPercentage'] ?? 0) }}%
                              </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="col-sm-6 col-lg-3 mb-3 mb-lg-5">
                <div class="card h-100">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang("Closed Tickets")</h6>
                        <div class="row align-items-center gx-2">
                            <div class="col">
                                <span class="js-counter display-4 text-dark">{{ $ticketRecord[0]['closedTicket'] ?? 0 }}</span>
                                <span class="text-body fs-5 ms-1">@lang("From") {{ $ticketRecord[0]['totalTicket'] ?? 0 }}</span>
                            </div>
                            <div class="col-auto">
                              <span class="badge bg-soft-danger text-danger p-1">
                                <i class="bi-graph-down"></i> {{ fractionNumber($ticketRecord[0]['closedTicketPercentage'] ?? 0) }}%
                              </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-12 mb-4">
                <div class="card h-100">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h4 class="card-title mb-0">@lang('Recent Tickets')</h4>
                        <a href="{{ route('admin.support.tickets') }}" class="btn btn-white btn-sm">@lang('View All')</a>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-borderless table-nowrap table-align-middle card-table mb-0">
                            <thead class="thead-light">
                            <tr>
                                <th>@lang('Ticket#')</th>
                                <th>@lang('User')</th>
                                <th>@lang('Subject')</th>
                                <th>@lang('Status')</th>
                                <th>@lang('Last Reply')</th>
                                <th>@lang('Action')</th>
                            </tr>
                            </thead>
                            <tbody>
                            @forelse($recentTickets as $item)
                                <tr>
                                    <td>{{ $item->ticket }}</td>
                                    <td>
                                        <div class="d-flex align-items-center">
                                            <div class="flex-shrink-0">
                                                {!! optional($item->user)->profilePicture() !!}
                                            </div>
                                            <div class="flex-grow-1 ms-3">
                                                <h5 class="mb-0">{{ optional($item->user)->firstname }} {{ optional($item->user)->lastname }}</h5>
                                                <span class="fs-6 text-body">{{ optional($item->user)->username }}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td>{{ Str::limit($item->subject, 30) }}</td>
                                    <td>
                                        @if($item->status == 0)
                                            <span class="badge bg-soft-warning text-warning">@lang('Open')</span>
                                        @elseif($item->status == 1)
                                            <span class="badge bg-soft-success text-success">@lang('Answered')</span>
                                        @elseif($item->status == 2)
                                            <span class="badge bg-soft-info text-info">@lang('Customer Reply')</span>
                                        @elseif($item->status == 3)
                                            <span class="badge bg-soft-danger text-danger">@lang('Closed')</span>
                                        @endif
                                    </td>
                                    <td>{{ $item->last_reply }}</td>
                                    <td>
                                        <a class="btn btn-white btn-sm" href="{{ route('admin.support.ticket.view', $item->id) }}">
                                            <i class="bi-eye"></i> @lang('View')
                                        </a>
                                    </td>
                                </tr>
                            @empty
                                <tr>
                                    <td colspan="6" class="text-center">@lang('No tickets found')</td>
                                </tr>
                            @endforelse
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection
