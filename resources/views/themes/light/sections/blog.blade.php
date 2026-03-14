<!-- Blog Section start -->
@if(isset($blog))
    <section class="blog-section">
        <div class="container">
            @if(isset($blog['single']))
                <div class="row">
                    <div class="col-12">
                        <div class="section-header text-center mb-50">
                            <h2 class="section-title mx-auto">@lang(@$blog['single']['title'])</h2>
                            <p class="cmn-para-text mx-auto">@lang(@$blog['single']['sub_title'])</p>
                        </div>
                    </div>
                </div>
            @endif
            @if(isset($blog['multiple']) && count($blog['multiple']) > 0)
                @php
                    $firstIteration = true;
                    $loopNum = 0;
                    $currentUrl = url()->current();
                    $lastSegment = last(explode('/', $currentUrl));
                @endphp
                <div class="row g-4 g-sm-5">
                    <div class="col-lg-5 order-2 order-lg-1">
                        <div class="row g-4 g-sm-5">
                            @foreach($blog['multiple']->reverse() as $key => $value)
                                @if($firstIteration)
                                    @php $firstIteration = false @endphp
                                    @continue
                                @endif
                                @if($lastSegment != 'blog' && $loopNum >= 3)
                                    @break;
                                @endif
                                <div class="col-12">
                                    <div class="blog-box">
                                        <div class="thumbs-area">
                                            <img
                                                src="{{getFile($value['media']->image->driver,$value['media']->image->path)}}"
                                                alt="...">
                                            <div class="blog-date">
                                                <h5>{{date('d',strtotime($value['created_at']))}}</h5>
                                                <p>{{ \Carbon\Carbon::parse($value['created_at'])->locale(app()->getLocale())->translatedFormat('M') }}</p>
                                            </div>
                                        </div>
                                        <div class="content-area">
                                            <h4 class="blog-title"><a
                                                    href="{{route('blog.details').'?id='.$value['id'].'&slug='.slug($value['title'])}}">{{$value['title']}}</a>
                                            </h4>
                                            <p class="description">@lang(Str::limit(strip_tags($value['description']),115))</p>

                                            <a href="{{route('blog.details').'?id='.$value['id'].'&slug='.slug($value['title'])}}"
                                               class="blog-btn link">@lang('Read more')<i
                                                    class="fa-light fa-arrow-up-right"></i></a>
                                        </div>
                                    </div>
                                </div>
                                @php
                                    $loopNum++
                                @endphp
                            @endforeach
                        </div>
                    </div>
                    @php
                        $recentBlog = $blog['multiple']->last();
                    @endphp
                    @if($recentBlog)
                        <div class="col-lg-7 order-1 order-lg-2">
                            <div class="blog-box-large">
                                <div class="thumbs-area">
                                    <img
                                        src="{{getFile($recentBlog['media']->image->driver,$recentBlog['media']->image->path)}}"
                                        alt="...">
                                    <div class="blog-date">
                                        <h5>{{date('d',strtotime($recentBlog['created_at']))}}</h5>
                                        <p>{{ \Carbon\Carbon::parse($recentBlog['created_at'])->locale(app()->getLocale())->translatedFormat('M') }}</p>
                                    </div>
                                </div>
                                <div class="content-area">
                                    <h4 class="blog-title"><a
                                            href="{{route('blog.details').'?id='.$recentBlog['id'].'&slug='.slug($recentBlog['title'])}}">@lang($recentBlog['title'])</a>
                                    </h4>

                                    <p class="description">@lang(Str::limit(strip_tags($recentBlog['description']),115))</p>

                                    <a href="{{route('blog.details').'?id='.$recentBlog['id'].'&slug='.slug($recentBlog['title'])}}"
                                       class="blog-btn link">@lang('Read more')<i
                                            class="fa-regular fa-arrow-up-right"></i></a>
                                </div>
                            </div>
                        </div>
                    @endif
                </div>
            @endif
        </div>
        <div class="shape shape3">
            <img src="{{$themeTrue.'img/coin/coin-3.png'}}" alt="...">
        </div>
    </section>
@endif
<!-- Blog Section end -->
