<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>{{ $subject ?? 'Уведомление от SolidChange' }}</title>
    <style>
        /* Reset styles */
        body, p, h1, h2, h3, h4, h5, h6, table, td, div {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            box-sizing: border-box;
        }
        body {
            width: 100% !important;
            height: 100% !important;
            background-color: #0b0608 !important;
            color: #ffffff !important;
            -webkit-font-smoothing: antialiased;
            text-align: left;
        }
        a {
            color: #e8c9a0;
            text-decoration: none;
            font-weight: 600;
        }
        a:hover {
            text-decoration: underline;
        }
        .wrapper {
            width: 100%;
            table-layout: fixed;
            background-color: #0b0608;
            padding: 40px 16px;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #120b10;
            border: 1px solid rgba(232, 201, 160, 0.16);
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        }
        /* Header style */
        .header {
            padding: 40px 32px 30px;
            text-align: center;
            background: radial-gradient(circle at center, rgba(232, 201, 160, 0.08) 0%, transparent 70%);
            border-bottom: 1px solid rgba(232, 201, 160, 0.08);
        }
        .logo-img {
            height: 52px;
            display: inline-block;
        }
        /* Body style */
        .body {
            padding: 40px 32px;
            color: rgba(255, 255, 255, 0.85);
            font-size: 16px;
            line-height: 1.6;
        }
        .body p {
            margin-bottom: 20px;
        }
        .body p:last-child {
            margin-bottom: 0;
        }
        /* Button style */
        .btn-container {
            margin: 30px 0;
            text-align: center;
        }
        .btn {
            display: inline-block;
            padding: 14px 36px;
            background: linear-gradient(135deg, #e8c9a0 0%, #c9a227 100%);
            color: #0b0608 !important;
            font-size: 15px;
            font-weight: 700;
            text-decoration: none !important;
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(232, 201, 160, 0.3);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        /* Highlight sections */
        .highlight-box {
            background: rgba(232, 201, 160, 0.04);
            border-left: 3px solid #e8c9a0;
            padding: 16px;
            border-radius: 4px 12px 12px 4px;
            margin: 24px 0;
        }
        /* Divider */
        .divider {
            height: 1px;
            background-color: rgba(232, 201, 160, 0.08);
            margin: 30px 0;
        }
        /* Footer style */
        .footer {
            padding: 32px;
            text-align: center;
            background-color: #0b0608;
            border-top: 1px solid rgba(232, 201, 160, 0.08);
        }
        .footer-text {
            color: rgba(255, 255, 255, 0.45);
            font-size: 13px;
            line-height: 1.5;
            margin-bottom: 16px;
        }
        .footer-social {
            margin-bottom: 20px;
        }
        .social-link {
            display: inline-block;
            margin: 0 10px;
            color: #e8c9a0;
            font-size: 14px;
            font-weight: 600;
        }
        .footer-note {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.25);
            line-height: 1.4;
        }
    </style>
</head>
<body>
    <table class="wrapper" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
            <td align="center">
                <table class="container" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <!-- HEADER -->
                    <tr>
                        <td class="header">
                            <a href="https://solidchange.online" target="_blank">
                                <img src="https://solidchange.online/assets/upload/logo/logo-dark.png" alt="SolidChange" class="logo-img">
                            </a>
                        </td>
                    </tr>
                    
                    <!-- BODY -->
                    <tr>
                        <td class="body">
                            {!! $msg !!}
                        </td>
                    </tr>
                    
                    <!-- FOOTER -->
                    <tr>
                        <td class="footer">
                            <div class="footer-social">
                                <a href="https://t.me/solidchange_news" class="social-link" target="_blank">Telegram Канал</a>
                                <span style="color: rgba(232, 201, 160, 0.2)">•</span>
                                <a href="https://t.me/solidchange_support_bot" class="social-link" target="_blank">Поддержка Bot</a>
                                <span style="color: rgba(232, 201, 160, 0.2)">•</span>
                                <a href="https://solidchange.online" class="social-link" target="_blank">Сайт</a>
                            </div>
                            <p class="footer-text">
                                Вы получили это письмо, потому что зарегистрированы на платформе SolidChange.<br>
                                По всем вопросам пишите на <a href="mailto:support@solidchange.online">support@solidchange.online</a>
                            </p>
                            <p class="footer-note">
                                ВНИМАНИЕ: SolidChange никогда не запрашивает ваши пароли или приватные ключи в письмах. Будьте бдительны и проверяйте адрес отправителя.
                            </p>
                            <div style="margin-top: 16px; font-size: 11px; color: rgba(255,255,255,0.2)">
                                © {{ date('Y') }} SolidChange. Все права защищены.
                            </div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>