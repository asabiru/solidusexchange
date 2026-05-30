@extends('layouts.mail')

@section('title', 'Тестовое письмо — SolidChange')

@section('content')
    <div style="padding: 24px 0; color: rgba(255,255,255,0.85); font-size: 16px; line-height: 1.6;">
        <h2 style="color: #e8c9a0; font-size: 20px; margin-bottom: 20px; font-weight: 600;">
            Тестовое письмо
        </h2>
        <p style="margin-bottom: 16px;">
            {{ $msg ?? 'Это тестовое сообщение для проверки работы почтовой системы SolidChange.' }}
        </p>
        <p style="margin-bottom: 16px;">
            Если вы получили это письмо, значит настройки SMTP / Mailgun работают корректно.
        </p>
    </div>
@endsection
