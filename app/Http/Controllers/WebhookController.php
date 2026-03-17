<?php

namespace App\Http\Controllers;

use App\Models\CryptoMethod;
use App\Models\ExchangeRequest;
use App\Models\SellRequest;
use Illuminate\Http\Request;

class WebhookController extends Controller
{

    public function webhookResponse(Request $request, $code, $type = 'exchange')
    {
        $cryptoMethod = CryptoMethod::where('code', $code)->first();
        $serviceClass = 'App\\Services\\CryptoMethod\\' . $code . '\\Service';
        if (!$cryptoMethod || !class_exists($serviceClass)) {
            return response()->json('ok', 200);
        }

        [$object, $resolvedType] = $this->resolveWebhookObject($request, $type);
        $data = app($serviceClass)->webhookUpdate($request, $object, $cryptoMethod, $resolvedType);

        return response()->json($data, 200);
    }

    public function withdrawWebhookResponse(Request $request, $code, $utr, $type)
    {
        return response()->json('ok', 200);
    }

    private function resolveWebhookObject(Request $request, ?string $type): array
    {
        $address = $request->input('invoice_info.address', $request->input('address'));
        $orderId = $request->input('order_id');

        $candidateTypes = in_array($type, ['exchange', 'sell'], true)
            ? [$type, 'exchange', 'sell']
            : ['exchange', 'sell'];

        foreach (array_values(array_unique($candidateTypes)) as $candidateType) {
            $object = $this->findWebhookObject($candidateType, $address, $orderId);
            if ($object) {
                return [$object, $candidateType];
            }
        }

        return [null, in_array($type, ['exchange', 'sell'], true) ? $type : 'exchange'];
    }

    private function findWebhookObject(string $type, ?string $address, ?string $orderId)
    {
        if (empty($address) && empty($orderId)) {
            return null;
        }

        $query = $type === 'sell' ? SellRequest::query() : ExchangeRequest::query();
        $query->where('status', 1)
            ->where(function ($builder) use ($address, $orderId) {
                if (!empty($address)) {
                    $builder->where('admin_wallet', $address);
                }

                if (!empty($orderId)) {
                    if (!empty($address)) {
                        $builder->orWhere('utr', $orderId)
                            ->orWhere('deposit_provider_ref', $orderId);
                    } else {
                        $builder->where(function ($inner) use ($orderId) {
                            $inner->where('utr', $orderId)
                                ->orWhere('deposit_provider_ref', $orderId);
                        });
                    }
                }
            });

        return $query->latest()->first();
    }
}
