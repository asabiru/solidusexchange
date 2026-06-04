{{-- Exchange Statistics --}}
<div class="col-12">
    <h5 class="dash-section-title">
        <i class="fa-light fa-arrow-right-arrow-left"></i>
        @lang('Exchange Statistics')
    </h5>
    <div class="row g-3">
        <div class="col-md-4 box-item">
            <div class="box-card">
                <div class="dash-stat-icon dash-stat-icon--pending">
                    <i class="fa-light fa-clock"></i>
                </div>
                <div class="dash-stat-body">
                    <span class="dash-stat-label">@lang('Pending')</span>
                    <div class="dash-stat-value"><span class="pendingExchange">0</span></div>
                    <div class="dash-stat-footer">
                        <span class="dash-stat-total">@lang('Total'): <b class="totalExchange">0</b></span>
                        <span class="dash-stat-trend">
                            <i class="fa-light fa-chart-line-up"></i>
                            <span class="last30DaysPendingPercentage">0</span>%
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4 box-item">
            <div class="box-card dash-card--success">
                <div class="dash-stat-icon dash-stat-icon--success">
                    <i class="fa-light fa-circle-check"></i>
                </div>
                <div class="dash-stat-body">
                    <span class="dash-stat-label">@lang('Completed')</span>
                    <div class="dash-stat-value"><span class="completeExchange">0</span></div>
                    <div class="dash-stat-footer">
                        <span class="dash-stat-total">@lang('Total'): <b class="totalExchange">0</b></span>
                        <span class="dash-stat-trend dash-trend--up">
                            <i class="fa-light fa-chart-line-up"></i>
                            <span class="last30DaysCompletePercentage">0</span>%
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4 box-item">
            <div class="box-card dash-card--danger">
                <div class="dash-stat-icon dash-stat-icon--danger">
                    <i class="fa-light fa-circle-xmark"></i>
                </div>
                <div class="dash-stat-body">
                    <span class="dash-stat-label">@lang('Cancelled')</span>
                    <div class="dash-stat-value"><span class="cancelExchange">0</span></div>
                    <div class="dash-stat-footer">
                        <span class="dash-stat-total">@lang('Total'): <b class="totalExchange">0</b></span>
                        <span class="dash-stat-trend dash-trend--down">
                            <i class="fa-light fa-chart-line-down"></i>
                            <span class="last30DaysCancelPercentage">0</span>%
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

{{-- Buy Statistics --}}
<div class="col-12 mt-4">
    <h5 class="dash-section-title">
        <i class="fa-light fa-circle-plus"></i>
        @lang('Buy Statistics')
    </h5>
    <div class="row g-3">
        <div class="col-md-4 box-item">
            <div class="box-card">
                <div class="dash-stat-icon dash-stat-icon--pending">
                    <i class="fa-light fa-clock"></i>
                </div>
                <div class="dash-stat-body">
                    <span class="dash-stat-label">@lang('Pending')</span>
                    <div class="dash-stat-value"><span class="pendingBuy">0</span></div>
                    <div class="dash-stat-footer">
                        <span class="dash-stat-total">@lang('Total'): <b class="totalBuy">0</b></span>
                        <span class="dash-stat-trend">
                            <i class="fa-light fa-chart-line-up"></i>
                            <span class="last30DaysPendingPercentageBuy">0</span>%
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4 box-item">
            <div class="box-card dash-card--success">
                <div class="dash-stat-icon dash-stat-icon--success">
                    <i class="fa-light fa-circle-check"></i>
                </div>
                <div class="dash-stat-body">
                    <span class="dash-stat-label">@lang('Completed')</span>
                    <div class="dash-stat-value"><span class="completeBuy">0</span></div>
                    <div class="dash-stat-footer">
                        <span class="dash-stat-total">@lang('Total'): <b class="totalBuy">0</b></span>
                        <span class="dash-stat-trend dash-trend--up">
                            <i class="fa-light fa-chart-line-up"></i>
                            <span class="last30DaysCompletePercentageBuy">0</span>%
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4 box-item">
            <div class="box-card dash-card--danger">
                <div class="dash-stat-icon dash-stat-icon--danger">
                    <i class="fa-light fa-circle-xmark"></i>
                </div>
                <div class="dash-stat-body">
                    <span class="dash-stat-label">@lang('Cancelled')</span>
                    <div class="dash-stat-value"><span class="cancelBuy">0</span></div>
                    <div class="dash-stat-footer">
                        <span class="dash-stat-total">@lang('Total'): <b class="totalBuy">0</b></span>
                        <span class="dash-stat-trend dash-trend--down">
                            <i class="fa-light fa-chart-line-down"></i>
                            <span class="last30DaysCancelPercentageBuy">0</span>%
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

{{-- Sell Statistics --}}
<div class="col-12 mt-4">
    <h5 class="dash-section-title">
        <i class="fa-light fa-circle-minus"></i>
        @lang('Sell Statistics')
    </h5>
    <div class="row g-3">
        <div class="col-md-4 box-item">
            <div class="box-card">
                <div class="dash-stat-icon dash-stat-icon--pending">
                    <i class="fa-light fa-clock"></i>
                </div>
                <div class="dash-stat-body">
                    <span class="dash-stat-label">@lang('Pending')</span>
                    <div class="dash-stat-value"><span class="pendingSell">0</span></div>
                    <div class="dash-stat-footer">
                        <span class="dash-stat-total">@lang('Total'): <b class="totalSell">0</b></span>
                        <span class="dash-stat-trend">
                            <i class="fa-light fa-chart-line-up"></i>
                            <span class="last30DaysPendingPercentageSell">0</span>%
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4 box-item">
            <div class="box-card dash-card--success">
                <div class="dash-stat-icon dash-stat-icon--success">
                    <i class="fa-light fa-circle-check"></i>
                </div>
                <div class="dash-stat-body">
                    <span class="dash-stat-label">@lang('Completed')</span>
                    <div class="dash-stat-value"><span class="completeSell">0</span></div>
                    <div class="dash-stat-footer">
                        <span class="dash-stat-total">@lang('Total'): <b class="totalSell">0</b></span>
                        <span class="dash-stat-trend dash-trend--up">
                            <i class="fa-light fa-chart-line-up"></i>
                            <span class="last30DaysCompletePercentageSell">0</span>%
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-md-4 box-item">
            <div class="box-card dash-card--danger">
                <div class="dash-stat-icon dash-stat-icon--danger">
                    <i class="fa-light fa-circle-xmark"></i>
                </div>
                <div class="dash-stat-body">
                    <span class="dash-stat-label">@lang('Cancelled')</span>
                    <div class="dash-stat-value"><span class="cancelSell">0</span></div>
                    <div class="dash-stat-footer">
                        <span class="dash-stat-total">@lang('Total'): <b class="totalSell">0</b></span>
                        <span class="dash-stat-trend dash-trend--down">
                            <i class="fa-light fa-chart-line-down"></i>
                            <span class="last30DaysCancelPercentageSell">0</span>%
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
/* Section titles */
.dash-section-title {
    display: flex !important;
    align-items: center;
    gap: 8px;
    font-size: 12px !important;
    font-weight: 700 !important;
    letter-spacing: 0.07em !important;
    text-transform: uppercase !important;
    color: #5e534d !important;
    margin-bottom: 12px !important;
    border-left: 3px solid rgba(232,201,160,0.4) !important;
    padding-left: 10px !important;
}

.dash-section-title i {
    color: rgba(232,201,160,0.5);
    font-size: 13px;
}

/* Stat card layout */
.box-card {
    display: flex !important;
    flex-direction: row !important;
    align-items: flex-start !important;
    gap: 16px !important;
    padding: 20px !important;
    position: relative;
    overflow: hidden;
}

.box-card::before {
    content: "";
    position: absolute;
    top: -20px; right: -20px;
    width: 80px; height: 80px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(232,201,160,0.06) 0%, transparent 70%);
    pointer-events: none;
}

.dash-stat-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
}

.dash-stat-icon--pending {
    background: rgba(217,168,106,0.12);
    color: #d9a86a;
}

.dash-stat-icon--success {
    background: rgba(169,133,79,0.12);
    color: #a9854f;
}

.dash-stat-icon--danger {
    background: rgba(201,120,106,0.12);
    color: #c9786a;
}

.dash-card--success { border-color: rgba(169,133,79,0.12) !important; }
.dash-card--success .dash-stat-value { color: #a9854f !important; }
.dash-card--danger { border-color: rgba(201,120,106,0.12) !important; }

.dash-stat-body {
    flex: 1;
    min-width: 0;
}

.dash-stat-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #5e534d;
    margin-bottom: 6px;
}

.dash-stat-value {
    font-size: 36px;
    font-weight: 700;
    color: #f5ede4;
    line-height: 1;
    margin-bottom: 10px;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
}

.dash-stat-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid rgba(255,255,255,0.04);
}

.dash-stat-total {
    font-size: 12px;
    color: #5e534d;
}

.dash-stat-total b {
    color: #9a8e86;
    font-weight: 600;
}

.dash-stat-trend {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    font-weight: 600;
    color: #9a8e86;
    background: rgba(255,255,255,0.04);
    padding: 3px 7px;
    border-radius: 99px;
}

.dash-trend--up {
    color: #a9854f;
    background: rgba(169,133,79,0.08);
}

.dash-trend--down {
    color: #c9786a;
    background: rgba(201,120,106,0.08);
}
</style>
