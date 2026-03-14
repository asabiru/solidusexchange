<?php
return [
    'hero' => [
        'single' => [
            'field_name' => [
                'heading' => 'text',
                'sub_heading' => 'text',
                'button_name' => 'text',
                'my_link' => 'url',
                'video_button_name' => 'text',
                'video_link' => 'url',
            ],
            'validation' => [
                'heading.*' => 'required|max:100',
                'sub_heading.*' => 'required|max:300',
                'button_name.*' => 'required|max:100',
                'my_link.*' => 'required|url',
                'video_button_name.*' => 'required|max:100',
                'video_link.*' => 'required|url',
            ]
        ],
        'preview' => 'assets/preview/hero.png',
    ],
    'about' => [
        'single' => [
            'field_name' => [
                'title' => 'text',
                'description' => 'textarea',
                'button_name' => 'text',
                'my_link' => 'url',
                'image' => 'file',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'description.*' => 'required|max:10000',
                'button_name.*' => 'required|max:100',
                'my_link.*' => 'required|url',
                'image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'preview' => 'assets/preview/about.png',
    ],

    'feature' => [
        'single' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
                'image' => 'file',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
                'image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'multiple' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
                'icon' => 'text',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
                'icon.*' => 'required|max:50',
            ]
        ],
        'preview' => 'assets/preview/feature.png',
    ],

    'how_it_work' => [
        'single' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
                'image' => 'file',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
                'image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'multiple' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
            ]
        ],
        'preview' => 'assets/preview/how_it_work.png',
    ],

    'why_choose_us' => [
        'single' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
                'image' => 'file',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
                'image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'multiple' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
                'icon' => 'text',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
                'icon.*' => 'required|max:50',
            ]
        ],
        'preview' => 'assets/preview/why_choose_us.png',
    ],

    'faq' => [
        'single' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
                'image' => 'file',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
                'image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'multiple' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
            ]
        ],
        'preview' => 'assets/preview/faq.png',
    ],

    'testimonial' => [
        'single' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:3000',
            ]
        ],
        'multiple' => [
            'field_name' => [
                'name' => 'text',
                'address' => 'text',
                'star' => 'text',
                'description' => 'textarea',
                'image' => 'file',
            ],
            'validation' => [
                'name.*' => 'required|max:100',
                'address.*' => 'required|max:3000',
                'star.*' => 'required|numeric|min:1|max:5',
                'description.*' => 'required|max:10000',
                'image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'preview' => 'assets/preview/testimonial.png',
    ],

    'blog' => [
        'single' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'text',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:10000',
            ]
        ],
        'multiple' => [
            'field_name' => [
                'title' => 'text',
                'description' => 'textarea',
                'image' => 'file',
            ],
            'validation' => [
                'title.*' => 'required|max:1000',
                'description.*' => 'required|max:50000',
                'image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'preview' => 'assets/preview/blog.png',
    ],

    'subscribe' => [
        'single' => [
            'field_name' => [
                'title' => 'text',
                'sub_title' => 'textarea',
                'image' => 'file',
            ],
            'validation' => [
                'title.*' => 'required|max:300',
                'sub_title.*' => 'required|max:1000',
                'image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'preview' => 'assets/preview/subscribe.png',
    ],

    'contact' => [
        'single' => [
            'field_name' => [
                'my_link' => 'url',
                'phone' => 'text',
                'email' => 'text',
                'address' => 'text',
                'contact_message' => 'textarea',
                'drop_line_message' => 'textarea',
                'footer_message' => 'textarea',
            ],
            'validation' => [
                'my_link.*' => 'required|url',
                'phone.*' => 'required|max:20',
                'email.*' => 'required|email',
                'address.*' => 'required|max:2000',
                'contact_message.*' => 'required|max:5000',
                'drop_line_message.*' => 'required|max:5000',
                'footer_message.*' => 'required|max:5000',
                'subscriber_message.*' => 'required|max:5000',
            ]
        ],
        'preview' => 'assets/preview/contact.png',
    ],

    'login-register' => [
        'single' => [
            'field_name' => [
                'login_heading' => 'text',
                'login_sub_heading' => 'text',
                'register_heading' => 'text',
                'register_sub_heading' => 'text',
                'login_page_image' => 'file',
                'register_page_image' => 'file',
                'verify_page_image' => 'file',
            ],
            'validation' => [
                'login_heading.*' => 'required|max:500',
                'login_sub_heading.*' => 'required|max:500',
                'register_heading.*' => 'required|max:500',
                'register_sub_heading.*' => 'required|max:500',
                'login_page_image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
                'register_page_image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
                'verify_page_image.*' => 'nullable|max:10240|image|mimes:jpg,jpeg,png',
            ]
        ],
        'preview' => 'assets/preview/login-register.png',
    ],

    'social' => [
        'multiple' => [
            'field_name' => [
                'name' => 'text',
                'icon' => 'text',
                'my_link' => 'url',
            ],
            'validation' => [
                'name.*' => 'required|max:100',
                'icon.*' => 'required|max:100',
                'my_link.*' => 'required|url',
            ]
        ],
        'preview' => 'assets/preview/social.png',
    ],

    'message' => [
        'required' => 'This field is required.',
        'min' => 'This field must be at least :min characters.',
        'max' => 'This field may not be greater than :max characters.',
        'image' => 'This field must be image.',
        'mimes' => 'This image must be a file of type: jpg, jpeg, png.',
        'integer' => 'This field must be an integer value',
    ],

    'content_media' => [
        'image' => 'file',
        'thumb_image' => 'file',
        'login_page_image' => 'file',
        'register_page_image' => 'file',
        'verify_page_image' => 'file',
        'my_link' => 'url',
        'video_link' => 'url',
        'icon' => 'icon',
        'count_number' => 'number',
        'start_date' => 'date'
    ]
];

