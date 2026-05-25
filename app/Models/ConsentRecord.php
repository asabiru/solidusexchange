<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ConsentRecord extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'accepted_at' => 'datetime',
        'metadata' => 'array',
    ];

    public function consentable()
    {
        return $this->morphTo();
    }

    public function legalDocument()
    {
        return $this->belongsTo(LegalDocument::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class)->withTrashed();
    }
}
