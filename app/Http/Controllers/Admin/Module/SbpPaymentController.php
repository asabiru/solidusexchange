<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\SbpPayment;
use App\Services\Sbp\SbpQrService;
use Illuminate\Http\Request;
use Yajra\DataTables\Facades\DataTables;

class SbpPaymentController extends Controller
{
    public function index()
    {
        $stats = [
            'total'     => SbpPayment::count(),
            'pending'   => SbpPayment::pending()->count(),
            'paid'      => SbpPayment::paid()->count(),
            'expired'   => SbpPayment::expired()->count(),
        ];
        return view('admin.custodial.sbp.index', compact('stats'));
    }

    public function list(Request $request)
    {
        $query = SbpPayment::query()->orderByDesc('id');

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }

        return DataTables::of($query)
            ->addColumn('status_badge', function ($p) {
                return match ($p->status) {
                    'pending'   => '<span class="badge bg-soft-warning text-warning">Pending</span>',
                    'paid'      => '<span class="badge bg-soft-info text-info">Paid</span>',
                    'confirmed' => '<span class="badge bg-soft-success text-success">Confirmed</span>',
                    'rejected'  => '<span class="badge bg-soft-danger text-danger">Rejected</span>',
                    'refunded'  => '<span class="badge bg-soft-secondary text-body">Refunded</span>',
                    'expired'   => '<span class="badge bg-soft-secondary text-body">Expired</span>',
                    default     => '<span class="badge bg-soft-secondary text-body">' . $p->status . '</span>',
                };
            })
            ->addColumn('provider_badge', function ($p) {
                return match ($p->provider) {
                    'tinkoff'   => '<span class="badge bg-soft-warning text-warning">Tinkoff</span>',
                    'static_qr' => '<span class="badge bg-soft-info text-info">Static QR</span>',
                    'manual'    => '<span class="badge bg-soft-secondary text-body">Manual</span>',
                    default     => '<span class="badge bg-soft-secondary text-body">' . $p->provider . '</span>',
                };
            })
            ->addColumn('payable_link', function ($p) {
                if ($p->payable_type === 'App\\Models\\SellRequest') {
                    return '<a href="' . route('admin.sellView', ['id' => $p->payable_id]) . '">Sell #' . $p->payable_id . '</a>';
                }
                return $p->payable_type ? class_basename($p->payable_type) . ' #' . $p->payable_id : '—';
            })
            ->addColumn('action', function ($p) {
                $html = '';
                if ($p->status === 'paid') {
                    $confirmUrl = route('admin.sbpConfirm', $p->id);
                    $html .= "<a href=\"{$confirmUrl}\" class=\"btn btn-sm btn-outline-success\" onclick=\"return confirm('Confirm this payment?')\"><i class=\"bi-check\"></i> Confirm</a> ";
                }
                if (in_array($p->status, ['pending', 'paid'])) {
                    $rejectUrl = route('admin.sbpReject', $p->id);
                    $html .= "<a href=\"{$rejectUrl}\" class=\"btn btn-sm btn-outline-danger\" onclick=\"return confirm('Reject this payment?')\"><i class=\"bi-x\"></i></a>";
                }
                return $html;
            })
            ->rawColumns(['status_badge', 'provider_badge', 'payable_link', 'action'])
            ->make(true);
    }

    public function confirm($id)
    {
        $payment = SbpPayment::findOrFail($id);
        if ($payment->status !== 'paid') {
            return back()->with('error', 'Payment is not in paid status');
        }

        $payment->update([
            'status' => 'confirmed',
            'confirmed_at' => now(),
        ]);

        // If linked to a sell request, update its status
        if ($payment->payable_type === 'App\\Models\\SellRequest' && $payment->payable_id) {
            $sellRequest = \App\Models\SellRequest::find($payment->payable_id);
            if ($sellRequest && $sellRequest->status === 2) {
                $sellRequest->update(['status' => 3]); // 3 = completed
            }
        }

        return back()->with('success', 'Payment confirmed');
    }

    public function reject($id)
    {
        $payment = SbpPayment::findOrFail($id);
        $payment->update(['status' => 'rejected']);
        return back()->with('success', 'Payment rejected');
    }

    /**
     * Settings page for SBP/Tinkoff configuration.
     */
    public function settings()
    {
        $tinkoff = [
            'terminal_key' => config('services.tinkoff.terminal_key'),
            'inn'          => config('services.tinkoff.inn'),
            'base_url'     => config('services.tinkoff.base_url'),
            'configured'   => !empty(config('services.tinkoff.terminal_key')),
        ];
        $sbp = [
            'bank_id'        => config('services.sbp.bank_id'),
            'account_number' => config('services.sbp.account_number'),
            'recipient_name' => config('services.sbp.recipient_name'),
            'inn'            => config('services.sbp.inn'),
            'qr_ttl_minutes' => config('services.sbp.qr_ttl_minutes'),
        ];

        return view('admin.custodial.sbp.settings', compact('tinkoff', 'sbp'));
    }
}
