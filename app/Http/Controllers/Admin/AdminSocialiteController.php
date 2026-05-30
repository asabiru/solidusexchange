<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Validator;
use Stevebauman\Purify\Facades\Purify;

class AdminSocialiteController extends Controller
{
    private function publicRoute(string $routeName, string $provider): string
    {
        $path = route($routeName, $provider, false);
        $baseUrl = rtrim((string) config('app.url'), '/');

        return $baseUrl !== '' ? $baseUrl . $path : route($routeName, $provider);
    }

	public function index()
	{
		return view('admin.control_panel.socialiteConfig');
	}

	public function telegramConfig(Request $request)
	{
		if ($request->isMethod('get')) {
			return view('admin.control_panel.telegramControl');
		} elseif ($request->isMethod('post')) {
			$purifiedData = Purify::clean($request->all());

			$validator = Validator::make($purifiedData, [
				'telegram_bot_username' => 'required|min:3',
				'telegram_bot_token' => 'required|min:3',
				'telegram_status' => 'nullable|integer|min:0|in:0,1',
			]);

			if ($validator->fails()) {
				return back()->withErrors($validator)->withInput();
			}
			$purifiedData = (object)$purifiedData;
			$telegramBotUsername = ltrim(trim($purifiedData->telegram_bot_username), '@');
			$telegramBotToken = trim($purifiedData->telegram_bot_token);

			config(['socialite.telegram_status' => $purifiedData->telegram_status]);
			$fp = fopen(base_path() . '/config/socialite.php', 'w');
			fwrite($fp, '<?php return ' . var_export(config('socialite'), true) . ';');
			fclose($fp);

			$envPath = base_path('.env');
			$env = file($envPath);
			$env = $this->set('TELEGRAM_BOT_USERNAME', $telegramBotUsername, $env);
			$env = $this->set('TELEGRAM_BOT_TOKEN', $telegramBotToken, $env);
			$env = $this->set('TELEGRAM_CALLBACK_URL', $this->publicRoute('socialiteCallback', 'telegram'), $env);

			$fp = fopen($envPath, 'w');
			fwrite($fp, implode($env));
			fclose($fp);

			Artisan::call('optimize:clear');
			return back()->with('success', 'Успешно обновлено');
		}
	}

	private function set($key, $value, $env)
	{
		$isKeyFound = false;
		foreach ($env as $env_key => $env_value) {
			$entry = explode("=", $env_value, 2);
			if ($entry[0] == $key) {
				$env[$env_key] = $key . "=" . $value . "\n";
				$isKeyFound = true;
			} else {
				$env[$env_key] = $env_value;
			}
		}
		if (!$isKeyFound) {
			$env[] = $key . "=" . $value . "\n";
		}
		return $env;
	}
}
