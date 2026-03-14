<!-- Footer Section start -->
<section class="footer-section pb-50">
    <div class="footer-inner-section">
        <div class="container">
            <div class="row g-4 g-sm-5">
                <div class="col-lg-4 col-sm-6">
                    <div class="footer-widget">
                        <div class="widget-logo mb-30">
                            <a href="{{route('page')}}"><img class="logo"
                                                             src="{{getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo)}}"
                                                             alt="..."></a>
                        </div>
                        @if(isset($extraInfo['contact'][0]->description))
                            <p>
                                {!! @$extraInfo['contact'][0]->description->footer_message !!}
                            </p>
                        @endif

                        @if(isset($extraInfo['social']) && count($extraInfo['social']) > 0)
                            <div class="social-area mt-50">
                                <ul class="d-flex">
                                    @foreach($extraInfo['social'] as $social)
                                        <li><a href="{{@$social->content->media->my_link}}"><i
                                                    class="{{@$social->content->media->icon}}"></i></a></li>
                                    @endforeach
                                </ul>
                            </div>
                        @endif
                    </div>
                </div>
                <div class="col-lg-2 col-sm-6">
                    <div class="footer-widget">
                        <h5 class="widget-title">@lang('Useful Links')</h5>
                        <ul>
                            @if(getFooterMenuData('useful_link') != null)
                                @foreach(getFooterMenuData('useful_link') as $list)
                                    {!! $list !!}
                                @endforeach
                            @endif
                            <li><a class="widget-link" href="{{route('tracking')}}">@lang('Tracking')</a></li>
                        </ul>
                    </div>
                </div>
                <div class="col-lg-3 col-sm-6 pt-sm-0 pt-3 ps-lg-5">
                    <div class="footer-widget">
                        <h5 class="widget-title">@lang('Support Links')</h5>
                        <ul>
                            @if(getFooterMenuData('support_link') != null)
                                @foreach(getFooterMenuData('support_link') as $list)
                                    {!! $list !!}
                                @endforeach
                            @endif
                        </ul>
                    </div>
                </div>
                @if(isset($extraInfo['contact'][0]->description))
                    <div class="col-lg-3 col-sm-6 pt-sm-0 pt-3">
                        <div class="footer-widget">
                            <h5 class="widget-title">@lang('Contact Us')</h5>
                            <p class="contact-item"><i
                                    class="fa-regular fa-location-dot"></i> {{@$extraInfo['contact'][0]->description->address}}
                            </p>
                            <p class="contact-item"><i
                                    class="fa-regular fa-envelope"></i> {{@$extraInfo['contact'][0]->description->email}}
                            </p>
                            <p class="contact-item"><i
                                    class="fa-regular fa-phone"></i> {{@$extraInfo['contact'][0]->description->phone}}
                            </p>
                        </div>
                    </div>
                @endif
            </div>
            <hr class="cmn-hr">
            <!-- Copyright-area-start -->
            <div class="copyright-area">
                <div class="row gy-4">
                    <div class="col-sm-6">
                        <p>@lang('Copyright') ©{{date('Y')}} <a
                                                                href="javascript:void(0)">@lang(basicControl()->site_title)</a> @lang('All Rights Reserved')
                        </p>
                    </div>
                    @if(isset($languages))
                        <div class="col-sm-6">
                            <div class="language">
                                @foreach($languages as $item)
                                    <a href="{{route('language',$item->short_name)}}"
                                       class="language">@lang($item->name)</a>
                                @endforeach
                            </div>
                        </div>
                    @endif
                </div>
            </div>
            <!-- Copyright-area-end -->
        </div>
    </div>

</section>
<!-- Footer Section end -->
