<style>
    body {
        background: #090507;
    }

    .auth-clean-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 16px;
        background:
            radial-gradient(circle at 18% 12%, rgba(232, 201, 160, 0.16), transparent 28%),
            radial-gradient(circle at 82% 20%, rgba(150, 102, 50, 0.14), transparent 30%),
            linear-gradient(135deg, #090507 0%, #160d10 52%, #080406 100%);
        color: #fff6e8;
    }

    .auth-clean-card {
        width: min(100%, 520px);
        border: 1px solid rgba(232, 201, 160, 0.18);
        border-radius: 28px;
        padding: 34px;
        background: rgba(14, 8, 10, 0.92);
        box-shadow: 0 28px 90px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(16px);
    }

    .auth-clean-card--wide {
        width: min(100%, 560px);
    }

    .auth-clean-back,
    .auth-link,
    .auth-switch a {
        color: #e8c9a0;
        text-decoration: none;
    }

    .auth-clean-back {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 28px;
        font-weight: 600;
        font-size: 14px;
    }

    .auth-clean-brand {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 30px;
    }

    .auth-clean-logo {
        width: 58px;
        height: 58px;
        border-radius: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #1b0f0b;
        background: linear-gradient(135deg, #f5d6a6, #b37a43);
        box-shadow: 0 14px 34px rgba(232, 201, 160, 0.22);
        font-weight: 800;
        font-size: 22px;
        letter-spacing: -0.04em;
    }

    .auth-clean-brand strong {
        display: block;
        font-size: 19px;
        color: #fff3e0;
    }

    .auth-clean-brand small,
    .auth-clean-header p,
    .auth-switch,
    .auth-check {
        color: rgba(255, 246, 232, 0.68);
    }

    .auth-clean-kicker {
        display: inline-flex;
        align-items: center;
        border: 1px solid rgba(232, 201, 160, 0.18);
        border-radius: 999px;
        padding: 7px 12px;
        margin-bottom: 14px;
        color: #e8c9a0;
        background: rgba(232, 201, 160, 0.07);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .auth-clean-header h1 {
        margin: 0 0 10px;
        color: #fff8ec;
        font-size: clamp(30px, 5vw, 42px);
        line-height: 1.05;
        font-weight: 800;
    }

    .auth-clean-header p {
        margin: 0 0 26px;
    }

    .auth-clean-form {
        display: grid;
        gap: 16px;
    }

    .auth-field label {
        display: block;
        margin-bottom: 8px;
        color: rgba(255, 246, 232, 0.76);
        font-size: 13px;
        font-weight: 600;
    }

    .auth-clean-form .form-control {
        height: 52px;
        border: 1px solid rgba(232, 201, 160, 0.2);
        border-radius: 15px;
        padding: 0 16px;
        color: #fff8ec;
        background: rgba(255, 255, 255, 0.035);
        box-shadow: none;
    }

    .auth-clean-form .form-control::placeholder {
        color: rgba(255, 246, 232, 0.36);
    }

    .auth-clean-form .form-control:focus {
        border-color: #e8c9a0;
        background: rgba(232, 201, 160, 0.08);
    }

    .auth-password-box {
        position: relative;
    }

    .auth-password-box .password-icon {
        position: absolute;
        right: 16px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(255, 246, 232, 0.72);
        cursor: pointer;
    }

    .auth-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
        font-size: 14px;
    }

    .auth-check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 0;
    }

    .auth-check input {
        accent-color: #e8c9a0;
    }

    .auth-primary-btn,
    .auth-telegram-btn {
        min-height: 54px;
        border: 0;
        border-radius: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        font-weight: 800;
    }

    .auth-primary-btn {
        margin-top: 6px;
        color: #1c120b !important;
        background: linear-gradient(135deg, #f2d1a0, #b98245) !important;
        box-shadow: 0 18px 40px rgba(183, 123, 65, 0.25);
    }

    .auth-telegram-btn {
        color: #f8efe3;
        border: 1px solid rgba(232, 201, 160, 0.22);
        background: rgba(232, 201, 160, 0.08);
        text-decoration: none;
    }

    .auth-telegram-btn i {
        color: #e8c9a0;
        font-size: 18px;
    }

    .auth-divider {
        display: flex;
        align-items: center;
        gap: 12px;
        color: rgba(255, 246, 232, 0.5);
        font-size: 13px;
    }

    .auth-divider:before,
    .auth-divider:after {
        content: '';
        flex: 1;
        height: 1px;
        background: rgba(232, 201, 160, 0.14);
    }

    .auth-switch {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex-wrap: wrap;
        padding-top: 8px;
    }

    .auth-captcha {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px;
        border: 1px solid rgba(232, 201, 160, 0.14);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.03);
    }

    .auth-captcha a {
        color: #e8c9a0;
    }

    .text-danger {
        display: block;
        margin-top: 7px;
        font-size: 13px;
    }

    @media (max-width: 575px) {
        .auth-clean-page {
            align-items: flex-start;
            padding: 18px 12px;
        }

        .auth-clean-card {
            border-radius: 22px;
            padding: 24px 18px;
        }
    }
</style>
