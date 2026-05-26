@extends('admin.layouts.app')
@section('page_title',__('Subscriber List'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <h1 class="page-header-title">@yield('page_title')</h1>
                </div>
            </div>
        </div>
        <div class="card">
            <div class="card-header card-header-content-md-between justify-content-end">
                <a type="button" class="btn btn-info" href="{{ route('admin.subscriber.mail') }}">
                    @lang('Send Email')
                </a>
            </div>

            <!-- Table -->
            <table class="table table-borderless table-thead-bordered">
                <thead class="thead-light">
                <tr>
                    <th scope="col">@lang('Serial No.')</th>
                    <th scope="col">@lang('Subscriber Email')</th>
                    <th scope="col">@lang('Subscriber Join Date')</th>
                    <th scope="col">@lang('Action')</th>
                </tr>
                </thead>
                <tbody>
                @foreach($subscribers as $key => $item)
                    <tr>
                        <td>{{++$key}}</td>
                        <td>{{ $item->email }}</td>
                        <td>{{ dateTime($item->created_at) }}</td>
                        <td>
                            <button
                                class="btn btn-soft-danger btn-sm notiflix-confirm" title="@lang('Delete')"
                                data-bs-toggle="modal" data-bs-target="#delete"
                                data-route="{{route('admin.subscriber.destroy',$item->id)}}">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </td>
                    </tr>
                @endforeach
                </tbody>
            </table>
            <!-- End Table -->
            <div class="card-footer">
                <div class="row justify-content-center justify-content-sm-between align-items-sm-center">
                    {{ $subscribers->appends($_GET)->links($theme.'partials.pagination') }}
                </div>
            </div>
        </div>
    </div>
    <div class="modal fade" id="delete" data-bs-backdrop="static" tabindex="-1" role="dialog"
         aria-labelledby="staticBackdropLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="delete-modal">@lang('Delete Subscriber')</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <p>@lang('Are you sure to delete this?')</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                    <form action="" method="post" class="deleteRoute">
                        @csrf
                        @method('delete')
                        <button type="submit" class="btn btn-soft-danger">@lang('Yes')</button>
                    </form>
                </div>
            </div>
        </div>
    </div>
@endsection
@push('script')
    <script>
        $(document).ready(function () {
            $('.notiflix-confirm').on('click', function () {
                var route = $(this).data('route');
                $('.deleteRoute').attr('action', route)
            })
        });
    </script>
@endpush
