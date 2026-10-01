<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;

class SchedulerController extends Controller
{
    /**
     * Run the Laravel scheduler via HTTP request.
     * Protected by a secret token to prevent unauthorized access.
     */
    public function run(Request $request): JsonResponse
    {
        $secret = config('app.scheduler_secret');

        if (!$secret || $request->query('secret') !== $secret) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        try {
            $exitCode = Artisan::call('schedule:run');

            return response()->json([
                'status' => 'ok',
                'exit_code' => $exitCode,
            ]);
        } catch (\Throwable $e) {
            Log::error('Scheduler HTTP run failed: ' . $e->getMessage());

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Run only the crypto rate sync command.
     */
    public function syncCryptoRates(Request $request): JsonResponse
    {
        $secret = config('app.scheduler_secret');

        if (!$secret || $request->query('secret') !== $secret) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        try {
            $exitCode = Artisan::call('app:crypto-currency-update-cron');

            return response()->json([
                'status' => 'ok',
                'exit_code' => $exitCode,
            ]);
        } catch (\Throwable $e) {
            Log::error('Crypto rate sync failed: ' . $e->getMessage());

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Run only the fiat rate sync command.
     */
    public function syncFiatRates(Request $request): JsonResponse
    {
        $secret = config('app.scheduler_secret');

        if (!$secret || $request->query('secret') !== $secret) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        try {
            $exitCode = Artisan::call('app:fiat-currency-update-cron');

            return response()->json([
                'status' => 'ok',
                'exit_code' => $exitCode,
            ]);
        } catch (\Throwable $e) {
            Log::error('Fiat rate sync failed: ' . $e->getMessage());

            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
            ], 500);
        }
    }
}
