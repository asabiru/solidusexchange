@extends('admin.layouts.app')
@section('page_title',__('Support Ticket'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item">
                                <a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@lang("Support Ticket")</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang("Support Ticket")</h1>
                </div>
            </div>
        </div>

        <div class="card message_section">
            <div class="card-header">
                <div class="top-bar">
                    <div class="d-flex align-items-center justify-content-between">
                        <div>
                            @if($ticket->status == 0)
                                <span class="badge bg-soft-warning text-warning">
                                    <span class="legend-indicator bg-warning"></span>@lang("Open")
                                </span>
                            @elseif($ticket->status == 1)
                                <span class="badge bg-soft-success text-success">
                                     <span class="legend-indicator bg-success"></span>@lang("Answered")
                                </span>
                            @elseif($ticket->status == 2)
                                <span class="badge bg-soft-info text-info">
                                    <span class="legend-indicator bg-info"></span>@lang("Customer Reply")
                                </span>
                            @elseif($ticket->status == 3)
                                <span class="badge bg-soft-danger text-danger">
                                    <span class="legend-indicator bg-danger"></span>@lang("Closed")
                                </span>
                            @endif
                            <span>[{{trans('Ticket#'). __($ticket->ticket) }}] {{ __($ticket->subject) }}</span>
                        </div>
                        <div>
                            @if($ticket->status != 3)
                                <button class="btn btn-white set" type="button"
                                        data-route="{{ route('admin.support.ticket.close', $ticket->id) }}"
                                        data-bs-toggle="modal"
                                        data-bs-target="#CloseTicketModal">
                                    <i class="bi bi-x-square"></i> @lang("Close")
                                </button>
                            @endif
                        </div>
                    </div>
                </div>
            </div>
            <div class="message-wrapper">
                <div class="row g-lg-0">
                    <div class="col-12">
                        <div class="inbox-wrapper">
                            <div class="chats">
                                @forelse($ticket->messages as $message)
                                    @if($message->admin_id == null)
                                        <div class="chat-box this-side">
                                            <div class="text-wrapper">
                                                <div class="text">
                                                    <p>@lang($message->message)</p>
                                                </div>
                                                @if(count($message->attachments) > 0)
                                                    <div class="text-info my-3 d-flex time">
                                                        @forelse($message->attachments as $k => $file)
                                                            <a href="{{ route('admin.ticket.download',encrypt($file->id)) }}"
                                                               class="file" type="button">
                                                                <i class="fal fa-file"></i>
                                                                @lang('File(s)') {{ ++$k}}
                                                            </a>
                                                        @empty
                                                        @endforelse
                                                    </div>
                                                @endif
                                                <span class="time">{{ __($message->created_at->format('d M, Y h:i A')) }}</span>
                                            </div>
                                            <div class="img">
                                                <span class="badge bg-soft-primary text-primary rounded-circle d-inline-flex align-items-center justify-content-center"
                                                      style="width: 2.25rem; height: 2.25rem;">
                                                    {{ \Illuminate\Support\Str::upper(\Illuminate\Support\Str::substr(optional($ticket->user)->firstname ?? optional($ticket->user)->username ?? 'U', 0, 1)) }}
                                                </span>
                                            </div>
                                        </div>
                                    @endif
                                    @if($message->admin_id)
                                        <div class="chat-box opposite-side">
                                            <div class="img">
                                                <img class="img-fluid"
                                                     src="{{ auth()->guard('admin')->user()->profilePicture() }}"
                                                     alt="Изображение админа"/>
                                            </div>
                                            <div class="text-wrapper">
                                                <div class="text">
                                                    <p>@lang($message->message)</p>
                                                </div>
                                                @if(count($message->attachments) > 0)
                                                    <div class="text-info my-3 d-flex time">
                                                        @forelse($message->attachments as $k => $file)
                                                            <a href="{{ route('admin.ticket.download',encrypt($file->id)) }}"
                                                               class="file" type="button">
                                                                <i class="fal fa-file"></i>
                                                                @lang('File(s)') {{ ++$k}}
                                                            </a>
                                                        @empty
                                                        @endforelse
                                                    </div>
                                                @endif
                                                <span class="time">{{ __($message->created_at->format('d M, Y h:i A')) }}</span>
                                            </div>
                                        </div>
                                    @endif
                                @empty
                                @endforelse
                            </div>

                            @if($ticket->status != 3)
                                <div class="typing-area">
                                    <form action="{{ route('admin.support.ticket.reply', $ticket->id) }}"
                                          method="post" enctype="multipart/form-data">
                                        @csrf
                                        @method('put')
                                        <div class="row">
                                            <div class="col-md-12 mb-3">
                                                <textarea class="form-control" name="message" rows="3" placeholder="@lang('Type your message...')" required></textarea>
                                            </div>
                                            <div class="col-md-12 d-flex justify-content-between align-items-center">
                                                <button type="submit" class="btn btn-primary">@lang('Send Reply')</button>
                                            </div>
                                        </div>
                                    </form>
                                </div>
                            @endif
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="CloseTicketModal" tabindex="-1" role="dialog" aria-labelledby="CloseTicketModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="CloseTicketModalLabel">@lang('Close Ticket')</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form action="" method="post" id="closeTicketForm">
                    @csrf
                    @method('put')
                    <div class="modal-body">
                        @lang('Are you sure you want to close this ticket?')
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Cancel')</button>
                        <button type="submit" class="btn btn-danger">@lang('Close Ticket')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
@endsection

@push('script')
    <script>
        $(document).on('click', '.set', function () {
            var route = $(this).data('route');
            $('#closeTicketForm').attr('action', route);
        });
    </script>
@endpush
