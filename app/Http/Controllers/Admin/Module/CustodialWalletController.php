<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\CustodialDeposit;
use App\Models\CustodialWallet;
use App\Models\CustodialWithdrawal;
use App\Services\Custodial\CustodialDepositService;
use App\Services\Custodial\CustodialWalletService;
use App\Services\Custodial\CustodialWithdrawalService;
use App\Services\Custodial\HdWalletService;
use Illuminate\Http\Request;
use Yajra\DataTables\Facades\DataTables;

class CustodialWalletController extends Controller
{
    private function postButton(string $url, string $icon, string $class, ?string $confirm = null, string $label = ''): string
    {
        $confirmAttr = $confirm ? " onclick=\"return confirm('".e($confirm)."')\"" : '';
        $labelHtml = $label !== '' ? ' ' . e($label) : '';

        return '<form action="'.e($url).'" method="POST" style="display:inline-block;margin:0">'
            . csrf_field()
            . '<button type="submit" class="'.e($class).'"'.$confirmAttr.'>'
            . '<i class="'.e($icon).'"></i>'.$labelHtml
            . '</button>'
            . '</form>';
    }

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
                if ($w->status === 'frozen' || $w->assigned_exchange_id) {
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
            ->addColumn('balance_info', function ($w) {
                $bal = number_format((float)$w->balance, 8);
                $checked = $w->last_checked_at ? $w->last_checked_at->diffForHumans() : 'Never';
                return "<strong>{$bal}</strong> <small class=\"text-muted\">{$w->currency_code}</small><br><small class=\"text-muted\">Checked: {$checked}</small>";
            })
            ->addColumn('action', function ($w) {
                $freezeUrl = route('admin.custodialWalletFreeze', $w->id);
                $releaseUrl = route('admin.custodialWalletRelease', $w->id);
                $checkUrl = route('admin.custodialWalletCheckBalance', $w->id);
                $withdrawUrl = route('admin.custodialWithdrawalCreate', $w->id);
                $releaseLabel = $w->status === 'frozen' ? 'Unfreeze' : 'Release';
                $html = '';

                $html .= $this->postButton($checkUrl, 'bi-wallet2', 'btn btn-sm btn-outline-primary') . ' ';

                if ($w->status === 'active' && (float)$w->balance > 0) {
                    $html .= "<a href=\"{$withdrawUrl}\" class=\"btn btn-sm btn-outline-info\"><i class=\"bi-arrow-up-right\"></i></a> ";
                }

                if ($w->status === 'active') {
                    $html .= $this->postButton($freezeUrl, 'bi-snow', 'btn btn-sm btn-outline-warning', 'Freeze this wallet?') . ' ';
                }
                if ($w->status === 'frozen' || $w->assigned_exchange_id) {
                    $html .= $this->postButton($releaseUrl, 'bi-unlock', 'btn btn-sm btn-outline-success', 'Release this wallet?', $releaseLabel);
                }
                return $html;
            })
            ->rawColumns(['provider_badge', 'derivation', 'status_badge', 'assignment', 'last_deposit', 'balance_info', 'action'])
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
        if ($wallet->status === 'frozen') {
            return back()->with('error', 'Wallet is already frozen.');
        }
        $wallet->update(['status' => 'frozen']);
        return back()->with('success', 'Wallet frozen');
    }

    public function releaseWallet($id)
    {
        $wallet = CustodialWallet::findOrFail($id);
        if ($wallet->status !== 'frozen' && blank($wallet->assigned_exchange_id)) {
            return back()->with('error', 'Only frozen or assigned wallets can be released.');
        }
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
                    return $this->postButton($approveUrl, 'bi-check', 'btn btn-sm btn-outline-success', 'Approve this deposit?') . ' '
                         . $this->postButton($rejectUrl, 'bi-x', 'btn btn-sm btn-outline-danger', 'Reject this deposit?');
                }
                return '';
            })
            ->rawColumns(['status_badge', 'aml_info', 'action'])
            ->make(true);
    }

    public function approveDeposit($id)
    {
        $deposit = CustodialDeposit::findOrFail($id);
        if (!in_array($deposit->status, ['pending', 'aml_check', 'aml_approved'], true)) {
            return back()->with('error', 'Deposit is not in an approvable state.');
        }
        app(CustodialDepositService::class)->manualApprove($deposit);
        return back()->with('success', 'Deposit approved');
    }

    public function rejectDeposit($id, Request $request)
    {
        $deposit = CustodialDeposit::findOrFail($id);
        if (!in_array($deposit->status, ['pending', 'aml_check', 'aml_approved'], true)) {
            return back()->with('error', 'Deposit is not in a rejectable state.');
        }
        app(CustodialDepositService::class)->manualReject($deposit, $request->reason ?? '');
        return back()->with('success', 'Deposit rejected');
    }

    public function scanNow()
    {
        $results = app(CustodialDepositService::class)->scanAllWallets();
        return back()->with('success', "Scanned: {$results['scanned']}, New: {$results['new_deposits']}, Errors: {$results['errors']}");
    }

    // ─── Balance Check ────────────────────────────────────────────────────

    public function checkAllBalances()
    {
        $results = app(HdWalletService::class)->checkAllBalances();
        $total = count($results);
        $errors = count(array_filter($results, fn($r) => isset($r['error'])));
        return back()->with('success', "Checked {$total} wallets, {$errors} errors");
    }

    public function checkWalletBalance($id)
    {
        $wallet = CustodialWallet::findOrFail($id);
        $result = app(HdWalletService::class)->getBalance($wallet);

        if (isset($result['error'])) {
            return back()->with('error', "Balance check failed: {$result['error']}");
        }

        return back()->with('success', "Balance: {$result['balance']} {$result['currency_code']}");
    }

    // ─── Withdrawals ─────────────────────────────────────────────────────

    public function withdrawalsIndex()
    {
        return view('admin.custodial.withdrawals.index');
    }

    public function withdrawalsList(Request $request)
    {
        $withdrawals = CustodialWithdrawal::with('wallet')->orderByDesc('id');

        return DataTables::of($withdrawals)
            ->addColumn('wallet_address', fn($w) => substr($w->from_address, 0, 10) . '...')
            ->addColumn('to_short', fn($w) => substr($w->to_address, 0, 10) . '...' . substr($w->to_address, -6))
            ->addColumn('status_badge', function ($w) {
                return match ($w->status) {
                    'pending'    => '<span class="badge bg-soft-warning text-warning">Pending</span>',
                    'approved'  => '<span class="badge bg-soft-info text-info">Approved</span>',
                    'processing' => '<span class="badge bg-soft-primary text-primary">Processing</span>',
                    'completed'  => '<span class="badge bg-soft-success text-success">Completed</span>',
                    'failed'     => '<span class="badge bg-soft-danger text-danger">Failed</span>',
                    'rejected'   => '<span class="badge bg-soft-secondary text-body">Rejected</span>',
                    default      => '<span class="badge bg-soft-secondary text-body">' . $w->status . '</span>',
                };
            })
            ->addColumn('tx_link', function ($w) {
                if (!$w->txid) return '<span class="text-muted">—</span>';
                return '<small title="' . $w->txid . '">' . substr($w->txid, 0, 12) . '...</small>';
            })
            ->addColumn('action', function ($w) {
                $html = '';
                if ($w->status === 'pending') {
                    $approveUrl = route('admin.custodialWithdrawalApprove', $w->id);
                    $rejectUrl = route('admin.custodialWithdrawalReject', $w->id);
                    $html .= $this->postButton($approveUrl, 'bi-check', 'btn btn-sm btn-outline-success', 'Approve?') . ' ';
                    $html .= $this->postButton($rejectUrl, 'bi-x', 'btn btn-sm btn-outline-danger', 'Reject?');
                }
                if ($w->status === 'approved') {
                    $execUrl = route('admin.custodialWithdrawalExecute', $w->id);
                    $html .= $this->postButton($execUrl, 'bi-send', 'btn btn-sm btn-outline-primary', 'Execute withdrawal now? This will send funds.', 'Send');
                }
                if ($w->status === 'failed') {
                    $retryUrl = route('admin.custodialWithdrawalRetry', $w->id);
                    $html .= $this->postButton($retryUrl, 'bi-arrow-clockwise', 'btn btn-sm btn-outline-warning', 'Retry?');
                }
                return $html;
            })
            ->rawColumns(['status_badge', 'tx_link', 'action'])
            ->make(true);
    }

    public function createWithdrawal($walletId)
    {
        $wallet = CustodialWallet::findOrFail($walletId);
        if ($wallet->status !== 'active') {
            return back()->with('error', 'Withdrawals are allowed only for active wallets.');
        }
        return view('admin.custodial.withdrawals.create', compact('wallet'));
    }

    public function storeWithdrawal(Request $request)
    {
        $request->validate([
            'wallet_id'   => 'required|exists:custodial_wallets,id',
            'to_address'  => 'required|string',
            'amount'      => 'required|numeric|min:0.00001',
            'note'        => 'nullable|string|max:500',
        ]);

        try {
            $withdrawal = app(CustodialWithdrawalService::class)
                ->createRequest($request->wallet_id, $request->to_address, $request->amount, $request->note);

            return redirect()
                ->route('admin.custodialWithdrawals')
                ->with('success', "Withdrawal #{$withdrawal->id} created ({$request->amount} {$withdrawal->currency_code})");
        } catch (\Throwable $e) {
            return back()->withInput()->with('error', 'Failed: ' . $e->getMessage());
        }
    }

    public function approveWithdrawal($id)
    {
        try {
            $w = app(CustodialWithdrawalService::class)->approve($id);
            return back()->with('success', "Withdrawal #{$id} approved");
        } catch (\Throwable $e) {
            return back()->with('error', $e->getMessage());
        }
    }

    public function rejectWithdrawal($id)
    {
        try {
            $w = app(CustodialWithdrawalService::class)->reject($id);
            return back()->with('success', "Withdrawal #{$id} rejected");
        } catch (\Throwable $e) {
            return back()->with('error', $e->getMessage());
        }
    }

    public function executeWithdrawal($id)
    {
        try {
            $w = app(CustodialWithdrawalService::class)->execute($id);
            return back()->with('success', "Withdrawal #{$id} completed! TXID: {$w->txid}");
        } catch (\Throwable $e) {
            return back()->with('error', "Withdrawal failed: " . $e->getMessage());
        }
    }

    public function retryWithdrawal($id)
    {
        $withdrawal = CustodialWithdrawal::findOrFail($id);
        if ($withdrawal->status !== 'failed') {
            return back()->with('error', 'Can only retry failed withdrawals');
        }

        // Reset to approved so it can be re-executed
        $withdrawal->update(['status' => 'approved', 'error' => null]);
        return back()->with('success', "Withdrawal #{$id} reset to approved — click Send to retry");
    }
}
