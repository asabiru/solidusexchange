<div class="col-lg-3 order-2 order-lg-1">
    <div class="progress-section">
        <h6>@lang("Please furnish the necessary address details for the transaction to proceed")</h6>
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
                    <span>@lang("Specify your preferred trading pair")</span>
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
                    <h6>@lang("Wallet address")</h6>
                    <span>@lang("Please enter the details for the cryptocurrency wallet address")</span>
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
                    <span>@lang("Complete the deposit for the exchange amount")</span>
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
