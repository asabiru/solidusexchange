<?php

namespace App\Traits;

trait SendNotification
{
    use Notify;

    public function sendAdminNotification($object, $type): void
    {
        $this->{$type}($object);
    }

    public function sendUserNotification($object, $type, $templateKey): void
    {
        $this->{$type}($object, $templateKey);
    }

    public function userExchange($exchangeRequest, $templateKey): void
    {
        if ($exchangeRequest->user_id && $exchangeRequest->user) {
            $params = [
                'user' => optional($exchangeRequest->user)->username ?? 'Anonymous',
                'sendAmount' => rtrim(rtrim($exchangeRequest->send_amount, 0), '.'),
                'getAmount' => rtrim(rtrim($exchangeRequest->get_amount, 0), '.'),
                'sendCurrency' => optional($exchangeRequest->sendCurrency)->code,
                'getCurrency' => optional($exchangeRequest->getCurrency)->code,
                'transaction' => $exchangeRequest->utr,
            ];

            $action = [
                "link" => '#',
                "icon" => "fa fa-money-bill-alt text-white"
            ];
            $this->sendMailSms($exchangeRequest->user, $templateKey, $params);
            $this->userPushNotification($exchangeRequest->user, $templateKey, $params, $action);
            $this->userFirebasePushNotification($exchangeRequest->user, $templateKey, $params);
        }
    }

    public function userBuy($buyRequest, $templateKey): void
    {
        if ($buyRequest->user_id && $buyRequest->user) {
            $params = [
                'user' => optional($buyRequest->user)->username ?? 'Anonymous',
                'sendAmount' => number_format($buyRequest->send_amount, 2),
                'getAmount' => rtrim(rtrim($buyRequest->get_amount, 0), '.'),
                'sendCurrency' => optional($buyRequest->sendCurrency)->code,
                'getCurrency' => optional($buyRequest->getCurrency)->code,
                'transaction' => $buyRequest->utr,
            ];

            $action = [
                "link" => '#',
                "icon" => "fa fa-money-bill-alt text-white"
            ];
            $this->sendMailSms($buyRequest->user, $templateKey, $params);
            $this->userPushNotification($buyRequest->user, $templateKey, $params, $action);
            $this->userFirebasePushNotification($buyRequest->user, $templateKey, $params);
        }
    }

    public function userSell($sellRequest, $templateKey): void
    {
        if ($sellRequest->user_id && $sellRequest->user) {
            $params = [
                'user' => optional($sellRequest->user)->username ?? 'Anonymous',
                'sendAmount' => rtrim(rtrim($sellRequest->send_amount, 0), '.'),
                'getAmount' => number_format($sellRequest->get_amount, 2),
                'sendCurrency' => optional($sellRequest->sendCurrency)->code,
                'getCurrency' => optional($sellRequest->getCurrency)->code,
                'transaction' => $sellRequest->utr,
            ];

            $action = [
                "link" => '#',
                "icon" => "fa fa-money-bill-alt text-white"
            ];
            $this->sendMailSms($sellRequest->user, $templateKey, $params);
            $this->userPushNotification($sellRequest->user, $templateKey, $params, $action);
            $this->userFirebasePushNotification($sellRequest->user, $templateKey, $params);
        }
    }

    public function exchange($exchangeRequest): void
    {
        $params = [
            'user' => optional($exchangeRequest->user)->username ?? 'Anonymous',
            'sendAmount' => rtrim(rtrim($exchangeRequest->send_amount, 0), '.'),
            'getAmount' => rtrim(rtrim($exchangeRequest->get_amount, 0), '.'),
            'sendCurrency' => optional($exchangeRequest->sendCurrency)->code,
            'getCurrency' => optional($exchangeRequest->getCurrency)->code,
            'transaction' => $exchangeRequest->utr,
        ];

        $action = [
            "link" => route('admin.exchangeView') . '?id=' . $exchangeRequest->id,
            "icon" => "fa fa-money-bill-alt text-white"
        ];

        $this->adminMail('EXCHANGE_REQUEST', $params);
        $this->adminPushNotification('EXCHANGE_REQUEST', $params, $action);
        $this->adminFirebasePushNotification('EXCHANGE_REQUEST', $params, $action);
    }

    public function buy($buyRequest): void
    {
        $params = [
            'user' => optional($buyRequest->user)->username ?? 'Anonymous',
            'sendAmount' => number_format($buyRequest->send_amount, 2),
            'getAmount' => rtrim(rtrim($buyRequest->get_amount, 0), '.'),
            'sendCurrency' => optional($buyRequest->sendCurrency)->code,
            'getCurrency' => optional($buyRequest->getCurrency)->code,
            'transaction' => $buyRequest->utr,
        ];

        $action = [
            "link" => route('admin.buyView') . '?id=' . $buyRequest->id,
            "icon" => "fa fa-money-bill-alt text-white"
        ];

        $this->adminMail('BUY_REQUEST', $params);
        $this->adminPushNotification('BUY_REQUEST', $params, $action);
        $this->adminFirebasePushNotification('BUY_REQUEST', $params, $action);
    }

    public function sell($sellRequest): void
    {
        $params = [
            'user' => optional($sellRequest->user)->username ?? 'Anonymous',
            'sendAmount' => rtrim(rtrim($sellRequest->send_amount, 0), '.'),
            'getAmount' => number_format($sellRequest->get_amount, 2),
            'sendCurrency' => optional($sellRequest->sendCurrency)->code,
            'getCurrency' => optional($sellRequest->getCurrency)->code,
            'transaction' => $sellRequest->utr,
        ];

        $action = [
            "link" => route('admin.sellView') . '?id=' . $sellRequest->id,
            "icon" => "fa fa-money-bill-alt text-white"
        ];

        $this->adminMail('SELL_REQUEST', $params);
        $this->adminPushNotification('SELL_REQUEST', $params, $action);
        $this->adminFirebasePushNotification('SELL_REQUEST', $params, $action);
    }

}
