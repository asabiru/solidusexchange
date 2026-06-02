<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Admin;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class SupportAgentController extends Controller
{
    public function index()
    {
        $data['agents'] = Admin::query()
            ->where('role', 'support')
            ->latest()
            ->paginate(15);

        return view('admin.support_agent.index', $data);
    }

    public function create()
    {
        return view('admin.support_agent.create');
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
            'telegram_username' => ['nullable', 'string', 'min:6', 'max:33', 'regex:/^@[A-Za-z0-9_]{5,32}$/', Rule::unique('admins', 'telegram_username')],
            'password' => ['required', 'string', 'min:6', 'confirmed'],
            'status' => ['required', 'integer', 'in:0,1'],
        ]);

        Admin::query()->create([
            'name' => $validated['name'],
            'username' => $validated['username'],
            'email' => $validated['email'],
            'telegram_username' => $validated['telegram_username'] ?? null,
            'password' => Hash::make($validated['password']),
            'status' => (int) $validated['status'],
            'two_fa_verify' => 1,
            'role' => 'support',
        ]);

        return redirect()->route('admin.support.agents.index')->with('success', 'Агент поддержки успешно создан.');
    }

    public function edit($id)
    {
        $data['agent'] = Admin::query()
            ->where('role', 'support')
            ->findOrFail($id);

        return view('admin.support_agent.edit', $data);
    }

    public function update(Request $request, $id)
    {
        $agent = Admin::query()
            ->where('role', 'support')
            ->findOrFail($id);

        $request->merge([
            'telegram_username' => $this->normalizeTelegramUsername($request->input('telegram_username')),
        ]);

        $validated = $request->validate([
            'name' => ['required', 'string', 'min:3', 'max:255'],
            'username' => ['required', 'string', 'min:3', 'max:255', 'alpha_dash', Rule::unique('admins', 'username')->ignore($agent->id)],
            'email' => ['required', 'email', 'max:255', Rule::unique('admins', 'email')->ignore($agent->id)],
            'telegram_username' => ['nullable', 'string', 'min:6', 'max:33', 'regex:/^@[A-Za-z0-9_]{5,32}$/', Rule::unique('admins', 'telegram_username')->ignore($agent->id)],
            'password' => ['nullable', 'string', 'min:6', 'confirmed'],
            'status' => ['required', 'integer', 'in:0,1'],
        ]);

        $agent->name = $validated['name'];
        $agent->username = $validated['username'];
        $agent->email = $validated['email'];
        $agent->telegram_username = $validated['telegram_username'] ?? null;
        $agent->status = (int) $validated['status'];

        if (!empty($validated['password'])) {
            $agent->password = Hash::make($validated['password']);
        }

        $agent->save();

        return redirect()->route('admin.support.agents.index')->with('success', 'Агент поддержки успешно обновлён.');
    }

    public function destroy($id)
    {
        $agent = Admin::query()
            ->where('role', 'support')
            ->findOrFail($id);

        $agent->delete();

        return back()->with('success', 'Агент поддержки удалён.');
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
