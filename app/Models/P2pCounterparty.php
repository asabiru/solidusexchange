<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class P2pCounterparty extends Model
{
    use HasFactory;

    protected $table = 'p2p_counterparties';

    protected $guarded = ['id'];

    protected $casts = [
        'flagged' => 'boolean',
        'blacklisted' => 'boolean',
        'trust_score' => 'decimal:4',
        'first_seen_at' => 'datetime',
        'last_seen_at' => 'datetime',
    ];
}
