<?php

use App\Models\BasicControl;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use App\Models\Language;
use App\Models\Page;
use App\Models\PageDetail;
use App\Models\ManageMenu;
use App\Models\User;
use App\Models\Announcement;
use Illuminate\Support\Facades\Storage;

function template($asset = false)
{
    $activeTheme = basicControl()->theme??'light';
    if ($asset) return 'assets/themes/' . $activeTheme . '/';
    return 'themes.' . $activeTheme . '.';
}


if (!function_exists('getThemesNames')) {
    function getThemesNames()
    {
        $directory = resource_path('views/themes');
        return File::isDirectory($directory) ? array_map('basename', File::directories($directory)) : [];
    }
}

if (!function_exists('stringToTitle')) {
    function stringToTitle($string)
    {
        return implode(' ', array_map('ucwords', explode(' ', preg_replace('/([a-z])([A-Z])/', '$1 $2', $string))));
    }
}

if (!function_exists('stringToTitle2')) {
    function stringToTitle2($string)
    {
        return implode(' ', array_map('ucwords', explode(' ', preg_replace('/[^a-zA-Z0-9]+/', ' ', $string))));
    }
}


if (!function_exists('getTitle')) {
    function getTitle($title)
    {
        return ucwords(preg_replace('/[^A-Za-z0-9]/', ' ', $title));
    }
}

if (!function_exists('getRoute')) {
    function getRoute($route, $params = null)
    {
        return isset($params) ? route($route, $params) : route($route);
    }
}


function getPageSections()
{
    $sectionsPath = resource_path('views/') . str_replace('.', '/', template()) . 'sections';
    $pattern = $sectionsPath . '/*';
    $files = glob($pattern);

    $fileBaseNames = [];

    foreach ($files as $file) {
        if (is_file($file)) {
            $basename = basename($file);
            $basenameWithoutExtension = str_replace('.blade.php', '', $basename);
            $fileBaseNames[$basenameWithoutExtension] = $basenameWithoutExtension;
        }
    }

    return $fileBaseNames;
}


function hex2rgba($color, $opacity = false)
{
    $default = 'rgb(0,0,0)';

    if (empty($color))
        return $default;

    if ($color[0] == '#') {
        $color = substr($color, 1);
    }

    if (strlen($color) == 6) {
        $hex = array($color[0] . $color[1], $color[2] . $color[3], $color[4] . $color[5]);
    } elseif (strlen($color) == 3) {
        $hex = array($color[0] . $color[0], $color[1] . $color[1], $color[2] . $color[2]);
    } else {
        return $default;
    }

    $rgb = array_map('hexdec', $hex);

    if ($opacity) {
        if (abs($opacity) > 1)
            $opacity = 1.0;
        $output = 'rgba(' . implode(",", $rgb) . ',' . $opacity . ')';
    } else {
        $output = 'rgb(' . implode(",", $rgb) . ')';
    }
    return $output;
}


if (!function_exists('basicControl')) {
    function basicControl()
    {
        if (session()->get('themeMode') == null) {
            session()->put('themeMode', 'auto');
        }
        try {
            DB::connection()->getPdo();

            $configure = \Cache::get('ConfigureSetting');
            if (!$configure) {
                $configure = BasicControl::firstOrCreate();
                \Cache::put('ConfigureSetting', $configure);
            }

            return $configure;
        } catch (\Exception $e) {

        }
    }
}

function checkTo($currencies, $selectedCurrency = null)
{
    $selectedCurrency = strtoupper((string) ($selectedCurrency ?: basicControl()?->base_currency ?: 'USD'));
    foreach ($currencies as $key => $currency) {
        if (property_exists($currency, strtoupper($selectedCurrency))) {
            return $key;
        }
    }
}


if (!function_exists('menuActive')) {
    function menuActive($routeName, $type = null)
    {
        $class = 'active';
        if ($type == 3) {
            $class = 'active collapsed';
        } elseif ($type == 2) {
            $class = 'show';
        }

        if (is_array($routeName)) {
            foreach ($routeName as $key => $value) {
                if (request()->routeIs($value)) {
                    return $class;
                }
            }
        } elseif (request()->routeIs($routeName)) {
            return $class;
        }
    }
}

if (!function_exists('isMenuActive')) {
    function isMenuActive($routes, $type = 0)
    {
        $class = [
            '0' => 'active',
            '1' => 'style=display:block',
            '2' => true
        ];

        if (is_array($routes)) {
            foreach ($routes as $key => $route) {
                if (request()->routeIs($route)) {
                    return $class[$type];
                }
            }
        } elseif (request()->routeIs($routes)) {
            return $class[$type];
        }

        if ($type == 1) {
            return 'style=display:none';
        } else {
            return false;
        }
    }
}


function strRandom($length = 12)
{
    $characters = 'ABCDEFGHJKMNOPQRSTUVWXYZ123456789';
    $charactersLength = strlen($characters);
    $randomString = '';
    for ($i = 0; $i < $length; $i++) {
        $randomString .= $characters[rand(0, $charactersLength - 1)];
    }
    return $randomString;
}


if (!function_exists('getFile')) {
    function getFile($disk = 'local', $image = '', $upload = false)
    {
        $default = ($upload == true) ? asset(config('filelocation.default2')) : asset(config('filelocation.default'));
        try {
            if ($disk == 'local') {
                $localImage = asset('/assets/upload') . '/' . $image;
                return !empty($image) && Storage::disk($disk)->exists($image) ? $localImage : $default;
            } else {
                return !empty($image) && Storage::disk($disk)->exists($image) ? Storage::disk($disk)->url($image) : $default;
            }
        } catch (Exception $e) {
            return $default;
        }
    }
}

if (!function_exists('getFileForEdit')) {
    function getFileForEdit($disk = 'local', $image = null)
    {
        try {
            if ($disk == 'local') {
                $localImage = asset('/assets/upload') . '/' . $image;
                return !empty($image) && Storage::disk($disk)->exists($image) ? $localImage : null;
            } else {
                return !empty($image) && Storage::disk($disk)->exists($image) ? Storage::disk($disk)->url($image) : asset(config('location.default'));
            }
        } catch (Exception $e) {
            return null;
        }
    }
}

function title2snake($string)
{
    return Str::title(str_replace(' ', '_', $string));
}

function snake2Title($string)
{
    return Str::title(str_replace('_', ' ', $string));
}

function kebab2Title($string)
{
    return Str::title(str_replace('-', ' ', $string));
}

function getMethodCurrency($gateway)
{
    $baseCurrency = strtoupper((string) (basicControl()?->base_currency ?: 'USD'));

    foreach ($gateway->currencies as $key => $currency) {
        if (property_exists($currency, $gateway->currency)) {
            if ($key == 0) {
                return $gateway->currency;
            } else {
                return $baseCurrency;
            }
        }
    }
}

function twoStepPrevious($deposit)
{
    if ($deposit->depositable_type == \App\Models\Fund::class) {
        return route('fund.initialize');
    }
}

function getAmount($amount, $length = 0)
{
    if ($amount == 0) {
        return 0;
    }
    if ($length == 0) {
        preg_match("#^([\+\-]|)([0-9]*)(\.([0-9]*?)|)(0*)$#", trim($amount), $o);
        return $o[1] . sprintf('%d', $o[2]) . ($o[3] != '.' ? $o[3] : '');
    }

    return round($amount, $length);
}


function slug($title)
{
    return Str::slug($title);
}

function clean($string)
{
    $string = str_replace(' ', '_', $string); // Replaces all spaces with hyphens.
    return preg_replace('/[^A-Za-z0-9\-]/', '', $string); // Removes special chars.
}

function diffForHumans($date)
{
    $lang = session()->get('lang');
    \Carbon\Carbon::setlocale($lang);
    return \Carbon\Carbon::parse($date)->diffForHumans();
}

function loopIndex($object)
{
    return ($object->currentPage() - 1) * $object->perPage() + 1;
}

function dateTime($date, $format = 'd/m/Y H:i')
{
    $format = basicControl()->date_time_format;
    return date($format, strtotime($date));
}


if (!function_exists('getProjectDirectory')) {
    function getProjectDirectory()
    {
        return str_replace((isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://$_SERVER[HTTP_HOST]", "", url("/"));
    }
}

if (!function_exists('defaultLang')) {
    function defaultLang()
    {
        return Language::where('default_status', true)->first();
    }
}

if (!function_exists('removeHyphenInString')) {
    function removeHyphenInString($string)
    {
        return str_replace("_", " ", $string);
    }
}


function updateWallet($user_id, $credits, $balanceType, $action = 0)
{
    $user = User::find($user_id);
    $balance = 0;

    if ($action == 1) { //add credit
        $balance = $user->{$balanceType} + $credits;
        $user->{$balanceType} = $balance;
    } elseif ($action == 0) { //deduct money
        $balance = $user->{$balanceType} - $credits;
        $user->{$balanceType} = $balance;
    }

    $user->save();
    return $balance;
}


if (!function_exists('currencyPosition')) {
    function currencyPosition($amount)
    {
        $basic = basicControl();
        return $basic->is_currency_position == 'left' && $basic->has_space_between_currency_and_amount ? "{$basic->currency_symbol} {$amount}" :
            ($basic->is_currency_position == 'left' && !$basic->has_space_between_currency_and_amount ? "{$basic->currency_symbol}{$amount}" :
                ($basic->is_currency_position == 'right' && $basic->has_space_between_currency_and_amount ? "{$amount} {$basic->currency_symbol} " :
                    "{$amount}{$basic->currency_symbol}"));
    }
}

if (!function_exists('fractionNumber')) {
    function fractionNumber($amount, $afterComma = true)
    {
        $basic = basicControl();

        if (!$afterComma) {
            return number_format($amount + 0);
        }
        $formattedAmount = number_format($amount, $basic->fraction_number ?? 2);

        return rtrim(rtrim($formattedAmount, '0'), '.');

    }
}


function renderCaptCha($rand)
{
    $captcha_code = '';
    $captcha_image_height = 50;
    $captcha_image_width = 130;
    $total_characters_on_image = 6;

    $possible_captcha_letters = 'bcdfghjkmnpqrstvwxyz23456789';
    $captcha_font = 'assets/monofont.ttf';

    $random_captcha_dots = 50;
    $random_captcha_lines = 25;
    $captcha_text_color = "0x142864";
    $captcha_noise_color = "0x142864";


    $count = 0;
    while ($count < $total_characters_on_image) {
        $captcha_code .= substr(
            $possible_captcha_letters,
            mt_rand(0, strlen($possible_captcha_letters) - 1),
            1);
        $count++;
    }


    $captcha_font_size = $captcha_image_height * 0.65;
    $captcha_image = @imagecreate(
        $captcha_image_width,
        $captcha_image_height
    );

    /* setting the background, text and noise colours here */
    $background_color = imagecolorallocate(
        $captcha_image,
        255,
        255,
        255
    );

    $array_text_color = hextorgb($captcha_text_color);
    $captcha_text_color = imagecolorallocate(
        $captcha_image,
        $array_text_color['red'],
        $array_text_color['green'],
        $array_text_color['blue']
    );

    $array_noise_color = hextorgb($captcha_noise_color);
    $image_noise_color = imagecolorallocate(
        $captcha_image,
        $array_noise_color['red'],
        $array_noise_color['green'],
        $array_noise_color['blue']
    );

    /* Generate random dots in background of the captcha image */
    for ($count = 0; $count < $random_captcha_dots; $count++) {
        imagefilledellipse(
            $captcha_image,
            mt_rand(0, $captcha_image_width),
            mt_rand(0, $captcha_image_height),
            2,
            3,
            $image_noise_color
        );
    }

    /* Generate random lines in background of the captcha image */
    for ($count = 0; $count < $random_captcha_lines; $count++) {
        imageline(
            $captcha_image,
            mt_rand(0, $captcha_image_width),
            mt_rand(0, $captcha_image_height),
            mt_rand(0, $captcha_image_width),
            mt_rand(0, $captcha_image_height),
            $image_noise_color
        );
    }

    /* Create a text box and add 6 captcha letters code in it */
    $text_box = imagettfbbox(
        $captcha_font_size,
        0,
        $captcha_font,
        $captcha_code
    );
    $x = ($captcha_image_width - $text_box[4]) / 2;
    $y = ($captcha_image_height - $text_box[5]) / 2;
    imagettftext(
        $captcha_image,
        $captcha_font_size,
        0,
        $x,
        $y,
        $captcha_text_color,
        $captcha_font,
        $captcha_code
    );

    /* Show captcha image in the html page */
// defining the image type to be shown in browser widow
    header('Content-Type: image/jpeg');
    imagejpeg($captcha_image); //showing the image
    imagedestroy($captcha_image); //destroying the image instance
    session()->put('captcha', $captcha_code);
}

function hextorgb($hexstring)
{
    $integar = hexdec($hexstring);
    return array("red" => 0xFF & ($integar >> 0x10),
        "green" => 0xFF & ($integar >> 0x8),
        "blue" => 0xFF & $integar);
}

function getIpInfo()
{
//	$ip = '210.1.246.42';
    $ip = null;
    $deep_detect = TRUE;

    if (filter_var($ip, FILTER_VALIDATE_IP) === FALSE) {
        $ip = $_SERVER["REMOTE_ADDR"];
        if ($deep_detect) {
            if (filter_var(@$_SERVER['HTTP_X_FORWARDED_FOR'], FILTER_VALIDATE_IP))
                $ip = $_SERVER['HTTP_X_FORWARDED_FOR'];
            if (filter_var(@$_SERVER['HTTP_CLIENT_IP'], FILTER_VALIDATE_IP))
                $ip = $_SERVER['HTTP_CLIENT_IP'];
        }
    }
    $xml = @simplexml_load_file("http://www.geoplugin.net/xml.gp?ip=" . $ip);

    $country = @$xml->geoplugin_countryName;
    $city = @$xml->geoplugin_city;
    $area = @$xml->geoplugin_areaCode;
    $code = @$xml->geoplugin_countryCode;
    $long = @$xml->geoplugin_longitude;
    $lat = @$xml->geoplugin_latitude;


    $user_agent = $_SERVER['HTTP_USER_AGENT'];
    $os_platform = "Unknown OS Platform";
    $os_array = array(
        '/windows nt 10/i' => 'Windows 10',
        '/windows nt 6.3/i' => 'Windows 8.1',
        '/windows nt 6.2/i' => 'Windows 8',
        '/windows nt 6.1/i' => 'Windows 7',
        '/windows nt 6.0/i' => 'Windows Vista',
        '/windows nt 5.2/i' => 'Windows Server 2003/XP x64',
        '/windows nt 5.1/i' => 'Windows XP',
        '/windows xp/i' => 'Windows XP',
        '/windows nt 5.0/i' => 'Windows 2000',
        '/windows me/i' => 'Windows ME',
        '/win98/i' => 'Windows 98',
        '/win95/i' => 'Windows 95',
        '/win16/i' => 'Windows 3.11',
        '/macintosh|mac os x/i' => 'Mac OS X',
        '/mac_powerpc/i' => 'Mac OS 9',
        '/linux/i' => 'Linux',
        '/ubuntu/i' => 'Ubuntu',
        '/iphone/i' => 'iPhone',
        '/ipod/i' => 'iPod',
        '/ipad/i' => 'iPad',
        '/android/i' => 'Android',
        '/blackberry/i' => 'BlackBerry',
        '/webos/i' => 'Mobile'
    );
    foreach ($os_array as $regex => $value) {
        if (preg_match($regex, $user_agent)) {
            $os_platform = $value;
        }
    }
    $browser = "Unknown Browser";
    $browser_array = array(
        '/msie/i' => 'Internet Explorer',
        '/firefox/i' => 'Firefox',
        '/safari/i' => 'Safari',
        '/chrome/i' => 'Chrome',
        '/edge/i' => 'Edge',
        '/opera/i' => 'Opera',
        '/netscape/i' => 'Netscape',
        '/maxthon/i' => 'Maxthon',
        '/konqueror/i' => 'Konqueror',
        '/mobile/i' => 'Handheld Browser'
    );
    foreach ($browser_array as $regex => $value) {
        if (preg_match($regex, $user_agent)) {
            $browser = $value;
        }
    }

    $data['country'] = $country;
    $data['city'] = $city;
    $data['area'] = $area;
    $data['code'] = $code;
    $data['long'] = $long;
    $data['lat'] = $lat;
    $data['os_platform'] = $os_platform;
    $data['browser'] = $browser;
    $data['ip'] = request()->ip();
    $data['time'] = date('d-m-Y h:i:s A');

    return $data;
}

if (!function_exists('stringToRouteName')) {
    function stringToRouteName($string)
    {
        $result = preg_replace('/[^a-zA-Z0-9]+/', '.', $string);
        return empty($result) || $result == '.' ? 'home' : $result;
    }
}


function browserIcon($string)
{
    $list = [
        "Unknown Browser" => "unknown",
        'Internet Explorer' => 'internetExplorer',
        'Firefox' => 'firefox',
        'Safari' => 'safari',
        'Chrome' => 'chrome',
        'Edge' => 'edge',
        'Opera' => 'opera',
        'Netscape' => 'netscape',
        'Maxthon' => 'maxthon',
        'Konqueror' => 'unknown',
        'UC Browser' => 'ucBrowser',
        'Safari Browser' => 'safari'];
    return $list[$string] ?? 'unknown';

}

function deviceIcon($string)
{
    $list = [
        'Tablet' => 'bi-laptop',
        'Mobile' => 'bi-phone',
        'Computer' => 'bi-display'];
    return $list[$string] ?? '';

}

if (!function_exists('timeAgo')) {
    function timeAgo($timestamp)
    {
        //$time_now = mktime(date('h')+0,date('i')+30,date('s'));
        $datetime1 = new DateTime("now");
        $datetime2 = date_create($timestamp);
        $diff = date_diff($datetime1, $datetime2);
        $timemsg = '';
        if ($diff->y > 0) {
            $timemsg = $diff->y . ' year' . ($diff->y > 1 ? "s" : '');

        } else if ($diff->m > 0) {
            $timemsg = $diff->m . ' month' . ($diff->m > 1 ? "s" : '');
        } else if ($diff->d > 0) {
            $timemsg = $diff->d . ' day' . ($diff->d > 1 ? "s" : '');
        } else if ($diff->h > 0) {
            $timemsg = $diff->h . ' hour' . ($diff->h > 1 ? "s" : '');
        } else if ($diff->i > 0) {
            $timemsg = $diff->i . ' minute' . ($diff->i > 1 ? "s" : '');
        } else if ($diff->s > 0) {
            $timemsg = $diff->s . ' second' . ($diff->s > 1 ? "s" : '');
        }
        if ($timemsg == "")
            $timemsg = "Just now";
        else
            $timemsg = $timemsg . ' ago';

        return $timemsg;
    }
}


if (!function_exists('renderHeaderMenu')) {
    function renderHeaderMenu($menuItems)
    {
        foreach ($menuItems as $menuItem) {
            if (isset($menuItem['child'])) {
                echo '<li class="dropdown text-capitalize">';
                echo '<a href="javascript:void(0)"><span>' . $menuItem['name'] . '</span> <i class="bi bi-chevron-down"></i></a>';
                renderHeaderMenu($menuItem['child']);
            } else {
                echo '<li>';
                echo '<a class="nav-link text-capitalize ' . (strtolower(getLastSegment()) == strtolower($menuItem['name']) ? 'active' : '') . '" href="' . $menuItem['route'] . '">' . $menuItem['name'] . '</a>';
            }
            echo '</li>';
        }
    }
}

function getLinksObj($item, $menu_section = 'header')
{
    $headerMenu = ManageMenu::where('menu_section', $menu_section)->first();
    if ($headerMenu) {
        $result = $headerMenu->scopeLinksRouteList()->where('name', $item)->first();
        return $result ?? [];
    }
    return '';
}

function getLastSegment()
{
    $currentUrl = url()->current();
    $lastSegment = last(explode('/', $currentUrl));
    return $lastSegment;
}

if (!function_exists('getIdAndTable')) {
    function getIdAndTable($recipent)
    {
        $firstCharacter = substr($recipent, 0, 1);
        if ($firstCharacter == 'c') { //Contact
            if (preg_match('/^([a-zA-Z_]+)_?(\d+)$/', $recipent, $matches)) {
                return [
                    'id' => $matches[2],
                    'table' => $matches[1],
                ];
            }

        } elseif ($firstCharacter == 's') { //Segment
            if (preg_match('/^([a-zA-Z_]+)_?(\d+)$/', $recipent, $matches)) {
                return [
                    'id' => $matches[2],
                    'table' => $matches[1],
                ];
            }
        }

        return [
            'id' => 'unknown',
            'table' => 'unknown',
        ];
    }
}


function recursive_array_replace($find, $replace, $array)
{
    if (!is_array($array)) {
        return str_ireplace($find, $replace, $array);
    }

    $newArray = [];

    foreach ($array as $key => $value) {
        $newArray[$key] = recursive_array_replace($find, $replace, $value);
    }

    return $newArray;
}

function code($length)
{
    if ($length == 0) return 0;
    $min = pow(10, $length - 1);
    $max = 0;
    while ($length > 0 && $length--) {
        $max = ($max * 10) + 9;
    }
    return random_int($min, $max);
}


if (!function_exists('staticPagesAndRoutes')) {

    function staticPagesAndRoutes($name)
    {
        return [
                'blog' => 'blog',
            ][$name] ?? $name;
    }
}


if (!function_exists('getHeaderMenuData')) {
    function getHeaderMenuData()
    {
        $menu = \Cache::get('headerMenu');
        if (!$menu) {
            $menu = ManageMenu::where('menu_section', 'header')->first();
            \Cache::put('headerMenu', $menu);
        }
        $menuData = [];

        if ($menu->menu_items && count($menu->menu_items) > 0) {
            foreach ($menu->menu_items as $key => $menuItem) {
                if (is_numeric($key)) {
                    $pageDetails = getPageDetails($menuItem);
                    $menuIDetails = [
                        'name' => $pageDetails->page_name ?? $pageDetails->name ?? $menuItem,
                        'route' => isset($pageDetails->slug) ? route('page', $pageDetails->slug) : ($pageDetails->custom_link ?? staticPagesAndRoutes($menuItem)),
                    ];
                } elseif (is_array($menuItem)) {
                    $pageDetails = getPageDetails($key);
                    $child = getHeaderChildMenu($menuItem);
                    $menuIDetails = [
                        'name' => $pageDetails->page_name ?? $pageDetails->name,
                        'route' => isset($pageDetails->slug) ? route('page', $pageDetails->slug) : ($pageDetails->custom_link ?? staticPagesAndRoutes($key)),
                        'child' => $child
                    ];
                }
                $menuData[] = $menuIDetails;
            }
        }
        return $menuData;
    }
}


if (!function_exists('getHeaderChildMenu')) {
    function getHeaderChildMenu($menuItem, $menuData = [])
    {
        foreach ($menuItem as $key => $item) {
            if (is_numeric($key)) {
                $pageDetails = getPageDetails($item);
                $menuData[] = [
                    'name' => $pageDetails->page_name ?? $pageDetails->name ?? $item,
                    'route' => isset($pageDetails->slug) ? route('page', $pageDetails->slug) : ($pageDetails->custom_link ?? staticPagesAndRoutes($item)),
                ];
            } elseif (is_array($item)) {
                $pageDetails = getPageDetails($key);
                $child = getHeaderChildMenu($item);
                $menuData[] = [
                    'name' => $pageDetails->page_name ?? $pageDetails->name ?? $key,
                    'route' => isset($pageDetails->slug) ? route('page', $pageDetails->slug) : ($pageDetails->custom_link ?? staticPagesAndRoutes($key)),
                    'child' => $child
                ];
            } else {
                $pageDetails = getPageDetails($key);
                $child = getHeaderChildMenu([$item]);
                $menuData[] = [
                    'name' => $pageDetails->page_name ?? $pageDetails->name ?? $key,
                    'route' => isset($pageDetails->slug) ? route('page', $pageDetails->slug) : ($pageDetails->custom_link ?? staticPagesAndRoutes($key)),
                    'child' => $child
                ];
            }
        }

        return $menuData;
    }
}


  if (!function_exists('getPageDetails')) {
      function getPageDetails($name)
      {
          try {
              DB::connection()->getPdo();
              return Cache::remember('page_details_' . session('lang', 'en') . "_{$name}", now()->addMinutes(30), function () use ($name) {
                  $lang = session('lang', 'en');
                  return Page::select('id', 'name', 'slug', 'custom_link')
                      ->where('name', $name)
                      ->addSelect([
                        'page_name' => PageDetail::with('language')
                            ->select('name')
                            ->whereHas('language', function ($query) use ($lang) {
                                $query->where('short_name', $lang);
                            })
                            ->whereColumn('page_id', 'pages.id')
                            ->limit(1)
                    ])
                    ->first();
            });

        } catch (\Exception $e) {

        }
    }
}

if (!function_exists('renderHeaderMenu')) {
    function renderHeaderMenu($menuItems)
    {
        echo '<ul>';
        foreach ($menuItems as $menuItem) {
            if (isset($menuItem['child'])) {
                echo '<li class="dropdown text-capitalize">';
                echo '<a href="javascript:void(0)"><span>' . $menuItem['name'] . '</span> <i class="bi bi-chevron-down"></i></a>';
                renderHeaderMenu($menuItem['child']);
            } else {
                echo '<li>';
                echo '<a class="nav-link text-capitalize" href="' . $menuItem['route'] . '">' . $menuItem['name'] . '</a>';
            }
            echo '</li>';
        }
        echo '</ul>';
    }
}


if (!function_exists('getFooterMenuData')) {
    function getFooterMenuData($type)
    {
        $menu = \Cache::get('footerMenu');
        if (!$menu) {
            $menu = ManageMenu::where('menu_section', 'footer')->first();
            \Cache::put('footerMenu', $menu);
        }
        $menuData = [];

        if (isset($menu->menu_items[$type])) {
            foreach ($menu->menu_items[$type] as $key => $menuItem) {
                $pageDetails = getPageDetails($menuItem);
                $menuIDetails = [
                    'name' => $pageDetails->page_name ?? $pageDetails->name ?? $menuItem,
                    'route' => isset($pageDetails->slug) ? route('page', $pageDetails->slug) : ($pageDetails->custom_link ?? staticPagesAndRoutes($menuItem)),
                ];
                $menuData[] = $menuIDetails;
            }
            foreach ($menuData as $item) {
                $che = '<li><a class="widget-link" href="' . $item['route'] . '">' . $item['name'] . '</a></li>';
                $flattenedMenuData[] = $che;
            }
            return $flattenedMenuData;
        }
    }
}

function getPageName($name)
{
    $defaultLanguage = Language::where('default_status', true)->first();
    $pageDetails = PageDetail::select('id', 'page_id', 'name')
        ->with('page:id,name,slug')
        ->where('language_id', $defaultLanguage->id)
        ->whereHas('page', function ($query) use ($name) {
            $query->where('name', $name);
        })
        ->first();
    return $pageDetails->name ?? $pageDetails->page->name ?? $name;
}


function filterCustomLinkRecursive($collection, $lookingKey = '')
{

    $filterCustomLinkRecursive = function ($array) use (&$filterCustomLinkRecursive, $lookingKey) {
        foreach ($array as $key => $value) {
            if (is_array($value)) {
                $array[$key] = $filterCustomLinkRecursive($value);
            } elseif ($value === $lookingKey || $key === $lookingKey) {
                unset($array[$key]);
            }
        }
        return $array;
    };
    $filteredCollection = $filterCustomLinkRecursive($collection);

    return $filteredCollection;
}


if (!function_exists('emailProtected')) {
    function emailProtected($email)
    {
        list($username, $domain) = explode('@', $email);
        $maskedUsername = substr_replace($username, str_repeat('*', strlen($username) - 2), 1, -1);
        $maskedDomain = substr_replace($domain, str_repeat('*', strlen($domain) - 3), 1, -2);
        $maskedEmail = $maskedUsername . '@' . $maskedDomain;
        return $maskedEmail;
    }
}

if (!function_exists('wordSplice')) {
    function wordSplice($string, $splice = -2)
    {
        $words = explode(" ", $string);
        $last_two_word = implode(' ', array_splice($words, $splice));
        $except_last_two = implode(' ', $words);
        return [
            'exceptTwo' => $except_last_two,
            'lastTwo' => $last_two_word,
        ];
    }
}

if (!function_exists('announcement')) {
    function announcement()
    {
        $announcement = \Cache::get('announcement');
        if (!$announcement) {
            $announcement = Announcement::firstOrCreate();
            \Cache::put('announcement', $announcement);
        }
        return $announcement;
    }
}

if (!function_exists('getUSDRate')) {
    function getUSDRate($baseRate)
    {
        return $baseRate / \basicControl()->exchange_rate;
    }
}

if (!function_exists('getBaseAmount')) {
    function getBaseAmount($amount, $currencyCode, $type)
    {
        if ($type == 'crypto') {
            $currency = \App\Models\CryptoCurrency::where('code', $currencyCode)->first();
        } elseif ($type == 'fiat') {
            $currency = \App\Models\FiatCurrency::where('code', $currencyCode)->first();
        }
        if ($currency) {
            return $currency->rate * $amount;
        }
        return null;
    }
}

if (!function_exists('formatCryptoRate')) {
    /**
     * Format a crypto/fiat rate for display, handling very small values (meme coins)
     * and avoiding scientific notation like 5.5215E-6.
     *
     * Examples:
     *   75821.45  → "75,821.45"
     *   1.0       → "1.0000"
     *   0.37575   → "0.3758"
     *   0.0000055 → "0.00000550"
     *   0.00000000351 → "0.0000000035"
     */
    function formatCryptoRate(float $rate): string
    {
        if ($rate <= 0) {
            return '0.00';
        }

        // For very small values (< 0.001), show enough significant digits
        if ($rate < 0.001) {
            $formatted = sprintf('%.10f', $rate);
            // Trim trailing zeros but keep at least 2 decimal places
            $formatted = rtrim(rtrim($formatted, '0'), '.');
            // Ensure at least 2 significant digits after the leading zeros
            // e.g. 0.0000055 → 0.00000550 (2 sig digits)
            $dotPos = strpos($formatted, '.');
            if ($dotPos !== false) {
                $afterDot = substr($formatted, $dotPos + 1);
                // Count leading zeros after decimal
                $leadingZeros = strspn($afterDot, '0');
                // We want at least 2 non-zero digits after the leading zeros
                $minDigits = $leadingZeros + 2;
                if (strlen($afterDot) < $minDigits) {
                    $formatted = substr($formatted, 0, $dotPos + 1) . str_pad($afterDot, $minDigits, '0');
                }
            }
            return $formatted;
        }

        // For values between 0.001 and 10, show 4 decimal places
        if ($rate < 10) {
            return number_format($rate, 4, '.', '');
        }

        // For values between 10 and 1000, show 2 decimal places
        if ($rate < 1000) {
            return number_format($rate, 2, '.', '');
        }

        // For values >= 1000, show 2 decimal places with thousands separator
        return number_format($rate, 2, '.', ',');
    }
}

if (!function_exists('getFirebaseFileName')) {
    function getFirebaseFileName()
    {
        return 'firebase-service.json';
    }
}
