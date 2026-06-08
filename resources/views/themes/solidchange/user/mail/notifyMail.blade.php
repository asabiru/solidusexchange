@extends('layouts.mail')

@section('title', $emailMessage ?? 'Уведомление SolidChange')

@section('content')
    <div style="padding: 24px 0; color: rgba(255,255,255,0.85); font-size: 16px; line-height: 1.6;">
        <h2 style="color: #e8c9a0; font-size: 20px; margin-bottom: 20px; font-weight: 600;">
            {{ $emailMessage }}
        </h2>

        <p style="margin-bottom: 16px;">
            Действие было инициировано пользователем <strong style="color: #e8c9a0;">{{ $emailAddress }}</strong> {{ $date }}.
        </p>

        @if($url)
            <div class="btn-container" style="margin: 30px 0; text-align: center;">
                <a href="{{ $url }}" class="btn" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #e8c9a0 0%, #c9a227 100%); color: #0b0608; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 12px; box-shadow: 0 4px 15px rgba(232, 201, 160, 0.3); text-transform: uppercase; letter-spacing: 0.05em;">
                    {{ $urlName ?? 'Перейти' }}
                </a>
            </div>
        @endif
    </div>
@endsection
