<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ManageMenu extends Model
{
    use HasFactory;

    protected $fillable = ['menu_section', 'menu_items'];

    protected $casts = ['menu_items' => 'array'];

    protected static function boot()
    {
        parent::boot();
        static::saved(function () {
            \Cache::forget('headerMenu');
            \Cache::forget('footerMenu');
        });
    }

    public function scopeHeaderMenu()
    {
        $arr = [];
        $this->setLinks($this->menu_items, $arr);
        return $arr;
    }

    public function scopeFooterMenu()
    {
        if ($this->menu_section == "footer") {
            $arr = [];
            $this->setLinks($this->menu_items, $arr);
            return $arr;
        }
    }

    public function scopeLinksRouteList($menuType = 'header')
    {
        $arr = [];
        if ($menuType) {
            $arr = $this->headerMenu();
        } elseif ($menuType === 'footer') {
            $arr = $this->footerMenu();
        }
        $pageList =  Page::whereIn('name', $arr)->get()->map(function ($item){
            $arr['name'] = strtolower($item->name);
            $arr['slug_name'] = $item->slug ?? '/';
            return $arr;
        });

        return $pageList;
    }


    public function setLinks($items, &$arr)
    {
        foreach ($items as $key => $item) {
            if (is_array($item)) {
                $this->setLinks($item, $arr);
            } else {
                $arr[] = $item;
            }
        }
    }


}
