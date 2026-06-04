<script>
    (function () {
        // Always dark theme — no switching
        localStorage.setItem('dark-theme', '1');

        document.documentElement.setAttribute('data-solidus-site-theme', 'dark');

        document.addEventListener('DOMContentLoaded', function () {
            if (document.body) {
                document.body.classList.add('dark-theme');
            }
            if (typeof setTheme === 'function') {
                setTheme();
            }
        });

        var hideLoader = function () {
            var loader = document.querySelector('.loader-wrap');
            if (!loader || loader.dataset.hidden === '1') return;
            loader.dataset.hidden = '1';
            loader.classList.add('loaded');
            window.setTimeout(function () { loader.style.display = 'none'; }, 400);
        };

        window.addEventListener('load', hideLoader, { once: true });
        document.addEventListener('DOMContentLoaded', function () {
            window.setTimeout(hideLoader, 1200);
        }, { once: true });
        window.setTimeout(hideLoader, 3000);
    })();
</script>
<noscript>
    <style>
        .loader-wrap {
            display: none !important;
        }
    </style>
</noscript>
