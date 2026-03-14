@extends($theme . 'layouts.app')
@section('title',trans('Blog Details'))
@section('content')
    <!-- Blog details section start -->
    <section class="blog-details-section">
        <div class="container">
            <div class="row gy-5 g-sm-g">
                <div class="col-lg-7 order-2 order-lg-1">
                    <div class="blog-box-large">
                        <div class="thumbs-area">
                            <img
                                src="{{getFile(@$blogDetails->content->media->image->driver,@$blogDetails->content->media->image->path)}}"
                                alt="...">
                            <div class="blog-date">
                                <h5>{{\Illuminate\Support\Carbon::parse($blogDetails->created_at)->format('M')}}</h5>
                                <p>{{\Illuminate\Support\Carbon::parse($blogDetails->created_at)->format('d')}}</p>
                            </div>
                        </div>
                        <div class="content-area">
                            <h3 class="blog-title">
                                @lang(@$blogDetails->description->title)
                            </h3>

                            <div class="para-text">
                                @lang(@$blogDetails->description->description)
                            </div>

                        </div>
                    </div>
                </div>
                <div class="col-lg-5 order-1 order-lg-2">
                    <div class="blog-sidebar">
                        <form action="{{route('blog.details')}}" method="get">
                            <input type="hidden" name="id" value="{{$blogDetails->id}}">
                            <input type="hidden" name="slug" value="{{slug($blogDetails->title)}}">
                            <div class="sidebar-widget-area">
                                <div class="search-box">
                                    <input type="text" class="form-control" name="title" value="{{@request()->title}}" placeholder="Search here...">
                                    <button type="submit" class="search-btn"><i class="far fa-search"></i></button>
                                </div>
                            </div>
                        </form>
                        @if (isset($popularContentDetails['blog']))
                            <div class="sidebar-widget-area">
                                <div class="widget-title">
                                    <h4>@lang('Recent Post')</h4>
                                </div>
                                @foreach ($popularContentDetails['blog']->sortDesc() as $data)
                                    <a href="{{route('blog.details').'?id='.$data->id.'&slug='.slug($data->description->title)}}"
                                       class="sidebar-widget-item">
                                        <div class="image-area">
                                            <img
                                                src="{{getFile(@$data->content->media->image->driver,@$data->content->media->image->path)}}"
                                                alt="...">
                                        </div>
                                        <div class="content-area">
                                            <div class="title">@lang($data->description->title)</div>
                                            <div class="widget-date">
                                                <i class="fa-regular fa-calendar-days"></i> {{dateTime($data->created_at,basicControl()->date_time_format)}}
                                            </div>
                                        </div>
                                    </a>
                                @endforeach
                            </div>
                        @endif
                    </div>
                </div>
            </div>
        </div>
    </section>
    <!-- Blog details Section End -->
@endsection
