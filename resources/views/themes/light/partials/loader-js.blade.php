<script>
    (function () {
        let defaultTheme = "{{basicControl()->default_mode}}";
        let changeable = "{{basicControl()->changeable_mode}}";
        let storedTheme = localStorage.getItem('dark-theme');

        const isDarkValue = function (value) {
            const normalized = String(value).toLowerCase();
            return normalized === '1' || normalized === 'dark';
        };

        if (changeable != 1) {
            localStorage.setItem('dark-theme', defaultTheme);
            storedTheme = defaultTheme;
        }

        if (storedTheme === null || storedTheme === '') {
            storedTheme = defaultTheme;
        }

        document.documentElement.setAttribute('data-solidus-site-theme', isDarkValue(storedTheme) ? 'dark' : 'light');
    })();

    document.addEventListener('DOMContentLoaded', function () {
        if (typeof setTheme === 'function') {
            setTheme();
        }

        const darkFromBody = document.body && document.body.classList.contains('dark-theme');
        const rawTheme = String(localStorage.getItem('dark-theme')).toLowerCase();
        const darkFromStorage = rawTheme === '1' || rawTheme === 'dark';
        document.documentElement.setAttribute('data-solidus-site-theme', (darkFromBody || darkFromStorage) ? 'dark' : 'light');
    });
</script>
