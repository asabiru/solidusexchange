<?php

namespace App\Services\Gateway\square;

use App\Models\Deposit;
use Facades\App\Services\BasicService;

class Payment
{
    public static function prepareData($deposit, $gateway)
    {
        if ($gateway->environment == 'test') {
            $url = "https://connect.squareupsandbox.com/v2/online-checkout/payment-links";
        } else {
            $url = "https://connect.squareup.com/v2/online-checkout/payment-links";
        }

        $postParam = [
            "idempotency_key" => $deposit->trx_id,
            "quick_pay" => [
                "name" => "Payment",
                "price_money" => [
                    "amount" => (int)$deposit->payable_amount,
                    "currency" => $deposit->payment_method_currency
                ],
                "location_id" => $gateway->parameters->location_id
            ],
            "checkout_options" => [
                "redirect_url" => route('success')
            ],
        ];

        $ch = curl_init();

        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($postParam));

        $headers = array();
        $headers[] = 'Square-Version: 2023-12-13';
        $headers[] = 'Authorization: Bearer ' . $gateway->parameters->access_token;
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        $result = curl_exec($ch);
        curl_close($ch);
        $res = json_decode($result);

        if (isset($res) && isset($res->payment_link) && isset($res->payment_link->url)) {
            $deposit->note = $res->payment_link->order_id;
            $deposit->save();

            $send['redirect'] = true;
            $send['redirect_url'] = $res->payment_link->url;
        } else {
            $send['error'] = true;
            $send['message'] = 'Payment not initiate. contact with provider';
        }

        return json_encode($send);
    }

    public static function ipn($request, $gateway, $deposit = null, $trx = null, $type = null)
    {
        $orderId = $request->data->id ?? null;
        $eventType = $request->type;
        $orderState = $request->data->object->order_updated->state;
        if ($orderId && $eventType == 'order.updated' && $orderState == 'OPEN') {
            $deposit = Deposit::where('status', 0)->where('note', $orderId)->latest()->first();
            if ($deposit) {
                BasicService::preparePaymentUpgradation($deposit);

                $data['status'] = 'success';
                $data['msg'] = 'Transaction was successful.';
                $data['redirect'] = route('success');
                return $data;
            }
        }

        $data['status'] = 'error';
        $data['msg'] = 'unable to Process.';
        $data['redirect'] = route('failed');
        return $data;
    }
}
