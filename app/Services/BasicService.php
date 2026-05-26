<?php

namespace App\Services;


use App\Models\BuyRequest;
use App\Models\Deposit;
use App\Models\Fund;
use App\Models\SellRequest;
use App\Models\Transaction;
use App\Traits\Notify;
use App\Traits\SendNotification;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;

class BasicService
{
    use Notify, SendNotification;

    public function setEnv($value)
    {
        $envPath = base_path('.env');
        $env = file($envPath);
        foreach ($env as $env_key => $env_value) {
            $entry = explode("=", $env_value, 2);
            $env[$env_key] = array_key_exists($entry[0], $value) ? $entry[0] . "=" . $value[$entry[0]] . "\n" : $env_value;
        }
        $fp = fopen($envPath, 'w');
        fwrite($fp, implode($env));
        fclose($fp);
    }

    public function preparePaymentUpgradation($deposit, $type = 'automatic'): void
    {
        $basicControl = basicControl();

        try {
            if ($deposit->status == 0 || $type == 'manual') {
                if ($deposit->depositable_type == BuyRequest::class) {
                    $buyRequest = $deposit->depositable;
                    $buyRequest->status = 2;
                    $buyRequest->save();

                    $deposit->status = 1;
                    $deposit->save();

                    $amount = getBaseAmount($buyRequest->send_amount, optional($buyRequest->sendCurrency)->code, 'fiat');
                    $charge = getBaseAmount($buyRequest->service_fee + $buyRequest->network_fee, optional($buyRequest->getCurrency)->code, 'crypto');

                    $this->makeTransaction($amount, $charge, '-', 'Crypto Currency Buy',
                        $buyRequest->id, BuyRequest::class, $buyRequest->user_id, $buyRequest->send_amount, optional($buyRequest->sendCurrency)->code);


                    $this->sendAdminNotification($buyRequest, 'buy');
                }

                if ($deposit->user && $type == 'automatic') {
                    $params = [
                        'amount' => getAmount($deposit->amount, $basicControl->fraction_number),
                        'currency' => $basicControl->base_currency,
                        'transaction' => $deposit->utr,
                    ];

                    $action = [
                        "link" => "#",
                        "icon" => "fa fa-money-bill-alt text-white"
                    ];

                    $this->sendMailSms($deposit->user, 'USER_MAKE_PAYMENT', $params);
                    $this->userPushNotification($deposit->user, 'USER_MAKE_PAYMENT', $params, $action);
                    $this->userFirebasePushNotification($deposit->user, 'USER_MAKE_PAYMENT', $params);
                }

                if ($type == 'automatic') {
                    $params = [
                        'user' => optional($deposit->user)->username ?? 'Anonymous',
                        'amount' => getAmount($deposit->amount, $basicControl->fraction_number),
                        'currency' => $basicControl->base_currency,
                        'transaction' => $deposit->utr,
                    ];

                    $action = [
                        "link" => '#',
                        "icon" => "fa fa-money-bill-alt text-white"
                    ];

                    $this->adminMail('USER_MAKE_PAYMENT_ADMIN', $params);
                    $this->adminPushNotification('USER_MAKE_PAYMENT_ADMIN', $params, $action);
                    $this->adminFirebasePushNotification('USER_MAKE_PAYMENT_ADMIN', $params);
                }

                $deposit->status = 1;
                $deposit->save();

            }
        } catch (\Exception $e) {
        }
    }

    public function makeTransaction($amount, $charge, $trx_type, $remark, $transactional_id,
                                    $transactional_type, $userId = null, $transaction_amount = null, $transaction_currency = null)
    {
        $transaction = new Transaction();
        $transaction->user_id = $userId;
        $transaction->amount = $amount;
        $transaction->transaction_amount = $transaction_amount;
        $transaction->transaction_currency = $transaction_currency;
        $transaction->charge = $charge;
        $transaction->trx_type = $trx_type;
        $transaction->trx_id = uniqid('T');
        $transaction->remarks = $remark;
        $transaction->transactional_id = $transactional_id;
        $transaction->transactional_type = $transactional_type;
        $transaction->save();

        return $transaction;
    }

}
