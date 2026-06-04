<!-- General JS Scripts -->
<script src="{{ asset('assets/global/js/jquery.min.js') }}"></script>
<script src="{{ asset($themeTrue . "js/bootstrap.bundle.min.js")}}"></script>

<!-- JS Libraies -->
<script src="{{ asset('assets/global/js/pusher.min.js') }}"></script>
<script src="{{ asset('assets/global/js/vue.min.js') }}"></script>
<script src="{{ asset('assets/global/js/axios.min.js') }}"></script>
<script src="{{ asset('assets/global/js/notiflix-aio-3.2.6.min.js') }}"></script>

@stack('js_libs')
<script src="{{ asset($themeTrue . "js/select2.min.js")}}"></script>
<script src="{{ asset($themeTrue . "js/owl.carousel.min.js")}}"></script>
<script src="{{ asset($themeTrue . "js/dashboard.js")}}"></script>




<script>
    'use strict';
    axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
    axios.defaults.headers.common['X-CSRF-TOKEN'] = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

    // for search
    $(document).on('input', '.global-search', function () {
        var search = $(this).val().toLowerCase();

        if (search.length == 0) {
            $('.search-result').find('.content').html('');
            $(this).siblings('.search-backdrop').addClass('d-none');
            $(this).siblings('.search-result').addClass('d-none');
            return false;
        }

        $('.search-result').find('.content').html('');
        $(this).siblings('.search-backdrop').removeClass('d-none');
        $(this).siblings('.search-result').removeClass('d-none');

        var match = $('.sidebar-nav li').filter(function (idx, element) {
            if (!$(element).find('a').hasClass('has-dropdown') && !$(element).hasClass('menu-header'))
                return $(element).text().trim().toLowerCase().indexOf(search) >= 0 ? element : null;
        }).sort();

        if (match.length == 0) {
            $('.search-result').find('.content').append(`<div class="search-item"><a href="javascript:void(0)">@lang('No result found')</a></div>`);
            return false;
        }

        match.each(function (index, element) {
            var item_text = $(element).text().replace(/(\d+)/g, '').trim();
            var item_url = $(element).find('a').attr('href');
            if (item_url != '#') {
                $('.search-result').find('.content').append(`<div class="search-item"><a href="${item_url}">${item_text}</a></div>`);
            }
        });
    });


</script>

@stack('extra_scripts')
