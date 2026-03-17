<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\CryptoCurrency;
use App\Models\ExchangeWallet;
use Illuminate\Http\Request;

class ExchangeWalletController extends Controller
{
    public function index()
    {
        $data['wallets'] = ExchangeWallet::orderByDesc('id')->paginate(20);
        return view('admin.exchange-wallet.index', $data);
    }

    public function create()
    {
        $data['currencies'] = CryptoCurrency::where('status', 1)->orderBy('sort_by', 'asc')->get(['id', 'code', 'name']);
        return view('admin.exchange-wallet.create', $data);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'currency_code' => 'required|string|max:50',
            'address' => 'required|string|max:255|unique:exchange_wallets,address',
            'network' => 'nullable|string|max:100',
            'label' => 'nullable|string|max:100',
            'notes' => 'nullable|string|max:1000',
            'status' => 'nullable|integer|in:0,1',
        ]);

        ExchangeWallet::create([
            'currency_code' => strtoupper(trim($validated['currency_code'])),
            'address' => trim($validated['address']),
            'network' => $validated['network'] ?? null,
            'label' => $validated['label'] ?? null,
            'notes' => $validated['notes'] ?? null,
            'status' => (bool)($validated['status'] ?? 0),
            'allocation_status' => 'available',
        ]);

        return redirect()->route('admin.exchangeWalletIndex')->with('success', 'Exchange wallet created successfully.');
    }

    public function edit($id)
    {
        $data['wallet'] = ExchangeWallet::findOrFail($id);
        $data['currencies'] = CryptoCurrency::where('status', 1)->orderBy('sort_by', 'asc')->get(['id', 'code', 'name']);
        return view('admin.exchange-wallet.edit', $data);
    }

    public function update(Request $request, $id)
    {
        $wallet = ExchangeWallet::findOrFail($id);

        $validated = $request->validate([
            'currency_code' => 'required|string|max:50',
            'address' => 'required|string|max:255|unique:exchange_wallets,address,' . $wallet->id,
            'network' => 'nullable|string|max:100',
            'label' => 'nullable|string|max:100',
            'notes' => 'nullable|string|max:1000',
            'status' => 'nullable|integer|in:0,1',
        ]);

        $wallet->update([
            'currency_code' => strtoupper(trim($validated['currency_code'])),
            'address' => trim($validated['address']),
            'network' => $validated['network'] ?? null,
            'label' => $validated['label'] ?? null,
            'notes' => $validated['notes'] ?? null,
            'status' => (bool)($validated['status'] ?? 0),
        ]);

        return back()->with('success', 'Exchange wallet updated successfully.');
    }

    public function delete($id)
    {
        $wallet = ExchangeWallet::findOrFail($id);

        if ($wallet->allocation_status !== 'available') {
            return back()->with('error', 'Only available wallets can be deleted.');
        }

        $wallet->delete();

        return back()->with('success', 'Exchange wallet deleted successfully.');
    }
}
