<?php

return [
    'default_consent_version' => env('COMPLIANCE_CONSENT_VERSION', '2026-05-25'),
    'marketplace_role' => env('COMPLIANCE_MARKETPLACE_ROLE', 'intermediary'),
    'default_source_channel' => env('COMPLIANCE_DEFAULT_SOURCE_CHANNEL', 'web'),

    'kyc_provider' => env('KYC_PROVIDER', 'sumsub'),
    'aml_provider' => env('AML_PROVIDER', 'manual'),

    'manual_aml' => [
        'auto_approve_low_risk' => env('AML_MANUAL_AUTO_APPROVE_LOW_RISK', false),
        'auto_block_processing' => env('AML_MANUAL_AUTO_BLOCK_PROCESSING', true),
    ],
];
