<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\Gateway;
use App\Models\PricingSetting;
use Illuminate\Http\Request;

class PricingSettingController extends Controller
{
    public function index()
    {
        $settings = [
            'all_in_rate_enabled' => (int) PricingSetting::getValue('all_in_rate_enabled', 0),
            'aml_fee_usd'         => PricingSetting::getValue('aml_fee_usd', 1),
            'kyc_fee_usd'         => PricingSetting::getValue('kyc_fee_usd', 1),
            'usn_tax_percent'     => PricingSetting::getValue('usn_tax_percent', 15),
            'nspk_percent'        => PricingSetting::getValue('nspk_percent', 3),
        ];

        $profiles = PricingSetting::getArray('gateway_profiles', []);

        // Active manual gateways (id >= 1000) — the payment methods we keep.
        $gateways = Gateway::where('id', '>=', 1000)->orderBy('id')->get();

        return view('admin.pricing.settings', compact('settings', 'profiles', 'gateways'));
    }

    public function update(Request $request)
    {
        $request->validate([
            'aml_fee_usd'     => 'required|numeric|min:0',
            'kyc_fee_usd'     => 'required|numeric|min:0',
            'usn_tax_percent' => 'required|numeric|min:0|max:100',
            'nspk_percent'    => 'required|numeric|min:0|max:100',
        ]);

        PricingSetting::put('all_in_rate_enabled', $request->boolean('all_in_rate_enabled') ? 1 : 0);
        PricingSetting::put('aml_fee_usd', (float) $request->aml_fee_usd);
        PricingSetting::put('kyc_fee_usd', (float) $request->kyc_fee_usd);
        PricingSetting::put('usn_tax_percent', (float) $request->usn_tax_percent);
        PricingSetting::put('nspk_percent', (float) $request->nspk_percent);

        // Per-gateway cost profile toggles.
        $profiles = [];
        foreach ((array) $request->input('gateway', []) as $id => $flags) {
            $profiles[(string) $id] = [
                'apply_nspk' => !empty($flags['apply_nspk']),
                'apply_tax'  => !empty($flags['apply_tax']),
            ];
        }
        PricingSetting::put('gateway_profiles', $profiles);

        return back()->with('success', 'Настройки ценообразования сохранены');
    }
}
