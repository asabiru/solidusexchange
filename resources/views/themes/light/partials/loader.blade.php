<!-- Preloader -->
<div class="loader-wrap">
    <div class="preloader" id="handle-preloader">
        <button class="preloader-close" onclick="document.querySelector('.loader-wrap').style.display='none'">&#x2715;</button>
        <div class="sc-preloader-inner">
            <div class="sc-preloader-logo">
                <div class="sc-badge">SC</div>
                <span class="sc-wordmark">SolidChange</span>
            </div>
            <div class="sc-preloader-bar">
                <div class="sc-preloader-progress"></div>
            </div>
        </div>
    </div>
</div>

<style>
    .loader-wrap {
        position: fixed;
        inset: 0;
        z-index: 9999999;
        background: #0b0608;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.4s ease;
    }

    .loader-wrap.loaded {
        opacity: 0;
        pointer-events: none;
    }

    .preloader {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
    }

    .preloader-close {
        position: absolute;
        top: 24px;
        right: 24px;
        background: rgba(232,201,160,0.1);
        border: 1px solid rgba(232,201,160,0.2);
        color: #e8c9a0;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
    }

    .preloader-close:hover {
        background: rgba(232,201,160,0.2);
    }

    .sc-preloader-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 40px;
        animation: scFadeIn 0.6s ease both;
    }

    @keyframes scFadeIn {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    .sc-preloader-logo {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    .sc-badge {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2px solid rgba(232,201,160,0.5);
        background: rgba(232,201,160,0.08);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 800;
        color: #e8c9a0;
        letter-spacing: 0.04em;
        animation: scPulse 2s ease-in-out infinite;
    }

    @keyframes scPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(232,201,160,0.3); }
        50%       { box-shadow: 0 0 0 10px rgba(232,201,160,0); }
    }

    .sc-wordmark {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #e8c9a0;
        font-family: "Inter", system-ui, sans-serif;
    }

    .sc-preloader-bar {
        width: 180px;
        height: 2px;
        background: rgba(232,201,160,0.12);
        border-radius: 999px;
        overflow: hidden;
    }

    .sc-preloader-progress {
        height: 100%;
        background: linear-gradient(90deg, #c9a227, #e8c9a0);
        border-radius: 999px;
        animation: scProgress 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    @keyframes scProgress {
        0%   { width: 0%; }
        60%  { width: 75%; }
        100% { width: 100%; }
    }
</style>
<!-- Preloader end -->
