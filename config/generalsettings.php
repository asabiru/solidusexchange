<?php
return [
    'settings' => [
        'basic-control' => [
            'route' => 'admin.basic.control',
            'icon' => 'fa-light fa-image',
            'short_description' => 'Basic such as, site title, timezone, currency, notifications, verifications and so on.',
        ],
        'logo' => [
            'route' => 'admin.logo.settings',
            'icon' => 'fa-light fa-image',
            'short_description' => 'Logo settings such as, logo, footer logo, admin logo, favicon, breadcrumb.',
        ],
        'push-notification' => [
            'route' => 'admin.settings',
            'route_segment' => ['push-notification'],
            'icon' => 'fa-light fa-bullhorn',
            'short_description' => 'Push notification settings such as, firebase configuration and push notification templates.',
        ],
        'in-app-notification' => [
            'route' => 'admin.settings',
            'route_segment' => ['in-app-notification'],
            'icon' => 'fa-light fa-bell',
            'short_description' => 'In app notification settings such as, pusher configuration and in app notification templates.',
        ],
        'email' => [
            'route' => 'admin.settings',
            'route_segment' => ['email'],
            'icon' => 'fa-light fa-envelope',
            'short_description' => 'Email settings such as, email configuration and email templates.',
        ],
        'SMS' => [
            'route' => 'admin.settings',
            'route_segment' => ['sms'],
            'icon' => 'fa-light fa-message',
            'short_description' => 'SMS settings such as, SMS configuration and SMS templates.',
        ],
        'language' => [
            'route' => 'admin.language.index',
            'icon' => 'fa-light fa-language',
            'short_description' => 'Language settings such as, create new language, add keywords and so on.',
        ],
        'Storage' => [
            'route' => 'admin.storage.index',
            'icon' => 'fa-light fa-database',
            'short_description' => 'Storage settings such as, store images.',
        ],
        '2FA-Security' => [
            'route' => 'admin.twoFa.control',
            'icon' => 'fa-light fas fa-shield-alt',
            'short_description' => "2FA security helps safeguard your account from unauthorized access.",
        ],
        'exchange-configuration' => [
            'route' => 'admin.exchange.control',
            'icon' => 'fa-light fas fa-wrench',
            'short_description' => "Configure the exchange module, encompassing functionalities for buying and selling, to enhance the overall system's trading capabilities.",
        ],
        'exchange_API' => [
            'route' => 'admin.currency.exchange.api.config',
            'icon' => 'bi bi-arrow-down-up',
            'short_description' => 'Currency Layer Access Key, Coin Market Cap App Key, Select update time and so on.',
        ],
        'kyc_provider' => [
            'route' => 'admin.kyc.provider.config',
            'icon' => 'fa-light fa-id-card',
            'short_description' => 'KYC provider settings such as Sumsub API credentials, default level, SDK and webhook readiness.',
        ],
        'translate_api' => [
            'route' => 'admin.translate.api.setting',
            'icon' => 'fa-sharp fa-light fa-language',
            'short_description' => 'Translate API service for google sheet, drive and others.',
        ],
        'plugin' => [
            'route' => 'admin.plugin.config',
            'icon' => 'fa-thin fa-toolbox',
            'short_description' => 'Message your customers, reCAPTCHA protects, google analytics your website and so on.',
        ],
        'Socialite' => [
            'route' => 'admin.socialite.index',
            'icon' => 'fas fa-share-alt',
            'short_description' => 'Socialite settings such as, advantage for user login there dashboard without register process.',
        ],
        'maintenance_mode' => [
            'route' => 'admin.maintenance.index',
            'icon' => 'fa-thin fa-screwdriver-wrench',
            'short_description' => "Maintenance mode is a feature that allows you to temporarily disable access to your online store's frontend while you perform updates.",
        ],
    ],
    'plugin' => [
        'tawk' => [
            'route' => 'admin.tawk.configuration',
            'icon' => 'fa-thin fa-crow nav-icon',
            'short_description' => 'Message your customers,they\'ll love you for it',
        ],
        'fb-messenger' => [
            'route' => 'admin.fb.messenger.configuration',
            'icon' => 'bi bi-chat-right-dots nav-icon',
            'short_description' => 'Message your customers,they\'ll love you for it',
        ],
        'google-recaptcha' => [
            'route' => 'admin.google.recaptcha.configuration',
            'icon' => 'bi-google nav-icon',
            'short_description' => 'reCAPTCHA protects your website from fraud and abuse.',
        ],
        'manual-recaptcha' => [
            'route' => 'admin.manual.recaptcha',
            'icon' => 'bi bi-file-lock nav-icon',
            'short_description' => 'reCAPTCHA protects your website from fraud and abuse.',
        ],
        'google-analytics' => [
            'route' => 'admin.google.analytics.configuration',
            'icon' => 'bi bi-graph-down nav-icon',
            'short_description' => 'Google Analytics is a web analytics service offered by Google.',
        ],
    ],
    'Socialite' => [
        'google-control' => [
            'route' => 'admin.google.control',
            'icon' => 'fab fa-google',
            'short_description' => 'Socialite login your customers,they\'ll love you for it.',
        ],
        'facebook-control' => [
            'route' => 'admin.facebook.control',
            'icon' => 'fab fa-facebook-f',
            'short_description' => 'Socialite login your customers,they\'ll love you for it.',
        ],
        'github-control' => [
            'route' => 'admin.github.control',
            'icon' => 'fab fa-github',
            'short_description' => 'Socialite login your customers,they\'ll love you for it.',
        ],
        'telegram-control' => [
            'route' => 'admin.telegram.control',
            'icon' => 'fab fa-telegram-plane',
            'short_description' => 'Socialite login your customers,they\'ll love you for it.',
        ],
    ],
    'in-app-notification' => [
        'in-app-notification-controls' => [
            'route' => 'admin.pusher.config',
            'icon' => 'far fa-bell',
            'short_description' => 'Setup pusher configuration for in app notifications.',
        ],
        'notification-templates' => [
            'route' => 'admin.in.app.notification.templates',
            'icon' => 'fa-light fa-scroll',
            'short_description' => 'Setup in app notification templates',
        ]
    ],
    'push-notification' => [
        'push-notification-configuration' => [
            'route' => 'admin.firebase.config',
            'icon' => 'bi-bell nav-icon',
            'short_description' => 'Setup firebase configuration for push notifications.',
        ],
        'notification-templates' => [
            'route' => 'admin.push.notification.templates',
            'icon' => 'fas fa-scroll',
            'short_description' => 'Setup in app notification templates',
        ]
    ],
    'email' => [
        'email-configuration' => [
            'route' => 'admin.email.control',
            'icon' => 'fa-light fa-envelope',
            'short_description' => 'Email Config such as, sender email, email methods and etc.',
        ],
        'default-templates' => [
            'route' => 'admin.email.template.default',
            'icon' => 'fa-light fa-shield-cross',
            'short_description' => 'Setup email templates for default email notifications.',
        ],
        'email-templates' => [
            'route' => 'admin.email.templates',
            'icon' => 'fas fa-laptop-code',
            'short_description' => 'Setup email templates for different email notifications.',
        ]

    ],
    'sms' => [
        'SMS-configuration' => [
            'route' => 'admin.sms.controls',
            'icon' => 'bi bi-chat-square-dots',
            'short_description' => 'Setup SMS api configuration for sending sms notifications.',
        ],
        'SMS-templates' => [
            'route' => 'admin.sms.templates',
            'icon' => 'fas fa-laptop-code',
            'short_description' => 'Setup sms templates for different email notifications.',
        ]
    ],
];

