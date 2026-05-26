<?php

namespace App\Traits;


trait Status
{
    public function getTrackingStatusAttribute()
    {
        if ($this->status == 1) {
            return '<h4 class="mb-0 text-info">'.trans('Awaiting deposit').'</h4>';
        } elseif ($this->status == 2) {
            if ($this->hedge_status === 'payout_queued') {
                return '<h4 class="mb-0 text-warning">'.trans('Payout queued').'</h4>';
            }
            return '<h4 class="mb-0 text-primary">'.trans('Awaiting').'</h4>';
        } elseif ($this->status == 3) {
            return '<h4 class="mb-0 text-success">'.trans('Completed').'</h4>';
        } elseif ((int)$this->status === 5) {
            return '<h4 class="mb-0 text-danger">'.trans('Canceled').'</h4>';
        }
    }

    public function getUserStatusAttribute()
    {
        if ($this->status == 1) {
            return '<span class="badge text-bg-info">'.trans('Awaiting deposit').'</span>';
        } elseif ($this->status == 2) {
            if ($this->hedge_status === 'payout_queued') {
                return '<span class="badge text-bg-warning">'.trans('Payout queued').'</span>';
            }
            return '<span class="badge text-bg-primary">'.trans('Awaiting').'</span>';
        } elseif ($this->status == 3) {
            return '<span class="badge text-bg-success">'.trans('Completed').'</span>';
        } elseif ((int)$this->status === 5) {
            return '<span class="badge text-bg-danger">'.trans('Canceled').'</span>';
        }
    }

    public function getAdminStatusAttribute()
    {
        if ($this->status == 1) {
            return '<span class="badge bg-soft-info text-info">
                    <span class="legend-indicator bg-info"></span>' . trans('Awaiting Deposit') . '
                  </span>';

        } elseif ($this->status == 2) {
            if ($this->hedge_status === 'payout_queued') {
                return '<span class="badge bg-soft-warning text-warning">
                    <span class="legend-indicator bg-warning"></span>' . trans('Payout Queued') . '
                  </span>';
            }
            return '<span class="badge bg-soft-warning text-warning">
                    <span class="legend-indicator bg-warning"></span>' . trans('Pending') . '
                  </span>';

        } elseif ($this->status == 3) {
            return '<span class="badge bg-soft-success text-success">
                    <span class="legend-indicator bg-success"></span>' . trans('Completed') . '
                  </span>';
        } elseif ((int)$this->status === 5) {
            return '<span class="badge bg-soft-danger text-danger">
                    <span class="legend-indicator bg-danger"></span>' . trans('Canceled') . '
                  </span>';
        }
    }
}
