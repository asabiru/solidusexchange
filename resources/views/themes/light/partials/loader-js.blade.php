<script>
    (function () {
        let defaultTheme = "{{ basicControl()->default_mode ?? 'dark' }}";
        let changeable = "{{ basicControl()->changeable_mode ?? 0 }}";
        let storedTheme = localStorage.getItem('dark-theme');

        const isDarkValue = function (value) {
            const normalized = String(value).toLowerCase();
            return normalized === '1' || normalized === 'dark';
        };

        const resolveTheme = function () {
            if (changeable != 1) {
                localStorage.setItem('dark-theme', defaultTheme);
                storedTheme = defaultTheme;
            }

            if (storedTheme === null || storedTheme === '') {
                storedTheme = defaultTheme;
            }

            return isDarkValue(storedTheme) ? 'dark' : 'light';
        };

        const applyThemeClass = function (theme) {
            if (!document.body) {
                return;
            }

            document.body.classList.toggle('dark-theme', theme === 'dark');
        };

        document.documentElement.setAttribute('data-solidus-site-theme', resolveTheme());

        document.addEventListener('DOMContentLoaded', function () {
            if (typeof setTheme === 'function') {
                setTheme();
            } else {
                applyThemeClass(resolveTheme());
            }
        });

        const hideLoader = function () {
            const loader = document.querySelector('.loader-wrap');
            if (!loader || loader.dataset.hidden === '1') {
                return;
            }

            loader.dataset.hidden = '1';
            loader.classList.add('loaded');

            window.setTimeout(function () {
                loader.style.display = 'none';
            }, 400);
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
