@extends($theme.'layouts.app')
@section('title')
    {{ 'Pay with '.optional($deposit->gateway)->name ?? '' }}
@endsection
@section('content')
    <section class="calculator-details-section">
        <div class="container">
            <div class="row g-xl-5 g-4">
                <div class="col-lg-12 order-1 order-lg-2">
                    <div class="checkout-section">
                        <div class="checkout-header">
                            <h4 class="mb-0 text-center">{{trans('Please follow the instruction below')}}</h4>
                        </div>
                        <p class="mt-2 ">{{trans('You have requested to deposit')}} <b
                                class="text--base">{{getAmount($deposit->amount)}}
                                {{basicControl()->base_currency}}</b> , {{trans('Please pay')}}
                            <b class="text--base">{{getAmount($deposit->payable_amount)}} {{$deposit->payment_method_currency}}</b> {{trans('for successful payment.')}}
                        </p>
                        <p class="mt-2 ">
                            <?php echo optional($deposit->gateway)->note; ?>
                        </p>

                        <form action="{{route('addFund.fromSubmit',$deposit->trx_id)}}" method="post"
                              enctype="multipart/form-data"
                              class="form-row  preview-form">
                            @csrf
                            @if(optional($deposit->gateway)->parameters)
                                @foreach($deposit->gateway->parameters as $k => $v)
                                    @if($v->type == "text")
                                        <div class="col-md-12 mt-2">
                                            <div class="form-group  ">
                                                <label>{{trans($v->field_label)}} @if($v->validation == 'required')
                                                        <span class="text--danger">*</span>
                                                    @endif </label>
                                                <input type="text" name="{{$k}}"
                                                       class="form-control bg-transparent"
                                                       @if($v->validation == "required") required @endif>
                                                @if ($errors->has($k))
                                                    <span
                                                        class="text-danger">{{ trans($errors->first($k)) }}</span>
                                                @endif
                                            </div>
                                        </div>
                                    @elseif($v->type == "number")
                                        <div class="col-md-12 mt-2">
                                            <div class="form-group  ">
                                                <label>{{trans($v->field_label)}} @if($v->validation == 'required')
                                                        <span class="text--danger">*</span>
                                                    @endif </label>
                                                <input type="text" name="{{$k}}"
                                                       class="form-control bg-transparent"
                                                       @if($v->validation == "required") required @endif>
                                                @if ($errors->has($k))
                                                    <span
                                                        class="text-danger">{{ trans($errors->first($k)) }}</span>
                                                @endif
                                            </div>
                                        </div>
                                    @elseif($v->type == "textarea")
                                        <div class="col-md-12 mt-2">
                                            <div class="form-group">
                                                <label>{{trans($v->field_label)}} @if($v->validation == 'required')
                                                        <span class="text--danger">*</span>
                                                    @endif </label>
                                                <textarea name="{{$k}}" class="form-control bg-transparent"
                                                          rows="3"
                                                          @if($v->validation == "required") required @endif></textarea>
                                                @if ($errors->has($k))
                                                    <span
                                                        class="text-danger">{{ trans($errors->first($k)) }}</span>
                                                @endif
                                            </div>
                                        </div>
                                    @elseif($v->type == "file")
                                        <div class="col-md-6 form-group mt-2">
                                            <label>{{trans($v->field_label)}} @if($v->validation == 'required')
                                                    <span class="text--danger">*</span>
                                                @endif </label>
                                            <div class="image-input fileinput fileinput-new">
                                                <div
                                                    class="fileinput-new thumbnail withdraw-thumbnail fileinput-preview wh-200-150">
                                                    <div class="file-upload-top">
                                                        <label for="image-upload" id="image-label">
                                                            <i class="fa-regular fa-upload"></i>
                                                        </label>

                                                        <input type="file" name="{{$k}}" id="image" accept="image/*"
                                                               @if($v->validation == "required") required @endif>
                                                    </div>
                                                    <img class="w-100 preview-image" id="image_preview_container"
                                                         src="{{getFile(config('filelocation.default'))}}"
                                                         alt="@lang('Upload Image')">
                                                </div>
                                            </div>
                                            @error($k)
                                            <span class="text-danger">@lang($message)</span>
                                            @enderror
                                        </div>
                                    @endif
                                @endforeach
                            @endif
                            <div class="col-md-12 ">
                                <div class=" form-group">
                                    <button type="submit" class="btn cmn-btn w-100 mt-3">
                                        <span>@lang('Confirm Now')</span>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection

@push('extra_scripts')
    <script>
        'use strict'
        $(document).ready(function () {
            $('#image').change(function () {
                let reader = new FileReader();
                reader.onload = (e) => {
                    $('#image_preview_container').attr('src', e.target.result);
                }
                reader.readAsDataURL(this.files[0]);
            });
        })
    </script>
@endpush
