<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Admin;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class TraderManagementController extends Controller
{
    public function index()
    {
        $data['traders'] = Admin::query()
            ->where('role', 'trader')
            ->withCount('assignedSellRequests', 'completedSellRequests', 'cancelledSellRequests')
            ->latest()
            ->paginate(15);

        return view('admin.trader.index', $data);
    }

    public function create()
    {
        return view('admin.trader.create');
    }

    public function store(Request $request)
    {
        $request->merge([
            'telegram_username' => $this->normalizeTelegramUsername($request->input('telegram_username')),
        ]);

        $validated = $request->validate([
            'name' => ['required', 'string', 'min:3', 'max:255'],
            'username' => ['required', 'string', 'min:3', 'max:255', 'alpha_dash', Rule::unique('admins', 'username')],
            'email' => ['required', 'email', 'max:255', Rule::unique('admins', 'email')],
            'telegram_username' => ['required', 'string', 'min:6', 'max:33', 'regex:/^@[A-Za-z0-9_]{5,32}$/', Rule::unique('admins', 'telegram_username')],
            'password' => ['required', 'string', 'min:6', 'confirmed'],
            'status' => ['required', 'integer', 'in:0,1'],
        ]);

        Admin::query()->create([
            'name' => $validated['name'],
            'username' => $validated['username'],
            'email' => $validated['email'],
            'telegram_username' => $validated['telegram_username'],
            'password' => Hash::make($validated['password']),
            'status' => (int) $validated['status'],
            'two_fa_verify' => 1,
            'role' => 'trader',
        ]);

        return redirect()->route('admin.traders.index')->with('success', 'Трейдер успешно создан.');
    }

    public function edit($id)
    {
        $data['trader'] = Admin::query()
            ->where('role', 'trader')
            ->findOrFail($id);

        return view('admin.trader.edit', $data);
    }

    public function update(Request $request, $id)
    {
        $trader = Admin::query()
            ->where('role', 'trader')
            ->findOrFail($id);

        $request->merge([
            'telegram_username' => $this->normalizeTelegramUsername($request->input('telegram_username')),
        ]);

        $validated = $request->validate([
            'name' => ['required', 'string', 'min:3', 'max:255'],
            'username' => ['required', 'string', 'min:3', 'max:255', 'alpha_dash', Rule::unique('admins', 'username')->ignore($trader->id)],
            'email' => ['required', 'email', 'max:255', Rule::unique('admins', 'email')->ignore($trader->id)],
            'telegram_username' => ['required', 'string', 'min:6', 'max:33', 'regex:/^@[A-Za-z0-9_]{5,32}$/', Rule::unique('admins', 'telegram_username')->ignore($trader->id)],
            'password' => ['nullable', 'string', 'min:6', 'confirmed'],
            'status' => ['required', 'integer', 'in:0,1'],
        ]);

        $trader->name = $validated['name'];
        $trader->username = $validated['username'];
        $trader->email = $validated['email'];
        $trader->telegram_username = $validated['telegram_username'];
        $trader->status = (int) $validated['status'];

        if (!empty($validated['password'])) {
            $trader->password = Hash::make($validated['password']);
        }

        $trader->save();

        return redirect()->route('admin.traders.index')->with('success', 'Трейдер успешно обновлён.');
    }

    private function normalizeTelegramUsername(?string $telegramUsername): ?string
    {
        $telegramUsername = trim((string) $telegramUsername);
        if ($telegramUsername === '') {
            return null;
        }

        $telegramUsername = Str::replaceFirst('https://t.me/', '', $telegramUsername);
        $telegramUsername = Str::replaceFirst('http://t.me/', '', $telegramUsername);
        $telegramUsername = '@' . ltrim($telegramUsername, '@');

        return $telegramUsername;
    }
}
