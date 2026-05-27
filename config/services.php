<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'mailgun' => [
        'domain' => env('MAILGUN_DOMAIN'),
        'secret' => env('MAILGUN_SECRET'),
        'endpoint' => env('MAILGUN_ENDPOINT', 'api.mailgun.net'),
        'scheme' => 'https',
    ],

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
        'token' => env('AWS_SESSION_TOKEN'),
    ],

    'sendinblue' => [
        'key' => env('SENDINBLUE_API_KEY')
    ],

    'sendgrid' => [
        'key' => env('SENDGRID_API_KEY')
    ],

    'mandrill' => [
        'key' => env('MAILCHIMP_API_KEY')
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('GOOGLE_REDIRECT_URL'),
    ],
    'facebook' => [
        'client_id' => env('FACEBOOK_CLIENT_ID'),
        'client_secret' => env('FACEBOOK_CLIENT_SECRET'),
        'redirect' => env('FACEBOOK_REDIRECT_URL'),
    ],
    'github' => [
        'client_id' => env('GITHUB_CLIENT_ID'),
        'client_secret' => env('GITHUB_CLIENT_SECRET'),
        'redirect' => env('GITHUB_REDIRECT'),
    ],
    'telegram' => [
        'bot_name' => env('TELEGRAM_BOT_USERNAME'),
        'bot_token' => env('TELEGRAM_BOT_TOKEN'),
    ],

    'rapira' => [
        'market_rates_url' => env('RAPIRA_MARKET_RATES_URL', 'https://api.rapira.net/open/market/rates'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Tinkoff Business API (SBP QR Payments)
    |--------------------------------------------------------------------------
    */
    'tinkoff' => [
        'terminal_key' => env('TINKOFF_TERMINAL_KEY', ''),
        'api_key'      => env('TINKOFF_API_KEY', ''),
        'password'     => env('TINKOFF_PASSWORD', ''),  // For webhook token verification
        'base_url'     => env('TINKOFF_BASE_URL', 'https://securepay.tinkoff.ru/v2'),
        'inn'          => env('TINKOFF_INN', ''),
    ],

    /*
    |--------------------------------------------------------------------------
    | SBP (Система Быстрых Платежей) — Static QR Fallback
    |--------------------------------------------------------------------------
    */
    'sbp' => [
        'bank_id'        => env('SBP_BANK_ID', 'TINKOFF'),
        'account_number' => env('SBP_ACCOUNT_NUMBER', ''),
        'recipient_name' => env('SBP_RECIPIENT_NAME', ''),
        'inn'            => env('SBP_INN', ''),
        'qr_ttl_minutes' => (int) env('SBP_QR_TTL_MINUTES', 30),
    ],
];
