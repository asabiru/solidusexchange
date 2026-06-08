<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\CustodialWallet;
use App\Services\Custodial\HdWalletService;
use App\Services\Custodial\InternalTransferService;
use Illuminate\Http\Request;

class InternalTransferController extends Controller
{
    public function __construct(
        private readonly InternalTransferService $transferService,
        private readonly HdWalletService $hdWallet,
    ) {}

    public function index()
    {
        $wallets = CustodialWallet::where('status', 'active')
            ->orderBy('currency_code')
            ->get();

        $history = $this->transferService->getHistory(30);

        return view('admin.internal_transfer.index', compact('wallets', 'history'));
    }

    public function store(Request $request)
    {
        $request->validate([
            'from_wallet_id' => 'required|integer|exists:custodial_wallets,id',
            'to_wallet_id'   => 'required|integer|exists:custodial_wallets,id|different:from_wallet_id',
            'amount'         => 'nullable|numeric|min:0',
        ]);

        $from   = CustodialWallet::findOrFail($request->from_wallet_id);
        $to     = CustodialWallet::findOrFail($request->to_wallet_id);
        $amount = (float) ($request->amount ?? 0);

        try {
            $result = $this->transferService->transfer($from, $to, $amount);

            $msg = "Transfer successful! "
                 . number_format($result['amount'], 8) . ' ' . $result['currency']
                 . " sent. TxID: " . ($result['txid'] ?? 'pending');

            return back()->with('success', $msg);
        } catch (\Throwable $e) {
            return back()->with('error', $e->getMessage());
        }
    }

    /**
     * AJAX: get live balance for a wallet.
     */
    public function balance(int $id)
    {
        $wallet = CustodialWallet::findOrFail($id);

        try {
            $info = $this->hdWallet->getBalance($wallet);
            return response()->json([
                'balance'  => $info['balance'] ?? $wallet->balance,
                'currency' => $wallet->currency_code,
                'address'  => $wallet->address,
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'balance'  => $wallet->balance,
                'currency' => $wallet->currency_code,
                'address'  => $wallet->address,
                'error'    => $e->getMessage(),
            ]);
        }
    }
}
