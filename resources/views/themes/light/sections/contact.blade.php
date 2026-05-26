@if(isset($contact['single']))
    <!-- Map section start -->
    <div class="map-section">
        <iframe class="shadow-none p-0"
                src="{{$contact['single']['media']->my_link}}"
                allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
    </div>
    <!-- Map section end -->

    <!-- Contact section start -->
    <section class="contact-section">
        <div class="container">
            <div class="contact-inner">
                <div class="row">
                    <div class="col-xl-4 col-lg-6">
                        <div class="contact-area">
                            <div class="section-header mb-0">
                                <h3>@lang('Contact Information')</h3>
                            </div>
                            <p class="para_text">@lang($contact['single']['contact_message'])</p>
                            <h5 class="mt-30 mb-0">@lang('Phone:')</h5>
                            <p>@lang($contact['single']['phone'])</p>
                            <h5 class="mt-30 mb-0">@lang('Email:')</h5>
                            <p>@lang($contact['single']['email'])</p>
                            <h5 class="mt-30 mb-0">@lang('Address:')</h5>
                            <p>@lang($contact['single']['address'])</p>
                        </div>
                    </div>
                    <div class="col-xl-8 col-lg-6">
                        <div class="contact-message-area">
                            <div class="contact-header">
                                <h3 class="section-title">@lang('Drop Us a Line')</h3>
                                <p class="cmn-para-text">@lang($contact['single']['drop_line_message'])</p>
                            </div>
                            <form action="{{route('contact.send')}}" method="post">
                                @csrf
                                <div class="row">
                                    <div class="mb-3 col-md-6">
                                        <input type="text" name="name" value="{{old('name')}}" class="form-control"
                                               placeholder="@lang('Your Name')" required>
                                        @error('name')
                                        <span class="text-danger">{{$message}}</span>
                                        @enderror
                                    </div>
                                    <div class="mb-3 col-md-6">
                                        <input type="email" name="email" value="{{old('email')}}" class="form-control"
                                               placeholder="@lang('E-mail Address')" required>
                                        @error('email')
                                        <span class="text-danger">{{$message}}</span>
                                        @enderror
                                    </div>
                                    <div class="mb-3 col-md-12">
                                        <input type="text" name="subject"
                                               value="{{old('subject')}}" class="form-control"
                                               placeholder="@lang('Your Subject')" required>
                                        @error('subject')
                                        <span class="text-danger">{{$message}}</span>
                                        @enderror
                                    </div>
                                    <div class="mb-3 col-12">
                                        <textarea class="form-control" name="message" id="exampleFormControlTextarea1"
                                                  rows="8"
                                                  placeholder="@lang('Your Massage')" required>{{old('message')}}</textarea>
                                        @error('message')
                                        <span class="text-danger">{{$message}}</span>
                                        @enderror
                                    </div>
                                </div>
                                <div class="btn-area d-flex justify-content-end">
                                    <button type="submit" class="cmn-btn mt-30 w-100">@lang('Send a massage')</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
    <!-- Contact section end -->
@endif
