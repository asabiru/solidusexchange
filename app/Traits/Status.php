<?php

namespace App\Traits;


trait Status
{
    public function getTrackingStatusAttribute()
    {
        if ($this->status == 2) {
            return '<h4 class="mb-0 text-primary">'.trans('Awaiting').'</h4>';
        } elseif ($this->status == 3) {
            return '<h4 class="mb-0 text-success">'.trans('Completed').'</h4>';
        } elseif ($this->status == 5) {
            return '<h4 class="mb-0 text-danger">'.trans('Canceled').'</h4>';
        } elseif ($this->status == 6) {
            return '<h4 class="mb-0 text-warning">'.trans('Refunded').'</h4>';
        }
    }

    public function getUserStatusAttribute()
    {
        if ($this->status == 2) {
            return '<span class="badge text-bg-primary">'.trans('Awaiting').'</span>';
        } elseif ($this->status == 3) {
            return '<span class="badge text-bg-success">'.trans('Completed').'</span>';
        } elseif ($this->status == 5) {
            return '<span class="badge text-bg-danger">'.trans('Canceled').'</span>';
        } elseif ($this->status == 6) {
            return '<span class="badge text-bg-warning">'.trans('Refunded').'</span>';
        }
    }

    public function getAdminStatusAttribute()
    {
        if ($this->status == 2) {
            return '<span class="badge bg-soft-warning text-warning">
                    <span class="legend-indicator bg-warning"></span>' . trans('Pending') . '
                  </span>';

        } elseif ($this->status == 3) {
            return '<span class="badge bg-soft-success text-success">
                    <span class="legend-indicator bg-success"></span>' . trans('Completed') . '
                  </span>';
        } elseif ($this->status == 5) {
            return '<span class="badge bg-soft-danger text-danger">
                    <span class="legend-indicator bg-danger"></span>' . trans('Canceled') . '
                  </span>';
        } elseif ($this->status == 6) {
            return '<span class="badge bg-soft-primary text-primary">
                    <span class="legend-indicator bg-primary"></span>' . trans('Refunded') . '
                  </span>';
        }
    }
}
