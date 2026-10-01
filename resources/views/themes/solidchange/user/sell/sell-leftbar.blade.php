<div class="col-lg-3 order-2 order-lg-1">
    <div class="progress-section">
        <h6>@lang("Please provide the necessary account information to complete the trade")</h6>
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
                    <span>@lang("Please select the cryptocurrency you wish to sell and the fiat currency you would like to purchase.")</span>
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
                    <span>@lang("Provide the destination fiat currency account information, where your newly acquired digital assets will be transferred.")</span>
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
                    <span>@lang("Confirm the payment and receive your newly purchased fiat currency in a few minutes.")</span>
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
                    <span>@lang("Await the completion of your transaction")</span>
                </div>
            </div>
        </div>
    </div>
</div>
