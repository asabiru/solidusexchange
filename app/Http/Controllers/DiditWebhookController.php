<?php

namespace App\Http\Controllers;

use App\Services\Kyc\DiditKycService;
use Illuminate\Http\Request;
use RuntimeException;

class DiditWebhookController extends Controller
{
    public function __invoke(Request $request, DiditKycService $service)
    {
        try {
            return response()->json($service->handleWebhook($request), 200);
        } catch (RuntimeException $exception) {
            report($exception);

            return response()->json(['status' => 'error', 'message' => $exception->getMessage()], 401);
        }
    }
}
