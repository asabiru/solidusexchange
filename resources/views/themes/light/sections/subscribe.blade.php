<!-- Newsletter section start -->
@if(isset($subscribe))
    <section class="newsletter-section">
        <div class="container">
            <div class="row g-4 align-items-center justify-content-center">
                <div class="col-xl-7 col-lg-8">
                    <div class="content-area">
                        @if(isset($subscribe['single']))
                            <h3 class="subscribe-normal-text">@lang(@$subscribe['single']['title'])</h3>
                            <p class="subscribe-small-text">@lang(@$subscribe['single']['sub_title'])</p>
                        @endif
                        <form action="{{ route('subscribe') }}" method="post" class="newsletter-form">
                            @csrf
                            <input type="email" name="email" value="{{old('email')}}" class="form-control" placeholder="@lang('Your email')"/>
                            <button type="submit" class="subscribe-btn">@lang('Subscribe')</button>
                        </form>
                        @error('email')
                        <span class="text-danger">{{$message}}</span>
                        @enderror
                    </div>
                </div>
            </div>
        </div>
    </section>
@endif
<!-- Newsletter section end -->
