<div class="col-lg-3 order-2 order-lg-1">
    <div class="progress-section">
        <h6>@lang("Quick steps")</h6>
        <div class="progress" role="progressbar" aria-label="Example with label" aria-valuenow="{{$progress}}"
             aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar" style="width: {{$progress}}%"></div>
        </div>
        <div class="progress-step-area">
            <div class="item">
                <div class="icon-area checkmark">
                    <i class="fa-light fa-check"></i>
                </div>
                <div class="content-area">
                    <h6>@lang("Trading pair")</h6>
                    <span>@lang("Amount and currency")</span>
                </div>
            </div>
            <div class="item">
                @if($check > 2)
                    <div class="icon-area checkmark">
                        <i class="fa-light fa-check"></i>
                    </div>
                @elseif($check  == 2)
                    <div class="icon-area">
                        <i class="fa-light fa-arrow-right"></i>
                    </div>
                @else
                    <div class="number">
                        2
                    </div>
                @endif
                <div class="content-area">
                    <h6>@lang("Account details")</h6>
                    <span>@lang("Where to receive fiat")</span>
                </div>
            </div>
            <div class="item">
                @if($check > 3)
                    <div class="icon-area checkmark">
                        <i class="fa-light fa-check"></i>
                    </div>
                @elseif($check  == 3)
                    <div class="icon-area">
                        <i class="fa-light fa-arrow-right"></i>
                    </div>
                @else
                    <div class="number">
                        3
                    </div>
                @endif
                <div class="content-area">
                    <h6>@lang("Initiate Payment")</h6>
                    <span>@lang("Send crypto")</span>
                </div>
            </div>
            <div class="item">
                @if($check > 4)
                    <div class="icon-area checkmark">
                        <i class="fa-light fa-check"></i>
                    </div>
                @elseif($check  == 4)
                    <div class="icon-area">
                        <i class="fa-light fa-arrow-right"></i>
                    </div>
                @else
                    <div class="number">
                        4
                    </div>
                @endif
                <div class="content-area">
                    <h6>@lang("Trade")</h6>
                    <span>@lang("Track status")</span>
                </div>
            </div>
        </div>
    </div>
</div>
