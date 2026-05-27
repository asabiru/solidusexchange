<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\CustodialDeposit;
use App\Models\CustodialWallet;
use App\Services\Custodial\CustodialDepositService;
use App\Services\Custodial\CustodialWalletService;
use App\Services\Custodial\HdWalletService;
use Illuminate\Http\Request;
use Yajra\DataTables\Facades\DataTables;

class CustodialWalletController extends Controller
{
    public function index()
    {
        return view('admin.custodial.wallets.index');
    }

    public function walletsList(Request $request)
    {
        $wallets = CustodialWallet::query()->orderByDesc('id');

        return DataTables::of($wallets)
            ->addColumn('address_short', fn($w) => substr($w->address, 0, 8) . '...' . substr($w->address, -6))
            ->addColumn('provider_badge', function ($w) {
                return match ($w->provider) {
                    'hd_wallet' => '<span class="badge bg-soft-primary text-primary">HD Wallet</span>',
                    'crypto_cloud' => '<span class="badge bg-soft-info text-info">CryptoCloud</span>',
                    'manual' => '<span class="badge bg-soft-secondary text-body">Manual</span>',
                    default => '<span class="badge bg-soft-secondary text-body">' . $w->provider . '</span>',
                };
            })
            ->addColumn('derivation', function ($w) {
                if ($w->derivation_path) {
                    return '<small class="text-muted">' . $w->derivation_path . '</small><br><small>Index: ' . ($w->hd_wallet_index ?? '?') . '</small>';
                }
                return '<span class="text-muted">—</span>';
            })
            ->addColumn('status_badge', function ($w) {
                return match ($w->status) {
                    'active' => '<span class="badge bg-soft-success text-success">Active</span>',
                    'frozen' => '<span class="badge bg-soft-warning text-warning">Frozen</span>',
                    'retired' => '<span class="badge bg-soft-secondary text-body">Retired</span>',
                    default => '<span class="badge bg-soft-danger text-danger">Unknown</span>',
                };
            })
            ->addColumn('assignment', function ($w) {
                if ($w->assigned_exchange_id) {
                    return '<span class="badge bg-soft-info text-info">Assigned #' . $w->assigned_exchange_id . '</span>';
                }
                return '<span class="badge bg-soft-success text-success">Available</span>';
            })
            ->addColumn('last_deposit', function ($w) {
                if ($w->last_deposit_at) {
                    return $w->last_deposit_amount . ' ' . $w->currency_code . '<br><small>' . $w->last_deposit_at->diffForHumans() . '</small>';
                }
                return '<span class="text-muted">No deposits</span>';
            })
            ->addColumn('action', function ($w) {
                $freezeUrl = route('admin.custodialWalletFreeze', $w->id);
                $releaseUrl = route('admin.custodialWalletRelease', $w->id);
                $html = '';

                if ($w->status === 'active') {
                    $html .= "<a href=\"{$freezeUrl}\" class=\"btn btn-sm btn-outline-warning\" onclick=\"return confirm('Freeze this wallet?')\"><i class=\"bi-snow\"></i> Freeze</a> ";
                }
                if ($w->assigned_exchange_id) {
                    $html .= "<a href=\"{$releaseUrl}\" class=\"btn btn-sm btn-outline-success\" onclick=\"return confirm('Release this wallet?')\"><i class=\"bi-unlock\"></i> Release</a>";
                }
                return $html;
            })
            ->rawColumns(['provider_badge', 'derivation', 'status_badge', 'assignment', 'last_deposit', 'action'])
            ->make(true);
    }

    public function generateWallet(Request $request)
    {
        $request->validate(['currency_code' => 'required|string|max:20']);
        try {
            $service = app(CustodialWalletService::class);
            $wallet = $service->generateWallet($request->currency_code);
            return back()->with('success', "Wallet generated: {$wallet->address}");
        } catch (\Throwable $e) {
            return back()->with('error', 'Failed: ' . $e->getMessage());
        }
    }

    public function freezeWallet($id)
    {
        $wallet = CustodialWallet::findOrFail($id);
        $wallet->update(['status' => 'frozen']);
        return back()->with('success', 'Wallet frozen');
    }

    public function releaseWallet($id)
    {
        $wallet = CustodialWallet::findOrFail($id);
        app(CustodialWalletService::class)->release($wallet);
        return back()->with('success', 'Wallet released');
    }

    public function depositsIndex()
    {
        return view('admin.custodial.deposits.index');
    }

    public function depositsList(Request $request)
    {
        $deposits = CustodialDeposit::with('custodialWallet')->orderByDesc('id');

        return DataTables::of($deposits)
            ->addColumn('wallet_address', fn($d) => substr($d->custodialWallet->address ?? '', 0, 10) . '...')
            ->addColumn('status_badge', function ($d) {
                return match ($d->status) {
                    'pending' => '<span class="badge bg-soft-warning text-warning">Pending</span>',
                    'confirmed' => '<span class="badge bg-soft-info text-info">Confirmed</span>',
                    'aml_check' => '<span class="badge bg-soft-primary text-primary">AML Check</span>',
                    'aml_approved' => '<span class="badge bg-soft-success text-success">AML Approved</span>',
                    'aml_rejected' => '<span class="badge bg-soft-danger text-danger">AML Rejected</span>',
                    'processed' => '<span class="badge bg-soft-success text-success">Processed</span>',
                    default => '<span class="badge bg-soft-secondary text-body">' . $d->status . '</span>',
                };
            })
            ->addColumn('aml_info', function ($d) {
                if (!$d->aml_checked_at) return '<span class="text-muted">Not checked</span>';
                $level = $d->aml_risk_level ?? 'unknown';
                $color = match($level) { 'low' => 'success', 'medium' => 'warning', 'high' => 'danger', default => 'secondary' };
                return "<span class=\"badge bg-soft-{$color} text-{$color}\">{$level}</span> ({$d->aml_risk_score})";
            })
            ->addColumn('action', function ($d) {
                if ($d->status === 'aml_check' || ($d->aml_risk_level === 'medium')) {
                    $approveUrl = route('admin.custodialDepositApprove', $d->id);
                    $rejectUrl = route('admin.custodialDepositReject', $d->id);
                    return "<a href=\"{$approveUrl}\" class=\"btn btn-sm btn-outline-success\" onclick=\"return confirm('Approve this deposit?')\"><i class=\"bi-check\"></i></a> "
                         . "<a href=\"{$rejectUrl}\" class=\"btn btn-sm btn-outline-danger\" onclick=\"return confirm('Reject this deposit?')\"><i class=\"bi-x\"></i></a>";
                }
                return '';
            })
            ->rawColumns(['status_badge', 'aml_info', 'action'])
            ->make(true);
    }

    public function approveDeposit($id)
    {
        $deposit = CustodialDeposit::findOrFail($id);
        app(CustodialDepositService::class)->manualApprove($deposit);
        return back()->with('success', 'Deposit approved');
    }

    public function rejectDeposit($id, Request $request)
    {
        $deposit = CustodialDeposit::findOrFail($id);
        app(CustodialDepositService::class)->manualReject($deposit, $request->reason ?? '');
        return back()->with('success', 'Deposit rejected');
    }

    public function scanNow()
    {
        $results = app(CustodialDepositService::class)->scanAllWallets();
        return back()->with('success', "Scanned: {$results['scanned']}, New: {$results['new_deposits']}, Errors: {$results['errors']}");
    }
}
