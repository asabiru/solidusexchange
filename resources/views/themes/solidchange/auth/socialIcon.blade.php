@if(isset($template['social']) && count($template['social']) > 0)
    <div class="bottom-content">
        <div class="social-area mt-50">
            <ul class="d-flex">
                @foreach($template['social'] as $social)
                    <li><a href="{{@$social->content->media->my_link}}"><i
                                class="{{@$social->content->media->icon}}"></i></a></li>
                @endforeach
            </ul>
        </div>
    </div>
@endif
