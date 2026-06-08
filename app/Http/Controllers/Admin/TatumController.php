<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\TatumSubscription;
use App\Services\Tatum\TatumNotificationService;
use App\Services\Tatum\TatumService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;

class TatumController extends Controller
{
    public function __construct(
        private readonly TatumService $tatum,
        private readonly TatumNotificationService $notifications
    ) {}

    public function settings()
    {
        $subscriptions = TatumSubscription::orderBy('id', 'desc')->limit(100)->get();

        $settings = [
            'api_key'        => env('TATUM_API_KEY', ''),
            'webhook_secret' => env('TATUM_WEBHOOK_SECRET', ''),
            'testnet'        => (bool) env('TATUM_TESTNET', false),
        ];

        return view('admin.tatum.settings', compact('settings', 'subscriptions'));
    }

    public function saveSettings(Request $request)
    {
        $request->validate([
            'api_key'        => 'required|string|max:255',
            'webhook_secret' => 'nullable|string|max:255',
        ]);

        // Write to .env file
        $this->setEnvValue('TATUM_API_KEY', $request->api_key);
        $this->setEnvValue('TATUM_WEBHOOK_SECRET', $request->webhook_secret ?? '');
        $this->setEnvValue('TATUM_TESTNET', $request->testnet ? 'true' : 'false');
        $this->setEnvValue('TATUM_WEBHOOK_URL', url('api/tatum/webhook'));

        Artisan::call('config:clear');

        return back()->with('success', 'Tatum settings saved successfully.');
    }

    public function testConnection()
    {
        try {
            $subs = $this->tatum->listSubscriptions(1);
            return back()->with('success', 'Tatum API connection successful! API key is valid.');
        } catch (\Throwable $e) {
            return back()->with('error', 'Connection failed: ' . $e->getMessage());
        }
    }

    public function unsubscribe($id)
    {
        $sub = TatumSubscription::findOrFail($id);
        $this->notifications->unsubscribeById($sub->tatum_id);

        return back()->with('success', "Subscription {$sub->tatum_id} removed.");
    }

    private function setEnvValue(string $key, string $value): void
    {
        $envPath = base_path('.env');
        $content = file_get_contents($envPath);

        // Quote if contains spaces
        if (str_contains($value, ' ')) {
            $value = '"' . $value . '"';
        }

        if (preg_match("/^{$key}=.*/m", $content)) {
            $content = preg_replace("/^{$key}=.*/m", "{$key}={$value}", $content);
        } else {
            $content .= "\n{$key}={$value}";
        }

        file_put_contents($envPath, $content);
    }
}
