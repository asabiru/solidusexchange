@extends($theme.'layouts.user')
@section('page_title',__('New Ticket'))

@section('content')
    <div class="section dashboard">
        <div class="row">
            <div class="account-settings-profile-section">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title">@lang('New Ticket')
                        </h5>
                    </div>
                    <div class="card-body pt-0">
                        <div class="profile-form-section">
                            <div class="row g-3">
                                <form action="{{route('user.ticket.store')}}" method="post"
                                      enctype="multipart/form-data">
                                    @csrf
                                    <div class="col-md-12">
                                        <label for="subject" class="form-label">@lang('Subject')</label>
                                        <input type="text" name="subject" placeholder="@lang('Subject')"
                                               value="{{ old('subject') }}"
                                               class="form-control @error('subject') is-invalid @enderror">
                                        <div class="invalid-feedback">
                                            @error('subject') @lang($message) @enderror
                                        </div>
                                    </div>
                                    <div class="col-md-12 mt-4">
                                        <label for="message" class="form-label">@lang('Message')</label>
                                        <textarea name="message" rows="5"
                                                  class="form-control @error('note') is-invalid @enderror">{{ old('message') }}</textarea>
                                        <div class="invalid-feedback">
                                            @error('message') @lang($message) @enderror
                                        </div>
                                    </div>
                                    <div class="col-md-12 mt-4">
                                        <div class="image-area">
                                            <img
                                                src="{{getFile('local','dummy')}}"
                                                alt="..." class="width-200 img-profile-view">
                                        </div>
                                        <div class="btn-area">
                                            <div class="btn-area-inner d-flex">
                                                <div class="cmn-file-input">
                                                    <label for="formFile" class="form-label cmn-btn">@lang('Upload New
													Photo')</label>
                                                    <input class="form-control file-upload-input" name="attachments[]"
                                                           type="file" id="formFile" multiple>
                                                </div>
                                                <button type="button" class="cmn-btn3 reset">@lang('reset')</button>
                                            </div>
                                        </div>
                                        <p class="text-danger select-files-count"></p>
                                        @error('attachments')
                                        <div class="error text-danger"> @lang($message) </div>
                                        @enderror
                                    </div>
                                    <button type="submit" class="cmn-btn mt-3">
                                        @lang('Submit Ticket')
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

@endsection
@push('extra_scripts')
    <script>
        'use strict';
        $(document).on('change', '.file-upload-input', function () {
            let _this = $(this);
            let reader = new FileReader();
            reader.readAsDataURL(this.files[0]);
            reader.onload = function (e) {
                $('.img-profile-view').attr('src', e.target.result);
            }
            var fileCount = $(this)[0].files.length;
            $('.select-files-count').text(fileCount + ' file(s) selected');
        });
        $(document).on('click', '.reset', function () {
            let img = "{{asset(config('location.default'))}}"
            $('.img-profile-view').attr('src', img);
            $('.select-files-count').text("");
        });
    </script>
@endpush
