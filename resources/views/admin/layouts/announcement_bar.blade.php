@if(config('demo.IS_DEMO'))
<div class="dashboard_announcement_bar"
     style="background-image: url({{ asset('assets/admin/img/announcement_bar.png') }})">
    <div class="container">
        <div class="wrapper py-2">
            <div class="txt">
                @lang("This is a demo website - Buy " .basicControl()->site_title.  " using our official link!")
            </div>
            <a href="{{ config('requirements.item_url') }}"
               class="btn btn-sm purchase-item-btn" target="_blank">@lang("Buy Now")</a>
        </div>
    </div>
</div>
@endif
