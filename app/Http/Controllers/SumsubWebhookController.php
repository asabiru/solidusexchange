<?php

namespace App\Http\Controllers;

use App\Services\Kyc\SumsubKycService;
use Illuminate\Http\Request;
use RuntimeException;

class SumsubWebhookController extends Controller
{
    public function __invoke(Request $request, SumsubKycService $service)
    {
        try {
            return response()->json($service->handleWebhook($request), 200);
        } catch (RuntimeException $exception) {
            return response()->json(['status' => 'error', 'message' => $exception->getMessage()], 422);
        }
    }
}
