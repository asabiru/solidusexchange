<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\SupportTicket;
use App\Models\SupportTicketAttachment;
use App\Models\SupportTicketMessage;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Exception;
use App\Traits\Upload;
use App\Traits\Notify;
use Illuminate\Support\Str;

class SupportCabinetController extends Controller
{
    use Upload, Notify;

    public function dashboard()
    {
        $ticketRecord = \Cache::get('ticketRecord');
        if (!$ticketRecord) {
            $ticketRecord = SupportTicket::selectRaw('COUNT(id) AS totalTicket')
                ->selectRaw('COUNT(CASE WHEN status = 0 THEN id END) AS openTicket')
                ->selectRaw('(COUNT(CASE WHEN status = 0 THEN id END) / COUNT(id)) * 100 AS openTicketPercentage')
                ->selectRaw('COUNT(CASE WHEN status = 1 THEN id END) AS answerTicket')
                ->selectRaw('(COUNT(CASE WHEN status = 1 THEN id END) / COUNT(id)) * 100 AS answerTicketPercentage')
                ->selectRaw('COUNT(CASE WHEN status = 2 THEN id END) AS repliedTicket')
                ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END) / COUNT(id)) * 100 AS repliedTicketPercentage')
                ->selectRaw('COUNT(CASE WHEN status = 3 THEN id END) AS closedTicket')
                ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END) / COUNT(id)) * 100 AS closedTicketPercentage')
                ->get()
                ->toArray();
        }

        $recentTickets = SupportTicket::with('user')
            ->orderBy('id', 'DESC')
            ->limit(10)
            ->get();

        return view('admin.support_cabinet.dashboard', compact('ticketRecord', 'recentTickets'));
    }

    public function tickets($status = 'all')
    {
        $ticketRecord = \Cache::get('ticketRecord');
        if (!$ticketRecord) {
            $ticketRecord = SupportTicket::selectRaw('COUNT(id) AS totalTicket')
                ->selectRaw('COUNT(CASE WHEN status = 0 THEN id END) AS openTicket')
                ->selectRaw('(COUNT(CASE WHEN status = 0 THEN id END) / COUNT(id)) * 100 AS openTicketPercentage')
                ->selectRaw('COUNT(CASE WHEN status = 1 THEN id END) AS answerTicket')
                ->selectRaw('(COUNT(CASE WHEN status = 1 THEN id END) / COUNT(id)) * 100 AS answerTicketPercentage')
                ->selectRaw('COUNT(CASE WHEN status = 2 THEN id END) AS repliedTicket')
                ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END) / COUNT(id)) * 100 AS repliedTicketPercentage')
                ->selectRaw('COUNT(CASE WHEN status = 3 THEN id END) AS closedTicket')
                ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END) / COUNT(id)) * 100 AS closedTicketPercentage')
                ->get()
                ->toArray();
        }
        return view('admin.support_cabinet.list', compact('status', 'ticketRecord'));
    }

    public function ticketSearch(Request $request, $status)
    {
        $filterSubject = $request->subject;
        $filterStatus = $request->filterStatus;
        $search = $request->search['value'] ?? null;
        $filterDate = explode('-', $request->filterDate);
        $startDate = $filterDate[0];
        $endDate = isset($filterDate[1]) ? trim($filterDate[1]) : null;

        $supportTicket = SupportTicket::with('user')
            ->orderBy('id', 'DESC')
            ->when(!empty($search), function ($query) use ($search) {
                return $query->where(function ($subquery) use ($search) {
                    $subquery->where('subject', 'LIKE', "%$search%")
                        ->orWhereHas('user', function ($q) use ($search) {
                            $q->where('firstname', 'LIKE', "%$search%");
                            $q->orWhere('lastname', 'LIKE', "%$search%");
                            $q->orWhere('username', 'LIKE', "%$search%");
                            $q->orWhere('email', 'LIKE', "%$search%");
                        });
                });
            })
            ->when(!empty($filterSubject), function ($query) use ($filterSubject) {
                return $query->where('subject', $filterSubject);
            })
            ->when(!empty($status), function ($query) use ($status) {
                if ($status == 'all') {
                    return $query->where('status', '!=', null);
                } elseif ($status == 'answered') {
                    return $query->where('status', '=', 1);
                } elseif ($status == 'replied') {
                    return $query->where('status', '=', 2);
                } elseif ($status == 'closed') {
                    return $query->where('status', '=', 3);
                }
            })
            ->when(isset($filterStatus), function ($query) use ($filterStatus) {
                if ($filterStatus == "all") {
                    return $query->where('status', '!=', null);
                }
                return $query->where('status', $filterStatus);
            })
            ->when(!empty($request->filterDate) && $endDate == null, function ($query) use ($startDate) {
                $startDate = Carbon::createFromFormat('d/m/Y', trim($startDate));
                $query->whereDate('created_at', $startDate);
            })
            ->when(!empty($request->filterDate) && $endDate != null, function ($query) use ($startDate, $endDate) {
                $startDate = Carbon::createFromFormat('d/m/Y', trim($startDate));
                $endDate = Carbon::createFromFormat('d/m/Y', trim($endDate));
                $query->whereBetween('created_at', [$startDate, $endDate]);
            });

        return \DataTables::of($supportTicket)
            ->addColumn('no', function () {
                static $counter = 0;
                $counter++;
                return $counter;
            })
            ->addColumn('username', function ($item) {
                return '<div class="d-flex align-items-center me-2">
                            <div class="flex-shrink-0">
                              ' . optional($item->user)->profilePicture() . '
                            </div>
                            <div class="flex-grow-1 ms-3">
                              <h5 class="text-hover-primary mb-0">' . optional($item->user)->firstname . ' ' . optional($item->user)->lastname . '</h5>
                              <span class="fs-6 text-body">' . optional($item->user)->username . '</span>
                            </div>
                          </div>';
            })
            ->addColumn('subject', function ($item) {
                return Str::limit($item->subject, 30);
            })
            ->addColumn('status', function ($item) {
                if ($item->status == 0) {
                    return ' <span class="badge bg-soft-warning text-warning">
                                    <span class="legend-indicator bg-warning"></span> ' . trans('Open') . '
                                </span>';
                } else if ($item->status == 1) {
                    return '<span class="badge bg-soft-success text-success">
                                    <span class="legend-indicator bg-success"></span> ' . trans('Answered') . '
                                </span>';
                } else if ($item->status == 2) {
                    return '<span class="badge bg-soft-info text-info">
                                    <span class="legend-indicator bg-info"></span> ' . trans('Customer Reply') . '
                                </span>';
                } else if ($item->status == 3) {
                    return '<span class="badge bg-soft-danger text-danger">
                                    <span class="legend-indicator bg-danger"></span> ' . trans('Closed') . '
                                </span>';
                }
            })
            ->addColumn('lastReply', function ($item) {
                return $item->last_reply;
            })
            ->addColumn('action', function ($item) {
                $url = route('admin.support.ticket.view', $item->id);
                return '<a class="btn btn-white btn-sm" href="' . $url . '">
                      <i class="bi-eye"></i> ' . trans("View") . '
                    </a>';
            })
            ->rawColumns(['username', 'subject', 'status', 'action'])
            ->make(true);
    }

    public function ticketView($id)
    {
        $ticket = SupportTicket::where('id', $id)->with('user', 'messages')->firstOrFail();
        $title = "Ticket #" . $ticket->ticket;
        return view('admin.support_cabinet.view', compact('ticket', 'title'));
    }

    public function ticketReplySend(Request $request, $id)
    {
        $request->validate([
            'message' => 'required|string',
        ]);

        DB::beginTransaction();
        try {
            $admin = Auth::guard('admin')->user();

            $ticketRes = SupportTicket::where('id', $id)->firstOr(function () {
                throw new \Exception('Данные не найдены!');
            });

            $ticketRes->update([
                'last_reply' => Carbon::now(),
                'status' => 1,
            ]);

            if (!$ticketRes) {
                DB::rollBack();
                throw new Exception('Ошибка при обновлении данных.');
            }

            $resTicketDetails = SupportTicketMessage::create([
                'support_ticket_id' => $id,
                'admin_id' => $admin->id,
                'message' => $request->message,
            ]);

            if (!$resTicketDetails) {
                DB::rollBack();
                throw new Exception('Ошибка при отправке ответа.');
            }

            DB::commit();

            $msg = [
                'username' => optional($ticketRes->user)->username,
                'ticket_id' => $ticketRes->ticket
            ];
            $action = [
                "name" => optional($ticketRes->user)->firstname . ' ' . optional($ticketRes->user)->lastname,
                "image" => null,
                "link" => route('user.ticket.view', $ticketRes->ticket),
                "icon" => "fas fa-ticket-alt text-white"
            ];

            $this->userPushNotification($ticketRes->user, 'SUPPORT_TICKET_REPLY', $msg, $action);
            $this->userFirebasePushNotification($ticketRes->user, 'SUPPORT_TICKET_REPLY', $msg, route('user.ticket.view', $ticketRes->ticket));
            $this->sendMailSms($ticketRes->user, 'TICKET_REPLY', [
                'ticket_id' => $ticketRes->ticket,
                'ticket_subject' => $ticketRes->subject,
                'reply' => $request->message,
            ]);

            try {
                $tgService = app(\App\Services\Telegram\TelegramNotificationService::class);
                $tgService->notifyTicketReply($ticketRes, $request->message);
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::error('Telegram notify error on reply: ' . $e->getMessage());
            }

            \Cache::forget('ticketRecord');

            return back()->with('success', 'Ответ успешно отправлен.');
        } catch (Exception $e) {
            DB::rollBack();
            return back()->with('error', $e->getMessage());
        }
    }

    public function ticketClose(Request $request, $id)
    {
        $ticket = SupportTicket::findOrFail($id);
        $ticket->status = 3;
        $ticket->last_reply = Carbon::now();
        $ticket->save();

        \Cache::forget('ticketRecord');

        return back()->with('success', 'Тикет закрыт.');
    }
}
