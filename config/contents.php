<?php
return [
    // -------------------------------------------------------
    // Social Links (используется в футере)
    // -------------------------------------------------------
    'social' => [
        'multiple' => [
            'field_name' => [
                'name'    => 'text',   // Название: Telegram, Email и т.д.
                'icon'    => 'text',   // FontAwesome класс: fa-brands fa-telegram
                'my_link' => 'url',    // URL или mailto:
            ],
            'validation' => [
                'name.*'    => 'required|max:100',
                'icon.*'    => 'required|max:100',
                'my_link.*' => 'required|max:300',
            ]
        ],
        'preview' => 'assets/preview/social.png',
    ],

    // -------------------------------------------------------
    // FAQ (вопросы и ответы на главной)
    // -------------------------------------------------------
    'faq' => [
        'single' => [
            'field_name' => [
                'title'     => 'text',
                'sub_title' => 'text',
            ],
            'validation' => [
                'title.*'     => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
            ]
        ],
        'multiple' => [
            'field_name' => [
                'title'     => 'text',
                'sub_title' => 'text',
            ],
            'validation' => [
                'title.*'     => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
            ]
        ],
        'preview' => 'assets/preview/faq.png',
    ],

    // -------------------------------------------------------
    // How It Works (как работает сервис)
    // -------------------------------------------------------
    'how_it_work' => [
        'single' => [
            'field_name' => [
                'title'     => 'text',
                'sub_title' => 'text',
            ],
            'validation' => [
                'title.*'     => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
            ]
        ],
        'multiple' => [
            'field_name' => [
                'title'     => 'text',
                'sub_title' => 'text',
            ],
            'validation' => [
                'title.*'     => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
            ]
        ],
        'preview' => 'assets/preview/how_it_work.png',
    ],

    // -------------------------------------------------------
    // Testimonials / Reviews (отзывы клиентов)
    // -------------------------------------------------------
    'testimonial' => [
        'single' => [
            'field_name' => [
                'title'     => 'text',
                'sub_title' => 'text',
            ],
            'validation' => [
                'title.*'     => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
            ]
        ],
        'multiple' => [
            'field_name' => [
                'name'        => 'text',
                'address'     => 'text',
                'star'        => 'text',
                'description' => 'textarea',
                'image'       => 'file',
            ],
            'validation' => [
                'name.*'        => 'required|max:100',
                'address.*'     => 'required|max:3000',
                'star.*'        => 'required|numeric|min:1|max:5',
                'description.*' => 'required|max:10000',
                'image.*'       => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'preview' => 'assets/preview/testimonial.png',
    ],

    // -------------------------------------------------------
    // Subscribe / Newsletter (форма подписки)
    // -------------------------------------------------------
    'subscribe' => [
        'single' => [
            'field_name' => [
                'title'     => 'text',
                'sub_title' => 'textarea',
            ],
            'validation' => [
                'title.*'     => 'required|max:300',
                'sub_title.*' => 'required|max:1000',
            ]
        ],
        'preview' => 'assets/preview/subscribe.png',
    ],

    // -------------------------------------------------------
    // Hero (главный экран — для справки, хардкод в Blade)
    // -------------------------------------------------------
    'hero' => [
        'single' => [
            'field_name' => [
                'heading'     => 'text',
                'sub_heading' => 'text',
            ],
            'validation' => [
                'heading.*'     => 'required|max:100',
                'sub_heading.*' => 'required|max:300',
            ]
        ],
        'preview' => 'assets/preview/hero.png',
    ],

    // -------------------------------------------------------
    // Служебные поля (не трогать)
    // -------------------------------------------------------
    'message' => [
        'required' => 'This field is required.',
        'min'      => 'This field must be at least :min characters.',
        'max'      => 'This field may not be greater than :max characters.',
        'image'    => 'This field must be image.',
        'mimes'    => 'This image must be a file of type: jpg, jpeg, png.',
    ],

    'content_media' => [
        'image' => 'image',
    ],
];
