<?php

namespace App\Traits;

use App\Models\CryptoMethod;
use App\Models\ExchangeRequest;
use App\Models\SellRequest;
use App\Services\ExchangeEngine\ExchangeAutomationService;
use App\Services\ExchangePipeline\ExchangeAmlService;
use App\Services\ExchangePipeline\ExchangeWalletInventoryService;
use App\Services\Sell\TraderAssignmentService;
use Facades\App\Services\BasicService;
use Throwable;

trait CryptoWalletGenerate
{
    use SendNotification;

    public function getCryptoWallet($cryptoCode, $type = 'exchange', array $context = [])
    {
        $activeMethod = CryptoMethod::where('status', 1)->first();
        if (!$activeMethod) {
            return $this->errorMsg('Active crypto method not found');
        }

        $serviceClass = 'App\\Services\\CryptoMethod\\' . $activeMethod->code . '\\Service';
        if (!class_exists($serviceClass)) {
            return $this->errorMsg('Crypto method service not found');
        }

        try {
            $data = app($serviceClass)->prepareData($activeMethod, $cryptoCode, $type, $context);
            if ($data) {
                return $this->successMsg($data);
            }
        } catch (Throwable $exception) {
            report($exception);
            return $this->errorMsg($exception->getMessage());
        }

        return $this->errorMsg('something went wrong');
    }

    public function walletUpgration($object, $type, array $meta = []): void
    {
        if ($type == 'exchange') {
            if ((int)$object->status >= 2) {
                return;
            }

            $object->status = 2;
            if (isset($meta['deposit_amount'])) {
                $object->deposit_amount_confirmed = $meta['deposit_amount'];
            }
            if (isset($meta['deposit_tx_id'])) {
                $object->deposit_tx_id = $meta['deposit_tx_id'];
            }
            $object->save();
            $amount = getBaseAmount($object->send_amount, optional($object->sendCurrency)->code, 'crypto');
            $charge = getBaseAmount($object->service_fee + $object->network_fee, optional($object->getCurrency)->code, 'crypto');

            try {
                if (($object->deposit_provider ?? null) === 'treasury_wallet') {
                    app(ExchangeWalletInventoryService::class)->markConsumedForExchange($object);
                }
            } catch (Throwable $exception) {
                report($exception);
            }

            BasicService::makeTransaction($amount, $charge, '-', 'Crypto Deposit For Exchange',
                $object->id, ExchangeRequest::class, $object->user_id, $object->send_amount, optional($object->sendCurrency)->code);

            $amlDecision = [
                'status' => 'approved',
                'should_block_processing' => false,
            ];

            try {
                $amlDecision = app(ExchangeAmlService::class)->screenConfirmedDeposit(
                    $object->fresh(['sendCurrency', 'getCurrency', 'cryptoMethod']),
                    $meta
                );
            } catch (Throwable $exception) {
                report($exception);
            }

            if (($amlDecision['status'] ?? null) !== 'approved' && ($amlDecision['should_block_processing'] ?? true)) {
                $this->sendAdminNotification($object->fresh(), 'exchange');
                return;
            }

            $isAutoProcessed = false;

            try {
                $isAutoProcessed = app(ExchangeAutomationService::class)->handleConfirmedDeposit($object->fresh(['sendCurrency', 'getCurrency', 'cryptoMethod']));
            } catch (Throwable $exception) {
                report($exception);
            }

            if (!$isAutoProcessed) {
                $this->sendAdminNotification($object->fresh(), 'exchange');
            }
        } elseif ($type == 'sell') {
            if ((int)$object->status >= 2) {
                return;
            }

            $object->status = 2;
            $object->save();

            try {
                app(TraderAssignmentService::class)->assignForSell($object->fresh(['fiatSendGateway']));
            } catch (Throwable $exception) {
                report($exception);
            }

            $amount = getBaseAmount($object->send_amount, optional($object->sendCurrency)->code, 'crypto');
            $charge = getBaseAmount($object->processing_fee, optional($object->getCurrency)->code, 'fiat');

            BasicService::makeTransaction($amount, $charge, '-', 'Crypto Deposit For Sell',
                $object->id, SellRequest::class, $object->user_id, $object->send_amount, optional($object->sendCurrency)->code);

            $this->sendAdminNotification($object, 'sell');
        }
    }


    public function errorMsg($msg)
    {
        return [
            'status' => false,
            'message' => $msg,
        ];
    }

    public function successMsg($msg)
    {
        return [
            'status' => true,
            'message' => $msg,
        ];
    }
}
