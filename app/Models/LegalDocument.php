<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class LegalDocument extends Model
{
    use HasFactory;

    protected $guarded = ['id'];

    protected $casts = [
        'published_at' => 'datetime',
    ];

    public function scopePublished($query)
    {
        return $query->whereNotNull('published_at')->where('published_at', '<=', now());
    }

    public static function current(string $type, ?string $locale = null): ?self
    {
        return self::query()
            ->published()
            ->where('type', $type)
            ->where('locale', $locale ?: app()->getLocale())
            ->latest('published_at')
            ->latest('id')
            ->first();
    }
}
